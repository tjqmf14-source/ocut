# O-CUT 아키텍처

## 색 보정과 전환

`color-filters.js`는 고정된 8개 수치 설정을 검증하고 8비트 RGBA 배열을 결정적으로 처리한다. exposure/brightness/contrast와 temperature/tint를 계산한 뒤 luma 기반 saturation/highlight/shadow를 적용하며 alpha를 유지한다. neutral은 바이트를 변경하지 않는다. renderer의 source별 WeakMap은 설정·크기·currentTime·seeking 상태로 중간 Canvas를 캐시한다. seek 시작 시 이전 영상 픽셀을 새 시점의 완료 캐시로 잘못 재사용하지 않는다.

`transitions.js`는 clip-local time과 길이로 opacity/x/scale/wipe/blur를 계산한다. 공통 paintVisual이 효과를 합성하고 paintClip 또는 visualizer에 전달한다. schema는 visualTransition/colorCorrection의 중복·미지원 clip·수치 범위를 검사한다. 출력은 기존 alpha 프레임 경로를 사용하며 같은 파이프에서 keyframe과 결합한다.

디졸브 명령은 경계가 붙은 같은 트랙 두 클립과 길이를 검증한 뒤 현재/뒤 클립을 overlap 길이만큼 이동하고 incoming fade를 하나의 transaction으로 추가한다. outgoing을 함께 fade하지 않아 두 alpha를 곱해 어두워지는 dip을 방지한다. 같은 트랙은 preview/render 모두 시작 시간 오름차순으로 합성한다. 다른 트랙·원본 범위·오디오 envelope를 자동 변경하지 않는다.

## 키프레임

`core/keyframes.js`가 x/y/scaleX/scaleY/rotation/opacity/volume의 범위·선형/hold 보간·분할 경계값을 소유한다. 모든 시간은 clip-local이며 첫/마지막 값 밖은 상수이다. schema에서 미지원 속성과 비정상 값을 거부하고 timeline의 set/delete/clear 명령을 history transaction으로 처리한다. 기본 transform/opacity/volume은 보존하고 평가할 때만 사본에 보간값을 반영한다.

시각적 키프레임이 있으면 기존 alpha MOV 프레임 출력을 재사용한다. 공통 `paintClip`으로 비디오/이미지/텍스트를 그리고 시각화도 같은 보간값을 받는다. 출력 전용 media element를 별도 Map에 보관해 미리보기 seeked 이벤트와 경합하지 않으며 성공/실패/취소 종료 시 해제한다. baked visual에 원본 음성이 들어 있지 않으므로 비디오의 음성은 별도 입력으로 정확히 한 번 믹스한다.

