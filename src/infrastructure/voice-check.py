"""Offline, read-only AudioSet AST classification. JSON lines over stdio."""
import hashlib
import json
import math
import os
import subprocess
import sys

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_DATASETS_OFFLINE="1")
SHA = "ae0c1e2ad4e1381d851fa9bf298ba13ebc9c5a914cdee2dbe427a6583869924d"
GROUPS = {"speech": list(range(16)) + [68, 70], "singing": list(range(27, 37)) + [254], "humming": [37]}

def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)

def digest(file):
    h = hashlib.sha256()
    with open(file, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def main():
    import numpy as np
    import torch
    from transformers import ASTFeatureExtractor, ASTForAudioClassification
    request = json.loads(sys.stdin.readline())
    folder = request["model"]
    for file, expected in {"model.safetensors": SHA, "config.json": "a93d525511d77e8ecc933d09674b85099815bbbb417c228a4edd655e252fb9ff", "preprocessor_config.json": "8d04ba5a9c6fca5d39d0de2b1fd05ecf79deb589fbba279728bbebac39934231"}.items():
        if digest(os.path.join(folder, file)) != expected:
            raise ValueError("모델 해시가 일치하지 않습니다.")
    # Disable optional torchaudio fast path; the extractor supplies the same
    # supported NumPy filter-bank implementation in this Python environment.
    extractor = ASTFeatureExtractor.from_pretrained(folder, local_files_only=True)
    model = ASTForAudioClassification.from_pretrained(folder, local_files_only=True, use_safetensors=True)
    model.eval()
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    # Verify label IDs, so changes to config cannot reinterpret score groups.
    expected = {0:"Speech", 27:"Singing", 37:"Humming", 254:"Vocal music"}
    for index, label in expected.items():
        if model.config.id2label.get(index) != label:
            raise ValueError("모델 음성 분류표가 일치하지 않습니다: " + str(index))
    emit({"type":"ready", "sha256":SHA})
    for item in request["items"]:
        try:
            decoded = subprocess.run([request["ffmpeg"], "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", item["file"], "-vn", "-ac", "1", "-ar", "16000", "-t", "1800.1", "-f", "f32le", "pipe:1"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=True)
            samples = np.frombuffer(decoded.stdout, dtype="<f4")
            duration = len(samples) / 16000
            if not 0 < duration <= 1800 or not np.isfinite(samples).all():
                raise ValueError("음악 길이 또는 샘플이 올바르지 않습니다.")
            last = max(0, len(samples) - 160000)
            positions = list(range(0, last, 80000)) + [last]
            windows = []
            with torch.inference_mode():
                for i, at in enumerate(positions):
                    end = min(len(samples), at + 160000)
                    features = extractor(samples[at:end], sampling_rate=16000, return_tensors="pt")
                    logits = model(**features).logits[0]
                    scores = torch.sigmoid(logits).cpu().numpy()
                    window = {"start": at / 16000, "end": end / 16000}
                    window.update({group: float(max(scores[index] for index in indices)) for group, indices in GROUPS.items()})
                    windows.append(window)
                    emit({"type":"progress", "id":item["id"], "completedWindows": i + 1, "totalWindows":len(positions)})
            emit({"type":"result", "id":item["id"], "value":{"duration":duration, "sampleRate":16000, "windows":windows}})
        except Exception as error:
            emit({"type":"error", "id":item["id"], "message":str(error)[:1000]})

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"type":"fatal", "message":str(error)[:1000]})
        sys.exit(1)
