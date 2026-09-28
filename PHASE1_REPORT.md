# Phase 1 — Project Core 기반

범위: 신규 `.ocut` 데이터와 저장/history 기반. **새 편집 UI 또는 timeline/export 연결 완료를 의미하지 않는다.**

## 구현

- `src/core/project.cjs`: version 1 프로젝트 생성/검증/직렬화. media, 8종 track, clip, source 범위/speed/transform/opacity/volume, effect/keyframe data, canvas/export 설정.
- 중복 ID, 없는 media 참조, 잘못된 track/type, 음원 범위 초과, 잘못된 시간, nonfinite 숫자, 미지원 버전/필드, 위험 객체 키를 거부.
- `src/core/history.cjs`: 검증 후 적용하는 동기 편집 transaction, 독립 snapshot, bounded undo/redo, 문서 identity 보호. 원본 프로젝트나 노출된 snapshot을 수정해도 history 내부 상태가 변하지 않음.
- `src/infrastructure/project-store.cjs`: `.ocut` 저장/열기, 디렉터리 경계와 파일 종류 검사, 16 MiB 제한, lock 파일, SHA-256 etag 기반 충돌 거부, 임시 파일 fsync 후 rename.
- autosave는 원본과 별도 `.recovery.ocut`에 저장. 재시작 시 복구본을 명시적으로 열 수 있음. timer/최근 목록/복구 UI는 후속 구현.
- build는 신규 모듈 3개 문법 검사 및 `dist/core` 배포 사본/해시 manifest 생성. 새로운 runtime dependency 없음.

## 검증

`evidence/phase1/tests.log`: **31 tests / 31 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo**.

- Phase 0 회귀 9개 + Phase 1 22개.
- 저장/업데이트/충돌 거부/손상 파일 보존/동시 저장/독립 복구본/새 service 인스턴스 재열기 포함.
- 실제 `dist/baseline/O-CUT.exe`의 Electron 33.4.11 / Node 20.18.3 런타임에서 두 개의 별도 프로세스로 core 저장 및 재열기 성공. `ELECTRON_RUN_AS_NODE` 방식이며 **새 project UI 실행 검증은 아니다**.
- 빌드 산출물과 현재 소스의 바이트 일치 검사를 포함. `evidence/phase1/build.json`, `electron-storage-smoke.json`에 근거 보존.

## 한계와 경계

- preview/export는 아직 이 모델을 소비하지 않음. 모델이 존재하는 것만으로 timeline 편집, effect, keyframe 재생 기능을 PASS 처리하지 않음.
- history는 Phase 1용 전체 snapshot 방식. Phase 3/10에서 대형 timeline에 맞는 command delta와 성능 검증이 필요.
- 파일 잠금은 이 store를 사용하는 writer 간 협력 잠금이다. 외부 프로그램이 잠금을 무시하는 경우나 적대적인 filesystem race까지 보장하지 않음.
- 저장 중 프로세스 강제 종료 후 남은 lock은 자동 삭제하지 않는다. 실제 실행 중인 writer인지 확인 후 별도 복구 절차가 필요. 전원 차단 fault injection / network share / 새 PC는 NOT RUN.
- dangling media는 파일을 읽기 전 구조 수준 참조만 검사. 실제 존재/codec probe/relink는 media adapter 단계.
- OS 권한/보안 설정, 기존 설치/사용자 데이터, 원본 baseline 모듈은 변경하지 않음.
- 별도 TypeScript/Lint 프로젝트 설정이 없어 Typecheck/Lint는 NOT RUN. JS 문법 검사, 스키마/동작 테스트 및 실제 파일 I/O 검증을 실행했다.

판정: **Phase 1 데이터·저장 기반 검증 PASS. UI 연결 및 이후 제품 Phase는 미구현.**

## Git/복구

Phase 0 checkpoint: `377cc5a04840cfd17d562aff2c540042134469ff` (`rebuild/baseline`).

Phase 1 브랜치: `core/project-engine`. 원본/모델/사용자 곡은 수정하지 않았다. 이 브랜치의 신규 src 및 core 도구를 제거하는 대신 baseline 브랜치에서 기존 검증 상태를 계속 사용할 수 있다. 서버/클라우드/공개 저장소 배포는 수행하지 않았다.
