# Phase 2 — O-CUT Application Shell

신규 Electron 진입점과 독립적인 O-CUT UI를 구현했다. 기존 baseline UI는 수정하지 않았다.

- charcoal/mint 토큰, typography, border/spacing, focus/disabled/error/empty 상태.
- project library / preview / inspector / track 영역. 아직 미디어가 없는 실제 빈 프로젝트로 시작한다.
- project 설정 → history, 저장/열기 → ProjectStore를 연결. 기능이 연결되지 않은 도구 버튼은 노출하지 않는다.
- sandbox=true, contextIsolation=true, nodeIntegration=false. 허용 IPC만 preload에 노출, main frame sender 확인, 새 창/탐색 차단.
- userData `%APPDATA%/O-CUT`; 테스트는 `.runtime/shell-*`로 분리.
- `dist/studio/O-CUT.exe` 패키징 및 실제 실행, UI 검사 4개, 기존 회귀 31개 PASS. 오류/skip/취소 0.
- 1540 및 1100×760 화면 캡처를 직접 검토했다. `evidence/studio/shell-qa.json` 및 `shell-regression.log` 참고.

Native 파일 선택 대화상자의 반환 경로만 QA에서 지정한다. 실제 저장·열기·history·renderer는 제품 코드를 사용했다.

이 단계는 shell PASS이며 timeline 동작/미디어 편집/MP4 출력의 PASS가 아니다. 원본 Electron PE 메타데이터/아이콘 교체와 최종 installer는 아직 남아 있다.
