# O-CUT Phase 0 Baseline 보고서

검증일: 2026-09-28. 범위: 제공된 설치 파일의 정적 분석, 배포 소스 복원, 격리 baseline 빌드와 실제 실행. **최종 O-CUT 제품/설치 프로그램의 완료 보고서가 아니다.**

## 원본과 복원

- 입력: `C:\Users\tjqmf\AppData\Local\Temp\ssokMusic-Free-Setup-0.50.2.exe`
- 크기: 81,749,297 bytes. SHA-256: `aba6ad82505df3a24df0b01ce694d8fd45cb36e5a90327526e2386575ce2afcc`.
- 원본 보존 사본: `original/ssokMusic-Free-Setup-0.50.2.exe`. 설치 실행 및 원본 EXE 패치 없음.
- NSIS: `NullsoftInst` 서명 offset 49160. 내부 7z payload offset 131482. 추출 도구의 trailing-data 경고는 보존했으며 실제 추출은 성공했다.
- Authenticode: NotSigned. 서명/암호화 때문에 분석이 차단되지 않았다.
- 추출 payload: 80 files, 281,511,195 bytes. `original/extracted`.
- ASAR 복원: 21개 파일 전부 길이 및 내장 SHA-256 대조 성공. `original/source`는 그대로 보존, `baseline`은 격리 실행용 작업 사본.
- 배포 ASAR에 포함된 JavaScript/Python/HTML/CSS는 복원했다. 원 제작자의 Git 이력, lockfile, 개발 의존성, NSIS 빌드 설정은 배포물에 없어 복원하지 못했다. 소스맵으로 복원한 것이 아니라 포함된 평문 소스다.

## 구조와 의존성

| 구분 | 확인 결과 |
|---|---|
| Electron / 내장 Node / Chromium | 33.4.11 / 20.18.3 / 130.0.6723.191, 실행 파일의 process.versions로 확인 |
| Main | `electron/main.js`, 57개 IPC handler, 파일/프로젝트/queue/작업자/설치/설정 관리 |
| Preload | `electron/preload.js`, contextBridge의 `window.yue`, contextIsolation=true |
| Renderer | `renderer/index.html`, `styles.css`, `app.js`, `prompt.js`, `sortable.js`, `studio.js`, `spectrum-renderer.js` |
| 처리 모듈 | `electron/midi.js`, `video.js`, `spectrum-analysis.js`, `spectrum-worker.js` |
| Python | `worker.py`, `setup_models.py`, `abc_check.py`, `abc_tools.py`, Apache-2.0 전문 |
| Assets | build/icon.png. 별도 음악/영상 샘플 자산 없음 |
| JS runtime dependencies | 원 package.json에 dependencies/devDependencies 없음. Electron와 Node 내장 모듈 및 상대 경로 모듈만 발견. `.node` 모듈 없음 |
| Python 실측 | Python 3.12.14, torch 2.10.0+cu128, yue2-infer 0.1.6, numpy 2.2.6, imageio-ffmpeg 0.6.0. 전체 목록은 `evidence/phase0/python-installed.txt` |
| 모델 | m-a-p/YuE2-3B, m-a-p/YuE2-Vae. 기존 로컬 캐시를 offline으로 사용 |
| FFmpeg | installer의 ffmpeg.dll은 Chromium 미디어 라이브러리. CLI는 Python imageio-ffmpeg의 ffmpeg-win-x86_64-v7.1.exe. ffprobe는 PC에 설치된 별도 9.0 사용 |
| 기타 binary | elevate.exe, d3dcompiler_47.dll, libEGL.dll, libGLESv2.dll, vk_swiftshader.dll, vulkan-1.dll; 설치 단계 uv.exe/관리 Python 사용 |
| 로컬 개발 도구 | Node 24.19.0, npm 11.17.0; devDependency @electron/asar 4.3.1, playwright-core 1.58.2, package-lock.json 생성 |

기존 Python 환경 `D:\ssokmusic\runtime\venv`와 모델 `D:\ssokmusic\models`는 재설치/이동/업그레이드하지 않고 검증에 사용했다. 새 Node 개발 의존성은 `npm install --ignore-scripts`로 설치했다. 최신 npm audit 결과 0건은 이 개발 도구 dependency tree에만 해당하며 Electron/Python/FFmpeg 전체 보안 인증이 아니다.

## 저장소/설정/업데이트

원본은 `%APPDATA%\ssokMusic`에 settings.json, queue.json, app.log, video-cache를 두며 기존 YueStudio 설정을 자동 이관한다. 기본 곡 경로는 Documents/YueStudio/Songs이며 설정으로 dataDir, pythonPath, hfHome, songsDir, exportDir을 지정한다. 곡 폴더에는 meta.json, audio, plan, semantic.npy, latent.npy 등이 저장된다. 프로젝트는 곡 폴더 분류이며 멀티트랙 `.ocut` 포맷이 아니다.

