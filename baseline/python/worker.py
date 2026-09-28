"""YueStudio generation worker.

Reads one JSON command per line on stdin, writes JSON events on stdout.
Runs YuE2 with low-VRAM patches so it fits on 8GB consumer GPUs.

Commands
  {"cmd": "generate", "jobId": str, "outDir": path, "style": str, "lyrics": str,
   "seed": int|null, "cot": "full"|"melody"|"off", "id": str}
  {"cmd": "cancel"}
  {"cmd": "ping"}

Events
  {"type": "ready"|"stage"|"progress"|"done"|"error"|"pong", ...}
"""
from __future__ import annotations

import dataclasses
import json
import os
import queue
import random
import re
import sys
import threading
import time
from pathlib import Path

import numpy as np
import torch

# The pipeline caps the CUDA allocator at (total - 2GiB) and raises OOM instead of
# letting the Windows driver spill into system RAM. Remove that cap.
torch.cuda.set_per_process_memory_fraction = lambda *a, **k: None

import yue2.cuda_graph as cuda_graph  # noqa: E402
import yue2.nar as nar  # noqa: E402
from yue2 import YuE2Pipeline  # noqa: E402
from yue2.pipeline import SymbolicPlan, SemanticResult  # noqa: E402
from yue2.protocol import GenerationConfig  # noqa: E402

# Fast mode = CUDA graphs. Stock YuE2 picks flash attention for them, which Windows
# PyTorch ships without (the op exists but has no kernel), so pin a backend that does.
FAST_ATTENTION = os.environ.get("SSOKMUSIC_ATTENTION", "cudnn")
_GraphAR = cuda_graph.GraphAR


class GraphAR(_GraphAR):
    def __init__(self, model, prefixes, max_tokens, *, capture=True,
                 attention_backend="auto", fuse_projections=False):
        super().__init__(model, prefixes, max_tokens, capture=capture,
                         attention_backend=FAST_ATTENTION if attention_backend == "auto"
                         else attention_backend, fuse_projections=fuse_projections)


cuda_graph.GraphAR = GraphAR

_lock = threading.Lock()


def emit(**payload):
    with _lock:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()


# ── Low-VRAM patches ─────────────────────────────────────────────────────────
_attention = nar.attention


def lowvram_attention(q, k, v, *, causal=False, backend="sdpa", query_chunk_size=None):
    """Expand grouped K/V and tile queries.

    Windows PyTorch has no flash-attention kernel, and the memory-efficient kernel
    refuses grouped-query attention, so stock YuE2 falls back to the math kernel and
    allocates ~4GiB per call. Expanding K/V keeps the fast kernel; tiling bounds the rest.
    """
    if q.device.type == "cuda" and q.shape[1] != k.shape[1]:
        groups = q.shape[1] // k.shape[1]
        k, v = k.repeat_interleave(groups, 1), v.repeat_interleave(groups, 1)
    return _attention(q, k, v, causal=causal, backend=backend,
                      query_chunk_size=query_chunk_size or 1024)


nar.attention = lowvram_attention


NOTE = re.compile(r"[_^=]*[A-Ga-g][,']*")
CHORD_SYMBOL = re.compile(r'"[^"]*"')
NOTE_GROUP = re.compile(r"\[(?:[_^=]*[A-Ga-g][,']*\d*/?\d*)+\]")


# The knobs YuE2 actually accepts, with the ranges its own validation enforces.
# Anything outside them raises inside the pipeline, so they are clamped here.
LIMITS = {
    "temperature": (0.05, 5.0, float),
    "topP": (0.05, 1.0, float),
    "topK": (1, 500, int),
    "repetitionPenalty": (1.0, 2.0, float),
    "cfgScale": (1.0, 20.0, float),
    "maxTokens": (500, 9000, int),
    "minTokens": (0, 8800, int),
    "abcTemperature": (0.05, 5.0, float),
    "abcMaxTokens": (256, 4096, int),
    "odeSteps": (8, 64, int),
}


def engine_version():
    """Which YuE2 made this song — recorded so a take can be traced later."""
    try:
        from importlib.metadata import version
        return f"yue2-infer {version('yue2-infer')}"
    except Exception:  # noqa: BLE001
        return "yue2-infer"


def clamp_advanced(values):
    clean = {}
    for key, raw in (values or {}).items():
        if key not in LIMITS or raw is None:
            continue
        low, high, cast = LIMITS[key]
        try:
            clean[key] = cast(min(max(cast(raw), low), high))
        except (TypeError, ValueError):
            continue
    return clean


