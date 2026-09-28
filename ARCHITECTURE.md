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

프로젝트를 읽는 것만으로 media 실행/다운로드 또는 코드 실행을 하지 않습니다. 저장은 main-side adapter가 소유할 예정이며 renderer에 임의 filesystem 함수를 노출하지 않습니다. 실제 IPC 연결은 아직 구현하지 않았습니다.