원본 업데이트는 `https://ssok.dev/api/version?product=SSOKMUSIC&platform=win`을 조회하고 설치 파일을 내려받아 실행한다. 실행 전 다음 세 파일만 변경했다.

1. `baseline/electron/main.js`: O-CUT 전용 userData, legacy 자동 이관 호출 제거, 기존 사용자 곡 폴더 fallback 제거.
2. `baseline/electron/app-update.js`: 원 제품 업데이트 확인/다운로드/실행 경로 비활성화. 원 코드는 original/source에 보존.
3. `baseline/package.json`: o-cut-baseline 및 O-CUT Baseline 식별자.

나머지 18개 파일은 원본과 동일하다. baseline 화면/아이콘과 PE 제품 메타데이터는 원 프로그램 것이며 최종 O-CUT 디자인/브랜딩으로 간주하지 않는다. 실행 파일 이름만 O-CUT.exe인 것은 제품 전환 완료를 의미하지 않는다.

## 기존 기능 Inventory

원본 행 번호별 전체 IPC는 `evidence/phase0/ipc-inventory.md`에 있다. 아래 PASS는 기재한 검증 범위만 의미한다.

| 기능 / UI 진입점 | 구현 / dependency | 주요 IPC | 실제 확인 |
|---|---|---|---|
| 음악 생성 / 곡 만들기 | app.js → main.js → worker.py / torch, YuE2, CUDA | song:generate, job:* | PASS: UI 클릭으로 새 20초 WAV 생성, 전체 decode. cot=off, seed=42, odeSteps=8, maxTokens=500. 길이 제한으로 semantic truncated=true이며 장곡 품질 검증 아님 |
| 프로젝트 선택/생성 | main.js 파일 폴더 모델 | projects:list/create/select | PASS: 생성/선택/종료 후 복원. rename NOT CHECKED |
| Queue | main.js, app.js / JSON queue | queue:list/remove/reorder/pause/retry/clear | 단일 생성 queue 경유 확인. 다중 queue/취소/재시도/정렬 NOT CHECKED |
| MP3 / WAV | main.js / FFmpeg | song:export, songs:import | PASS: 실제 UI import, 실제 IPC export, 파일 생성 및 decode |
| Album export | main.js / FFmpeg tags | album:export | 코드 확인, NOT CHECKED |
| MIDI → ABC | midi.js → abc_check.py | score:open/convert/check | PASS: 유효 MIDI fixture 3음을 ABC로 변환 후 Python 검증; 악보 선택 대화상자 및 합성은 NOT CHECKED |
| ABC 편집/재합성 | app.js, abc_tools.py, worker.py | song:score, song:render | 파서 실행 PASS. 수동 편집→재합성 NOT CHECKED |
| 영상 생성 / 영상 스튜디오 | studio.js, video.js / Canvas, FFmpeg | video:prepare/start/frame/layer/finish | PASS: UI로 1080p30/1080p60/2160p30 spectrum MP4 생성 |
| Spectrum | spectrum-analysis.js/worker + spectrum-renderer.js | video:prepare, video:compare | PASS: 실제 생성 음원 FFT, 캐시 사용, 미리보기 재생, 비교 프레임 offset 0 |
| Audio 처리 | video.js, main.js / FFmpeg | songs:import, video:prepare | PASS: 실제 음원 읽기, stereo 48kHz, mono PCM 분석, MP3/WAV 출력. 다중 트랙 연결 NOT CHECKED |
| Python worker | JSON-lines stdin/stdout, resumable stage files | song:generate/resume/cancel | 실제 load/semantic/synth/decode/done 확인. ping/cancel/resume 별도 NOT CHECKED |
| 설정/파일 관리 | main.js / fs, shell | settings:*, songs:compact, song:delete/rename/reveal | 격리 settings 저장/읽기 확인. 사용자 데이터 이동/삭제/정리는 NOT RUN |
| GPU / encoder | nvidia-smi, torch, video.js | setup:check, video:start | RTX 5080 CUDA 생성 PASS. 영상 CPU(libx264) PASS. NVENC 및 GPU 실패 fallback NOT CHECKED |
| 기존 설치/업데이트 | main.js, app-update.js / uv, HTTP | setup:run, update:* | installer 실행 NOT RUN. updater 차단 테스트 PASS |

## 빌드/실행/QA 결과

- 앱: `dist/baseline/O-CUT.exe`. 복원 소스를 새 ASAR로 패키징하고 제공된 Electron 런타임에 배치했다. Electron 자체를 소스 컴파일한 것이 아니며 새 installer도 아니다.
- 필수 Python 및 Node worker를 ASAR 외부에 배치했고 현재 소스와 패키지 바이트가 일치하는 검사 포함.
- 테스트: Node test runner 9개, 실패/취소/skip/todo 0. 별도 실제 앱 확인 6개, 실제 import/render/export 확인 6개. 상세 JSON에 결과 저장.
- 실제 화면 캡처: baseline-main.png, baseline-generated.png, baseline-spectrum.png, baseline-export-complete.png. 화면을 직접 열어 검토했다.
- 새 20초 AI WAV 전체 decode, 앱 종료/재실행 후 곡 및 프로젝트 복원 성공.
- 렌더 fixture는 위 AI 음원의 앞 2초를 사용했다. 파일 선택 대화상자만 테스트 경로로 주입했고 제품 import/render/IPC/FFmpeg 코드는 대체하지 않았다. OS 파일 선택 대화상자 자체는 NOT CHECKED.