def rest_voice(abc: str, voice_name: str) -> str:
    """Replace one voice's notes with rests, keeping bars, durations and chords.

    Asking for an instrumental in the prompt only discourages singing; a score whose
    vocal line holds nothing but rests cannot produce a sung melody at all.
    """
    out, voice = [], None
    for line in abc.splitlines():
        header = re.match(r"V:\s*(\w+)", line)
        if header:
            voice = header.group(1)
            out.append(line)
            continue
        if voice != voice_name or not line or re.match(r"^[A-Za-z]:", line) or line.startswith("%"):
            out.append(line)
            continue
        symbols = CHORD_SYMBOL.findall(line)
        body = CHORD_SYMBOL.sub("\0", line)
        body = NOTE_GROUP.sub("z", body)
        body = NOTE.sub("z", body)
        body = re.sub(r"(z[0-9/]*)-", r"\1", body)
        for symbol in symbols:
            body = body.replace("\0", symbol, 1)
        out.append(body)
    return "\n".join(out)


def silence_vocals(abc: str) -> str:
    """Keep the instrumental line; the vocal line falls silent (used for 연주곡)."""
    return rest_voice(abc, "Vocal")


def drop_chords(abc: str) -> str:
    """Remove the quoted chord symbols, leaving the melodies to stand alone."""
    return CHORD_SYMBOL.sub("", abc)


def ar_modules(model):
    mods = [model.model.embed_tokens, model.model.norm, model.model.rotary_emb, model.lm_head]
    for layer in model.model.layers:
        mods += [layer.input_layernorm, layer.self_attn, layer.post_attention_layernorm, layer.mlp]
    return mods


class LowVramPipeline(YuE2Pipeline):
    """Keeps only the weights the current stage needs on the GPU."""

    def _load_model(self, for_nar=False):
        if self._model is None:
            from yue2.modeling_yue2 import YuE2ForCausalLM
            emit(type="stage", stage="load", status="start")
            self._model = YuE2ForCausalLM.from_pretrained(
                self.model_dir, local_files_only=True,
                dtype=torch.bfloat16, low_cpu_mem_usage=True).eval()
            emit(type="stage", stage="load", status="done")
        model = self._model
        mode = "nar" if for_nar else "ar"
        if getattr(model, "_lowvram_mode", None) != mode:
            model.to("cpu")
            torch.cuda.empty_cache()
            if for_nar:
                model.to(self.device)
            else:
                for m in ar_modules(model):
                    m.to(self.device)
            model._lowvram_mode = mode
            torch.cuda.empty_cache()
        return model

    def decode(self, *a, **k):
        if self._model is not None:
            self._model._lowvram_mode = None
        return super().decode(*a, **k)


