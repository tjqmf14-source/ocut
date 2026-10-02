"""O-CUT offline Whisper worker. Model files and PCM are supplied by the main process."""
import json
import sys
import numpy as np

def emit(**value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

def main():
    job = json.loads(sys.stdin.readline())
    emit(type="stage", message="음성 인식 모델을 불러오고 있습니다.")
    import torch
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline
    device = "cuda:0" if job["device"] == "auto" and torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device != "cpu" else torch.float32
    model = AutoModelForSpeechSeq2Seq.from_pretrained(job["model"], local_files_only=True, torch_dtype=dtype, use_safetensors=True)
    processor = AutoProcessor.from_pretrained(job["model"], local_files_only=True)
    transcriber = pipeline("automatic-speech-recognition", model=model, tokenizer=processor.tokenizer,
                           feature_extractor=processor.feature_extractor, torch_dtype=dtype, device=device)
    samples = np.fromfile(job["pcm"], dtype="<f4")
    emit(type="stage", message="음성을 인식하고 시간 정보를 만들고 있습니다.", device=device)
    options = {"task": "transcribe"}
    if job["language"] != "auto":
        options["language"] = job["language"]
    result = transcriber({"raw": samples, "sampling_rate": 16000}, chunk_length_s=30,
                         return_timestamps=True, generate_kwargs=options)
    segments = []
    for chunk in result.get("chunks", []):
        start, end = chunk["timestamp"]
        start = max(0, float(start or 0))
        end = min(len(samples) / 16000, float(end if end is not None else len(samples) / 16000))
        text = chunk["text"].strip()
        if text and end > start:
            segments.append({"startTime": start, "duration": end - start, "text": text})
    emit(type="done", segments=segments, device=device, model="Whisper base (local)")

try:
    main()
except Exception as error:
    emit(type="error", message=str(error))
    sys.exit(1)
