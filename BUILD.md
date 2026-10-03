# 빌드와 재현

## Windows 설치 후보

- `node scripts/verify-release.cjs`: 검증된 Studio ASAR 확인 → 설치 파일 생성 → 108개 검사 → 설치 경로 보호 → 실제 전체 설치/앱 실행/MP4/재설치/제거/Windows 등록 검증. `--existing`은 이미 만든 파일과 현재 빌드 입력 해시를 확인한 뒤 검증만 새로 실행한다. 빌드를 생략한 단계를 PASS로 기록하지 않는다.
- 출력: `artifacts/release/O-CUT-Setup-0.11.0.exe`, `SHA256SUMS.txt`. 정확한 해시·파일 목록·도구 출처는 `evidence/release/build.json`, 최신 검증은 `evidence/release/gate.json`에 있다. 같은 설치 파일 해시인지 확인해야 한다.
- 빌드 입력: 기존 electron-builder 캐시의 NSIS 3.04 및 `.runtime/build-tools/rcedit-x64-2.0.0.exe`. `OCUT_MAKENSIS`, `OCUT_RCEDIT`로 경로를 지정할 수 있으나 스크립트의 고정 SHA-256과 일치해야 한다. RCEdit의 공식 출처는 RELEASE_REPORT.md에 있다. 자동 설치·다운로드는 하지 않는다.
- 이 PC의 Gyan FFmpeg/FFprobe 실행 파일과 LICENSE/README를 `resources/tools`에 동봉한다. `OCUT_FFMPEG` 또는 PATH에서 ffmpeg를 찾고 같은 bin 폴더의 ffprobe를 사용한다. 기존 Python·AI 모델은 동봉하지 않는다.
- 개발 빌드와 별도 staging에서 O-CUT PE 이름·버전·아이콘을 적용한다. 소스/installer script/도구의 해시, runtime 파일 manifest를 기록하고 컴파일 경고도 실패로 처리한다. staging은 원본 및 기존 설치와 분리한다.
- 시험은 `.runtime`의 고유 경로에 설치한다. 실제 기존 O-CUT 등록이나 시작 메뉴 폴더가 있으면 통합 검사를 수행하지 않고 NOT RUN으로 기록하며 전체 release Gate를 통과시키지 않는다. 원격 CI·전자 서명·깨끗한 새 PC/VM 검증은 포함하지 않는다.
- NSIS `/D=`와 제거의 `_?=` 인수는 마지막에 인용 부호 없이 전달해야 한다. 일반 UI 설치에서는 별도 명령행 인수가 필요 없다. `qa-installer-paths.cjs`는 작은 payload로 같은 경로/보존 규칙을 빠르게 검사하지만 전체 파일 설치 검사를 대신하지 않는다.
- 설치 동작·복구와 미검증 범위: [RELEASE_REPORT.md](RELEASE_REPORT.md).

## 현재 O-CUT Studio

- `node scripts/verify-studio.cjs`: Core/Studio Build → 108개 검사 → 실제 shell/timeline → 1080p30/60·4K30 출력 → 이미지 조합 출력 → 취소/원본 보호 → 자막 편집·SRT·MP4 → 실제 GPU 음악 생성·페이드·MP4·취소·재실행 → 시각화 6종 출력·프레임 비교·취소·캐시 복원 → 텍스트 서식 4종 출력 → 로컬 Whisper GPU/CPU 인식·즉시/실행 중 취소·SRT/MP4·복원 → 키프레임 영상/텍스트·PCM 볼륨·분할·취소·복원 → 색 보정/전환·겹침 혼합·실제 영상 비교 → 강제 종료·자동 저장·최근 프로젝트·복구 → 1,000클립 반응성 → 음악 대기열의 실제 생성·복원·취소·출력을 순서대로 검사합니다. 하나라도 실패하면 종료 코드 1이며 PASS 증거를 새로 쓰지 않습니다. 음악 검사는 CUDA와 기존 YuE2 환경이 필요하며 없는 환경에서 skip/PASS 처리하지 않습니다.
- 앱: `dist/studio/O-CUT.exe`. 패키지의 현재 소스 바이트를 ASAR에서 꺼내 비교합니다. 빌드마다 독립 staging을 만들어 삭제된 소스가 남지 않도록 합니다.
- FFmpeg/FFprobe: `OCUT_FFMPEG`/`OCUT_FFPROBE` 지정 경로 → `resources/tools/*.exe` → PATH 순서로 찾습니다. 현재 빌드는 도구를 자동 설치·동봉하지 않습니다. 이번 검증은 9.0으로 수행했습니다.
- 개별 검사: `qa-shell.cjs`, `qa-timeline.cjs`, `qa-studio-render.cjs`, `qa-image-export.cjs`, `qa-export-recovery.cjs`, `qa-captions.cjs`, `qa-music.cjs`, `qa-visualizer.cjs`, `qa-text-style.cjs`, `qa-transcribe.cjs`, `qa-keyframes.cjs`, `qa-color-filters.cjs`, `qa-transitions.cjs`, `qa-workspace.cjs`, `qa-performance.cjs` (모두 `scripts` 폴더). 시각화 QA는 실제 music QA가 만든 WAV를 입력으로 사용합니다.
- 음악 worker는 `baseline/python/worker.py`를 바이트 그대로 `resources/music-worker/worker.py`에 복사합니다. 원본 출처 메모를 함께 기록하고 패키지 검사에서 동일성을 확인합니다. Python·모델은 포함하지 않습니다. 기본 경로는 `D:/ssokmusic/runtime/venv/Scripts/python.exe`, `D:/ssokmusic/models`이며 UI 또는 `OCUT_PYTHON`/`OCUT_HF_HOME`으로 연결합니다. Offline 환경 변수로 기존 모델 캐시만 읽습니다.
- STT QA는 Windows Heami 한국어 SAPI 음성으로 테스트 파일을 만들며 기존 Transformers/torch/numpy 및 캐시된 Whisper base 모델이 필요합니다. 이 PC에서 GPU와 CPU를 모두 실제 실행합니다. Python worker는 resources/transcribe에 바이트 그대로 복사하며 모델·Python은 포함하지 않습니다. 추가 설치/다운로드는 없습니다.
- 원본을 바꾸지 않고 native 파일 선택 대화상자의 응답만 테스트 경로로 지정합니다. 실제 IPC·미디어 분석·편집·FFmpeg 출력 코드는 대체하지 않습니다.
- 테스트용 파일과 앱 데이터는 `.runtime`에 격리됩니다. `evidence/studio/gate.json`에 패키지 해시 및 검사 결과를 기록합니다.
- 위 개발 빌드는 원래 런타임의 PE를 그대로 사용합니다. Windows 설치 후보에서 별도로 이름/아이콘과 도구 안내를 묶습니다. 런타임 갱신과 새 PC 설치 검사는 후속 단계입니다.

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

## Phase 1 코어

Phase 1 브랜치에서는 `npm run build:core`를 먼저 실행한 뒤 `npm test`를 실행합니다. 테스트는 배포 사본 `dist/core`를 사용하며 현재 소스와 동일한지 확인합니다. 실제 Electron 저장/재열기 smoke에는 Phase 0 baseline 빌드도 필요합니다. 신규 runtime dependency는 없습니다.