# ── Worker ───────────────────────────────────────────────────────────────────
class Worker:
    def __init__(self):
        self.pipe = None
        self.cancel = threading.Event()
        # A cancel can arrive before its job does: while the worker spends its first
        # minute importing torch it reads nothing, then finds "generate" and "cancel"
        # together. Cancels are therefore remembered by job id, not only flagged.
        self.cancelled_jobs = set()
        self.current_job = None
        self.jobs = queue.Queue()
        # "torch" runs the AR loop as a captured CUDA graph (fast mode); "torch-eager"
        # is the fallback. SSOKMUSIC_FAST=0 starts in the slow path.
        self.backend = "torch-eager" if os.environ.get("SSOKMUSIC_FAST") == "0" else "torch"

    def ensure_pipe(self):
        if self.pipe is None:
            self.pipe = LowVramPipeline.from_pretrained(
                "m-a-p/YuE2-3B", vae="m-a-p/YuE2-Vae", device="cuda",
                memory_budget_gib=8, offload_ar=True, backend=self.backend,
                local_files_only=True, progress=False)
        return self.pipe

    def downgrade(self, reason):
        """Fall back to the always-safe eager path, keeping the loaded weights."""
        emit(type="notice", message=f"빠른 모드를 끄고 기본 모드로 진행합니다 ({reason})")
        self.backend = "torch-eager"
        if self.pipe is not None:
            self.pipe.backend = "torch-eager"

    def cancelled(self):
        return self.cancel.is_set()

    def generate(self, job):
        out = Path(job["outDir"])
        out.mkdir(parents=True, exist_ok=True)
        seed = job.get("seed")
        if seed is None:
            seed = random.randrange(2**31)
        started = time.perf_counter()
        pipe = self.ensure_pipe()
        # Loading the model can take a minute; a cancel pressed meanwhile stops here
        # instead of after the first step of the song.
        if self.cancelled():
            raise InterruptedError()
        advanced = clamp_advanced(job.get("advanced"))
        request = pipe._request(style=job["style"], lyrics=job["lyrics"],
                                cot=job.get("cot", "full"), seed=int(seed),
                                id=job.get("id", "song"),
                                cfg_scale=advanced.get("cfgScale"))
        # ode_steps lives on the pipeline, which is reused between songs, so set it
        # every time — including back to the default when nothing was asked for.
        pipe.generation_config = dataclasses.replace(
            GenerationConfig(), ode_steps=advanced.get("odeSteps", GenerationConfig().ode_steps))
        abc_sampling = {key: advanced[source] for key, source in
                        (("temperature", "abcTemperature"), ("max_tokens", "abcMaxTokens"))
                        if source in advanced}
        semantic_sampling = {key: advanced[source] for key, source in
                             (("temperature", "temperature"), ("top_p", "topP"),
                              ("top_k", "topK"), ("repetition_penalty", "repetitionPenalty"),
                              ("max_tokens", "maxTokens"), ("min_tokens", "minTokens"))
                             if source in advanced}
        # min_tokens holds the song open until the target length; it cannot exceed the cap.
        if "min_tokens" in semantic_sampling:
            ceiling = semantic_sampling.get("max_tokens", 9000)
            semantic_sampling["min_tokens"] = min(semantic_sampling["min_tokens"], ceiling)
        if advanced:
            emit(type="notice", message=f"고급 설정 적용: {', '.join(sorted(advanced))}")

        counters = {"stage": None, "n": 0, "t0": time.perf_counter()}

        def on_token(phase, token):
            counters["n"] += 1
            now = time.perf_counter()
            if now - counters.get("last", 0) > 0.4:
                counters["last"] = now
                emit(type="progress", jobId=job["jobId"], stage=counters["stage"],
                     tokens=counters["n"],
                     rate=round(counters["n"] / max(now - counters["t0"], 1e-6), 2))

        def start(stage):
            counters.update(stage=stage, n=0, t0=time.perf_counter(), last=0)
            emit(type="stage", jobId=job["jobId"], stage=stage, status="start")

        # 1. symbolic plan
        plan_dir = out / "plan"
        if (plan_dir / "plan_manifest.json").exists():
            plan = SymbolicPlan.load(plan_dir)
        elif job.get("abc"):
            # An edited score arrives as text: YuE2 refuses a plan folder whose files
            # were touched, so the score is supplied as an external planner input.
            start("plan")
            supplied = job["abc"]
            # An instrumental stays an instrumental even when the score was edited by
            # hand: the vocal line is emptied again before it reaches the model.
            if job.get("instrumental"):
                supplied = silence_vocals(supplied)
            request = dataclasses.replace(request, abc=supplied)
            plan = pipe.plan(request=request)
            plan.save(plan_dir)
        else:
            start("plan")
            plan = pipe.plan(request=request, abc_sampling=abc_sampling or None,
                             cancelled=self.cancelled, on_token=on_token)
            if job.get("instrumental") and plan.abc:
                # Re-plan from the same score with the vocal line emptied, so the song
                # stage has no melody to sing.
                quiet = dataclasses.replace(request, abc=silence_vocals(plan.abc))
                plan = pipe.plan(request=quiet)
                request = quiet
            plan.save(plan_dir)
        emit(type="stage", jobId=job["jobId"], stage="plan", status="done",
             abc=plan.abc, truncated=plan.truncated)

        # "Score only" stops here: the draft can be read, edited and rendered later.
        if job.get("mode") == "plan":
            (out / "score.abc").write_text(plan.abc or "", encoding="utf-8")
            meta = {"id": request.id, "style": request.style, "lyrics": request.lyrics,
                    "cot": request.cot, "seed": request.seed, "advanced": advanced,
                    "scoreOnly": True, "wallSeconds": round(time.perf_counter() - started, 1),
                    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S")}
            (out / "result.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1),
                                             encoding="utf-8")
            emit(type="done", jobId=job["jobId"], audio=None, scoreOnly=True,
                 abc=plan.abc, meta=meta)
            return

        # 2. semantic (song) tokens
        sem_file = out / "semantic.npy"
        if sem_file.exists():
            semantic = SemanticResult(plan, np.load(sem_file).tolist(), {}, False)
        else:
            start("semantic")
            semantic = pipe.generate_semantic(plan, sampling=semantic_sampling or None,
                                              cancelled=self.cancelled, on_token=on_token)
            np.save(sem_file, np.asarray(semantic.tokens, dtype=np.int32))
        emit(type="stage", jobId=job["jobId"], stage="semantic", status="done",
             tokens=len(semantic.tokens), truncated=semantic.truncated)

        # 3. acoustic synthesis
        lat_file = out / "latent.npy"
        if lat_file.exists():
            latents = np.load(lat_file)
        else:
            start("synth")

            def on_steps(done, total):
                emit(type="progress", jobId=job["jobId"], stage="synth",
                     step=int(done), steps=int(total))

            # pipe.synthesize() only reports steps when its own console progress is on,
            # so call the same routine directly to drive the app's progress bar.
            model = pipe._load_model(for_nar=True)
            latents = nar.synthesize(
                model, semantic.plan.prefix, semantic.tokens, request.seed,
                steps=pipe.generation_config.ode_steps, context=pipe.generation_config.context,
                offload_ar=True, cancelled=self.cancelled, on_progress=on_steps,
            ).detach().float().cpu().numpy()
            np.save(lat_file, latents)
        emit(type="stage", jobId=job["jobId"], stage="synth", status="done")

        # 4. decode to audio
        start("decode")
        audio = pipe.decode(latents)
        import soundfile as sf
        wav = out / "audio.wav"
        sf.write(wav, audio, 48000, subtype="PCM_24")
        emit(type="stage", jobId=job["jobId"], stage="decode", status="done")

        meta = {"id": request.id, "style": request.style, "lyrics": request.lyrics,
                "cot": request.cot, "seed": request.seed, "advanced": advanced,
                "engine": engine_version(), "abc": plan.abc,
                "seconds": round(len(audio) / 48000, 1),
                "wallSeconds": round(time.perf_counter() - started, 1),
                "truncated": {"abc": plan.truncated, "semantic": semantic.truncated},
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S")}
        # meta.json belongs to the app (it holds the user's title); the worker only
        # reports what it produced.
        (out / "result.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1),
                                         encoding="utf-8")
        emit(type="done", jobId=job["jobId"], audio=str(wav), meta=meta)

    def run(self):
        threading.Thread(target=self.read_stdin, daemon=True).start()
        emit(type="ready", cuda=torch.cuda.is_available(),
             gpu=torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)
        while True:
            job = self.jobs.get()
            if job is None:
                return
            job_id = job.get("jobId")
            # Clear first, then claim the job, then look for an early cancel — in that
            # order no cancel can fall between the cracks.
            self.cancel.clear()
            self.current_job = job_id
            if job_id in self.cancelled_jobs:
                self.cancelled_jobs.discard(job_id)
                self.current_job = None
                emit(type="error", jobId=job_id, cancelled=True, message="생성이 취소되었습니다.")
                continue
            try:
                try:
                    self.generate(job)
                except (RuntimeError, NotImplementedError, ValueError) as exc:
                    # A missing CUDA-graph/attention kernel only shows up once the graph
                    # is captured. Retry the same job on the eager path; finished stages
                    # are already on disk, so nothing is recomputed.
                    if self.backend != "torch" or self.cancel.is_set():
                        raise
                    self.downgrade(str(exc).splitlines()[0][:160])
                    torch.cuda.empty_cache()
                    self.generate(job)
            except InterruptedError:
                emit(type="error", jobId=job.get("jobId"), cancelled=True,
                     message="생성이 취소되었습니다.")
            except Exception as exc:  # noqa: BLE001
                import traceback
                emit(type="error", jobId=job.get("jobId"),
                     message=f"{type(exc).__name__}: {exc}",
                     detail=traceback.format_exc())
            finally:
                self.current_job = None
                torch.cuda.empty_cache()

    def read_stdin(self):
        for line in sys.stdin:
            line = line.lstrip("﻿").strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            cmd = message.get("cmd")
            if cmd == "generate":
                self.jobs.put(message)
            elif cmd == "cancel":
                job_id = message.get("jobId")
                if job_id is None or job_id == self.current_job:
                    self.cancel.set()
                else:
                    self.cancelled_jobs.add(job_id)
            elif cmd == "ping":
                emit(type="pong")
            elif cmd == "quit":
                self.jobs.put(None)
                return
        # stdin closed: the app is gone, so do not sit in memory holding the model.
        self.cancel.set()
        self.jobs.put(None)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    Worker().run()