볼륨은 clip-local t를 사용하는 FFmpeg volume eval=frame 수식으로 전달하며 atempo 다음, fade·delay 앞에서 적용한다. 128개 지점의 수식은 균형 잡힌 덧셈 트리로 구성한다. FFmpeg의 [공식 수식 처리 코드](https://github.com/FFmpeg/FFmpeg/blob/master/libavutil/eval.c)는 연산 트리 깊이를 제한하므로 단순 중첩 if나 일렬 덧셈을 피했다. 실제 FFmpeg 경계 검사와 출력 PCM 배율을 확인한다.

## 텍스트 서식과 로컬 STT

`core/text-style.js`가 검증된 글꼴·색상·수치와 프리셋을 소유한다. text/subtitle clip의 단일 `textStyle` effect에 저장하며 임의 CSS/HTML은 받지 않는다. renderer `text.js`의 Canvas 그리기를 미리보기와 출력 PNG가 공유한다. 이전 서식 없는 문서는 기본 외관을 유지한다. 서식은 정규화해 비교한 뒤 동일 서식 자막만 병합한다.

`infrastructure/transcribe.cjs`는 허용된 media ID를 클립에 연결하고 트림/속도를 적용한 16 kHz mono PCM을 FFmpeg로 만든다. `transcribe.py`는 별도 Python 프로세스에서 offline/local_files_only/safetensors Whisper 모델로 인식하고 timestamp JSON Lines를 반환한다. 시작·종료 시 원본 fingerprint를 확인하고 시간/텍스트 범위를 검증한 뒤 하나의 captions transaction을 적용한다. 자막은 잠기지 않은 자막 트랙에 추가하며, 해당 트랙이 없으면 생성한다. 기존 구간을 덮어쓰지 않아 반복 인식 시 겹칠 수 있다.

STT 작업은 30분 클립/20분 실행 제한이다. 음악 생성과 GPU를 동시에 점유하지 않는다. 취소 controller는 인증된 IPC 접수 즉시 만들어 직렬 queue 대기·사전 probe 중 취소도 처리하고, 적용 직전에도 확인한다. 실제 Python/FFmpeg 프로세스 종료 후 취소 완료를 알린다. private 작업 폴더에는 결과/오류 로그를 남기며 PCM은 finally에서 제거한다. Python 코드는 ASAR 밖 resources/transcribe에 복사하며 패키지 검사가 소스와 바이트 동일성을 확인한다. 기존 모델과 Python 환경은 읽기만 하며 자동 설치는 없다.

## 검증된 출발점

`baseline/`은 복원 및 검증을 위한 경계입니다. 신규 제품 코드는 `src/`에 분리하고 필요한 처리 모듈만 adapter를 통해 가져옵니다. 원본 updater 및 legacy 사용자 데이터는 제품 경계를 넘기지 않습니다.

## 목표 구조

- Core: Project → Timeline → History. 순수 데이터와 편집 명령, 직렬화 가능한 `.ocut` 문서.
- Playback: HTML media + Canvas/Web Audio, 공통 project 상태를 시간에 따라 평가.
- Media/Audio: import/probe, 파형/썸네일 cache와 background worker.
- Music adapter: 보존한 Python worker의 JSON-lines 요청/응답, 생성 asset을 media로 등록.
- Render adapter: 동일 project 문서를 검증한 뒤 FFmpeg 계획으로 변환, preview와 같은 시간/transform 규칙 사용.
- Infrastructure: 제한된 IPC, canonical path 검증, 프로젝트 저장, autosave/recovery, 오류 전파 및 capability 감지.

`.ocut`는 원본 곡 폴더 모델과 독립된 versioned 포맷으로 구현합니다. 미디어는 참조이며 저장 시 임의 파일을 실행하거나 외부 주소로 업로드하지 않습니다. 모델과 native runtime의 설치/갱신은 편집기 기동과 분리합니다.

Preview/Render 구현이 들어오기 전 데이터 계층 테스트만으로 영상 편집 기능을 PASS 처리하지 않습니다.

## Phase 1 구현 경계

`project.cjs`가 schema와 직렬화의 권위이며 `history.cjs`는 검증된 프로젝트 snapshot만 소유합니다. `project-store.cjs`는 OS 파일 I/O와 concurrency를 담당합니다. 세 모듈은 원본 Electron renderer/Python worker를 import하지 않습니다.

Document version은 schema 호환성, revision은 메모리 편집 순서, etag는 저장 파일의 바이트 변경을 나타냅니다. 미래 schema를 추측해 변환하지 않고 거부합니다. 단일 프로세스 history의 full snapshot은 초기 검증에 유리하지만 대형 timeline에서 메모리 비용이 있으므로 향후 측정 후 command delta로 전환합니다.

현재 main-side session이 프로젝트와 파일 저장을 소유하고 제한된 preload IPC로 편집 명령을 받습니다. 프로젝트를 열 때 로컬 미디어를 FFprobe/FFmpeg로 분석하며 다운로드나 프로젝트 내부 코드 실행은 하지 않습니다. renderer에는 임의 filesystem 함수를 노출하지 않습니다.

## Studio 편집/출력 구현

`timeline.cjs` 명령은 History transaction에서 전체 프로젝트 검증을 거칩니다. renderer는 키가 같은 클립 DOM을 유지하고 재생 시 playhead/Canvas만 갱신합니다. 파형은 FFmpeg로 읽은 실제 PCM의 시간별 peak를 캐시합니다. 미디어 ID를 허용 목록으로 검사하는 `ocut-media` 프로토콜이 등록된 파일만 읽습니다.

Preview는 HTMLVideoElement/Image, Canvas, Web Audio를 사용합니다. Export는 main이 가진 프로젝트 snapshot을 `render-plan.cjs`에 전달합니다. renderer에서 별도 출력용 타임라인을 만들지 않습니다. 텍스트는 `text.js`의 공통 Canvas 그리기를 사용해 투명 레이어로 만들고 FFmpeg가 트랙 순서대로 합성합니다. 미디어 trim/speed/transform와 오디오 mute/solo/volume은 동일 프로젝트 필드에서 읽습니다.

FFmpeg는 shell 없이 인수 배열로 실행합니다. 필터는 생성한 파일로 전달하고 사용자 텍스트는 필터 문법에 삽입하지 않습니다. 결과는 임시 파일로 출력한 뒤 실제 metadata를 검사하고 대상 파일 변경 여부를 확인한 후 교체합니다. 취소 IPC는 출력 작업의 직렬 queue를 기다리지 않고 프로세스를 중단합니다. 작업 snapshot/filter/log는 앱 데이터의 exports 폴더에 보존합니다.

공식 참고: [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol), [FFmpeg filter graph](https://ffmpeg.org/ffmpeg-filters.html), [FFmpeg 파일 인수 옵션](https://ffmpeg.org/ffmpeg.html#Options).

## 문서 자동 저장과 복구

`Workspace`는 session과 분리된 개인 복구 저장소와 최근 목록을 관리한다. main의 성공한 문서 IPC 후 dirty snapshot을 복제하고 1초 간격으로 최신 revision을 직렬 저장한다. 상대 미디어 경로는 원래 문서 위치 기준 절대 경로로 바꾼다. 저장 완료 이벤트는 실제 durable revision을 포함하므로 후속 편집의 저장 완료로 오인하지 않는다.

각 앱 인스턴스는 임의 UUID 복구 파일과 etag를 소유한다. 기존 ProjectStore의 검증·원자적 저장을 재사용한다. 정상 저장/폐기 후 소유 파일과 사용자가 선택한 복구 파일만 etag 확인 후 정리한다. 복원은 파일 위치가 없는 새 dirty session으로 구성하고, 미디어 준비 후 session을 교체한다. 최근 목록은 크기·행 수·절대 경로를 검사하고 임시 파일의 fsync/rename으로 저장한다. 자동 저장 실패는 원래 파일과 메모리 문서를 보존하며 다음 편집에서 재시도한다.

## 자막과 미디어 탐색

`captions.cjs`는 SRT/VTT 시간·본문을 순수 데이터로 해석하고 SRT를 직렬화한다. `caption-files.cjs`는 UTF-8 검증, 제한된 크기 읽기, 임시 파일·fsync·rename 저장을 담당한다. 타임라인에 subtitle 클립을 추가하는 작업은 하나의 history transaction이다. `.ocut` v1의 기존 subtitle/text/transform 필드를 사용하므로 포맷 변경이나 migration은 없다. 자막 파일의 글꼴·CSS·화자·영역 설정은 코드나 HTML로 실행하지 않는다.

`media-response.cjs`는 허용된 미디어 ID가 가리키는 파일에 200/206, Content-Length, Content-Range, Accept-Ranges를 명시한다. Electron의 file URL fetch는 부분 바이트를 반환하면서 200과 범위 헤더 없는 응답을 전달할 수 있어 기존 단순 중계 방식에서 영상 탐색 문제가 재현됐다. 현재 구현은 요청한 범위만 파일 스트림으로 읽고 범위 오류는 416으로 반환한다.

자막 시간/구문 참고: [W3C WebVTT](https://www.w3.org/TR/webvtt1/). 전체 WebVTT 스타일/배치 호환성을 구현한 것은 아니며 미지원 설정은 가져오기 결과에서 알린다.

## 로컬 음악 생성과 오디오 페이드

`MusicService`는 프로젝트 session과 분리된 작업 수명과 private 출력 폴더를 소유한다. 제한된 preload 입력을 검증하고 보존한 worker를 shell 없이 실행한다. stdout JSON Lines를 UTF-8 스트림으로 읽으며 실제 ready/stage/progress/done/error 이벤트만 UI에 전달한다. Worker의 반환 경로를 신뢰해 열지 않고 main이 만든 작업 ID 폴더의 audio.wav만 FFprobe로 확인한다. 완료 기록의 ID로 음원을 가져와 media와 music clip을 하나의 history transaction에 추가한다. Renderer의 일반 편집 IPC로 임의 media 객체를 삽입하는 경로는 차단한다.

생성은 한 번에 하나, 별도 worker 프로세스로 실행한다. 취소 IPC는 직렬 편집/출력 queue를 우회하며 협력 취소 후 5초 내 종료, 전체 작업은 30분 제한이다. 완료/실패 시 worker를 종료한다. 기존 모델은 offline 환경으로 연결하며 모델·Python·기존 사용자 곡은 변경하지 않는다. 작업 기록은 O-CUT userData/music에 저장하고 앱 재시작 때 남은 실행 상태를 중단으로 표시한다. 기존 MIDI/ABC·score-only·batch UI는 아직 Studio에 이관하지 않았다.

`.ocut` v1의 effect 확장 슬롯에 검증된 audioFade(fadeIn/fadeOut)를 저장한다. `audio-fades.js`의 동일한 유효 길이 계산을 Web Audio gain과 FFmpeg afade에 사용한다. speed 적용 이후, timeline delay 이전에 fade를 적용하므로 입력값은 출력 타임라인의 초이다. 두 fade의 겹침은 곱셈이며 미지원 효과/키프레임은 기존처럼 export에서 명시적으로 거절한다. 페이드 클립의 분할은 아직 거절하고 UI에서 먼저 0으로 설정하도록 안내한다.

## 소스 오디오 시각화

원본 `baseline/electron/spectrum-analysis.js`를 바이트 그대로 `src/core/spectrum-analysis.cjs`에 재사용한다. 해당 파일의 주석은 출처 설명이며 새 작업 지시로 사용하지 않는다. 단위 검사에서 보존 파일과의 동일성을 확인한다. 별도 Node worker thread가 24 kHz mono PCM 파일을 창 단위로 읽고 Hann FFT를 계산한다. FFT 128대역(20–12000 Hz), wave 64구간을 30fps Float32 데이터로 저장한다. 소스 fingerprint와 분석 버전으로 캐시를 구분하고 용량/metadata/유한 수치/범위를 검증한다. 최대 소스 길이는 600초이며 메인 UI 스레드에서 FFT를 계산하지 않는다.

`overlay` 트랙의 clip에 `audioVisualizer` effect와 source media ID를 저장한다. schema는 오디오/영상 source, 설정 범위와 중복 effect를 검증한다. 오디오 overlay에는 visualizer가 필수다. `.ocut` v1의 확장 슬롯을 사용하되 이전 앱은 새 effect를 렌더하지 못하며 명시적으로 거절한다. Preview/Export는 `visualizer.js`의 source-time sampling, smoothing, draw 함수를 공유한다. 랜덤 수치, live analyser, wall-clock animation을 사용하지 않는다.

Preview는 기존 Canvas에 그린다. Export는 동일 프로젝트 snapshot과 source data로 PNG 프레임을 하나씩 pipe에 쓰고 alpha QTRLE MOV를 만든 뒤 FFmpeg graph에 full-frame overlay로 넣는다. transform/opacity를 두 번 적용하지 않으며 visualizer source의 음성은 중복 mix하지 않는다. PNG 전달은 스트림 backpressure를 따르고 취소 시 임시 encoder를 중단한다. 출력 합성 단계 전 진척도 0–25%를 할당한다. 중간 레이어는 export 작업 폴더에 남는다.

음악 영상 생성은 기존 문서 폐기/저장 동의를 앱에서 처리한 뒤 새 session을 구성하고 성공한 경우에만 교체한다. 기본 canvas background, title, audio clip, visualizer와 fade가 만들어지며 모두 기존 timeline 명령으로 편집 가능하다. 시각화는 원음에 연결된 독립 clip이며 오디오 mix/track mute를 자동으로 따라가는 모드는 아니다.
