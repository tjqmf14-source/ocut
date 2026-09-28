# 빌드와 재현

## Phase 0

Windows, Node >=22.12, npm, 원본 installer 추출물이 필요합니다. 이번 검증 Node는 24.19.0입니다.

1. 제공된 원본 설치 파일을 `original/ssokMusic-Free-Setup-0.50.2.exe`에 보존하고 보고서 SHA-256과 확인합니다.
2. 7-Zip으로 실행 없이 `original/extracted`에 추출합니다.
3. `node scripts/extract-asar.cjs`: ASAR 내장 SHA-256을 검증하며 original/source 복원.
4. 저장소의 baseline은 검증용 안전 격리 변경을 포함합니다. original/source를 무조건 덮어쓰지 않습니다.
5. `npm ci --ignore-scripts`: lockfile 기준 개발 도구 설치.
6. `npm run build:baseline`: 현재 baseline 소스의 ASAR와 Windows 실행 디렉터리 생성.
7. `npm test`: 패키지/소스 일치 및 핵심 로직 검사. Python 검증에는 `OCUT_PYTHON` 또는 현재 PC의 기본 `D:/ssokmusic/runtime/venv/Scripts/python.exe` 사용.
8. `npm run qa:baseline`: 실제 창을 열어 UI→AI WAV 생성→종료/재실행 검증. NVIDIA CUDA, 준비된 YuE2 모델, ffprobe 필요. `OCUT_HF_HOME`으로 모델 캐시 경로 지정 가능.
9. `node scripts/qa-render.cjs`: 직전 실행에서 생성한 음원을 사용해 실제 UI import/render, 3개 출력과 MP3/WAV 확인.
10. `node scripts/static-inventory.cjs`: 원본과 baseline 차이 및 IPC 목록 갱신.

QA는 실제 창과 GPU를 사용합니다. 실행 중 테스트 창의 입력을 바꾸거나 닫으면 실패할 수 있습니다. 기존 사용자 곡/설정을 import하지 않습니다. 원본/패키지/미디어/모델은 Git에 넣지 않으며 이 PC에 보존합니다.

빌드는 Electron 런타임을 재사용한 소스 repack입니다. 원 제작자의 lockfile 및 installer 설정이 없어 원본 installer의 비트 단위 재현을 주장하지 않습니다. 최종 O-CUT installer는 후속 Phase입니다.
