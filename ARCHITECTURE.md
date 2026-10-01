# O-CUT 아키텍처

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

## 자막과 미디어 탐색

`captions.cjs`는 SRT/VTT 시간·본문을 순수 데이터로 해석하고 SRT를 직렬화한다. `caption-files.cjs`는 UTF-8 검증, 제한된 크기 읽기, 임시 파일·fsync·rename 저장을 담당한다. 타임라인에 subtitle 클립을 추가하는 작업은 하나의 history transaction이다. `.ocut` v1의 기존 subtitle/text/transform 필드를 사용하므로 포맷 변경이나 migration은 없다. 자막 파일의 글꼴·CSS·화자·영역 설정은 코드나 HTML로 실행하지 않는다.

`media-response.cjs`는 허용된 미디어 ID가 가리키는 파일에 200/206, Content-Length, Content-Range, Accept-Ranges를 명시한다. Electron의 file URL fetch는 부분 바이트를 반환하면서 200과 범위 헤더 없는 응답을 전달할 수 있어 기존 단순 중계 방식에서 영상 탐색 문제가 재현됐다. 현재 구현은 요청한 범위만 파일 스트림으로 읽고 범위 오류는 416으로 반환한다.

자막 시간/구문 참고: [W3C WebVTT](https://www.w3.org/TR/webvtt1/). 전체 WebVTT 스타일/배치 호환성을 구현한 것은 아니며 미지원 설정은 가져오기 결과에서 알린다.

## 로컬 음악 생성과 오디오 페이드

`MusicService`는 프로젝트 session과 분리된 작업 수명과 private 출력 폴더를 소유한다. 제한된 preload 입력을 검증하고 보존한 worker를 shell 없이 실행한다. stdout JSON Lines를 UTF-8 스트림으로 읽으며 실제 ready/stage/progress/done/error 이벤트만 UI에 전달한다. Worker의 반환 경로를 신뢰해 열지 않고 main이 만든 작업 ID 폴더의 audio.wav만 FFprobe로 확인한다. 완료 기록의 ID로 음원을 가져와 media와 music clip을 하나의 history transaction에 추가한다. Renderer의 일반 편집 IPC로 임의 media 객체를 삽입하는 경로는 차단한다.

생성은 한 번에 하나, 별도 worker 프로세스로 실행한다. 취소 IPC는 직렬 편집/출력 queue를 우회하며 협력 취소 후 5초 내 종료, 전체 작업은 30분 제한이다. 완료/실패 시 worker를 종료한다. 기존 모델은 offline 환경으로 연결하며 모델·Python·기존 사용자 곡은 변경하지 않는다. 작업 기록은 O-CUT userData/music에 저장하고 앱 재시작 때 남은 실행 상태를 중단으로 표시한다. 기존 MIDI/ABC·score-only·batch UI는 아직 Studio에 이관하지 않았다.

`.ocut` v1의 effect 확장 슬롯에 검증된 audioFade(fadeIn/fadeOut)를 저장한다. `audio-fades.js`의 동일한 유효 길이 계산을 Web Audio gain과 FFmpeg afade에 사용한다. speed 적용 이후, timeline delay 이전에 fade를 적용하므로 입력값은 출력 타임라인의 초이다. 두 fade의 겹침은 곱셈이며 미지원 효과/키프레임은 기존처럼 export에서 명시적으로 거절한다. 페이드 클립의 분할은 아직 거절하고 UI에서 먼저 0으로 설정하도록 안내한다.