| 파일 | 크기 | 영상/오디오 | 길이 | 전체 decode | preview SSIM |
|---|---:|---|---:|---|---|
| 1080p-30.mp4 | 250176 | H.264 1920×1080 30fps / AAC | 2.000s | PASS | 0.9927–0.9928 |
| 1080p-60.mp4 | 241120 | H.264 1920×1080 60fps / AAC | 2.000s | PASS | 약 0.9927 |
| 2160p-30.mp4 | 613710 | H.264 3840×2160 30fps / AAC | 2.000s | PASS | 약 0.9929 |

파일: `evidence/phase0/renders/2026-09-28T13-21-33-206Z/`. 모든 파일의 ffprobe JSON 포함. 대용량 장시간/새 PC/installer 검증과 최종 제품 E2E A–E는 NOT RUN이며 이 baseline 결과로 대체하지 않는다.

## 실패 이력과 한계

- 첫 ASAR 빌드: unpack glob이 절대 파일 경로와 맞지 않아 worker 배치 확인 실패. 디렉터리 기반 unpack으로 수정 후 재빌드/실행/실제 worker 분석 성공.
- 최초 frameTotal 테스트: JS -0과 +0을 strict comparison한 검사 오류. 숫자상 프레임 수 비교로 정정했으며 원본 엔진 코드는 변경하지 않았다.
- 최초 연속 render QA: 1080p30 후 다음 출력 대기에서 앱 연결 종료. 이 실행은 FAIL로 `render-qa-attempt1.json`에 보존했다. 로그에서 FPS 변경 debounce와 수동 준비가 중복된 것을 확인해 QA 대기를 보강하고 stdout/stderr/프로세스 종료 증거를 추가했다. **종료의 직접 원인은 확정하지 못했다.** 새 전체 실행의 세 출력과 오디오 export는 통과했다. 장시간 반복 안정성은 별도 검증이 필요하다.
- 앱 종료 시 Chromium GPU state 경고 2건이 stderr에 남았다. startup/runtime renderer exception은 없었지만 이 경고를 없는 것으로 처리하지 않는다.
- 원본 코드의 문자열 startsWith 경로 판정, IPC payload 검증 부족, renderer가 전달하는 파일 경로, loopback frame 서버의 요청 크기/프레임 index 제한 부족은 향후 격리 adapter 설계에서 해결해야 한다. 현재 baseline을 공개 배포하지 않는다.
- 원본 package는 MIT로 선언했으나 전체 앱 라이선스 전문/모든 자산의 권리 문서는 포함되지 않았다. abc_tools는 Apache-2.0 전문이 있으며 Electron/Chromium 고지도 추출물에 보존했다. 최종 재배포 권리 검토와 SBOM은 NOT CHECKED.

## 재사용/제거/리팩터링과 Phase 1

재사용 후보: 실제 검증된 FFT/스펙트럼 그리기, MIDI→ABC 변환, Python JSON-lines worker, FFmpeg 렌더·오디오 변환, progress 이벤트와 stage 복원. 원본 renderer를 신규 UI와 직접 섞지 않는다.

최종 제품에서 제거할 대상: upstream updater, legacy settings migration, 기존 브랜드/아이콘, 자동 runtime 설치 결합. baseline 증거 사본은 보존한다.

리팩터링 대상: 2,000행 이상의 main.js를 media/music/render/storage adapter로 분리, IPC 입력/경로 검증, 전용 worker 수명주기, GPU capability 및 CPU fallback, preview/export 공통 Project Model.

Phase 1 계획: versioned `.ocut` schema, project/media/track/clip 안정 ID, 시간/소스 범위 검증, immutable edit command, undo/redo, 저장/열기/복구 저장의 경계를 구현하고 round-trip 및 손상 파일 검사를 먼저 통과시킨다. 새로운 UI는 Phase 2, timeline vertical slice는 Phase 3 이후다.

## 판정/복구

필수 Phase 0 기준인 복원·package/의존성 확인·baseline build·실제 앱·기본 화면·음악 핵심 기능 접근·startup 예외 확인·inventory 작성은 충족했다. **Phase 0 PASS. 최종 Release NOT READY.**

복구 기준은 원본 EXE SHA-256 및 source-manifest이다. 원본 파일과 기존 설치/설정/곡을 수정하지 않았다. 새 baseline 변경은 별도 Git feature branch에서 관리하며 해당 commit을 다시 빌드할 수 있다. 기존 runtime/모델을 읽어 사용하므로 다른 PC에서 runtime provisioning을 별도 검증해야 한다.
