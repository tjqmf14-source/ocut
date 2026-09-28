# 변경 이력

## Phase 1 기반 — 2026-09-28

- `.ocut` v1 데이터 모델/검증/직렬화 구현.
- 독립 snapshot 기반 undo/redo와 문서 identity 보호.
- 원자적 파일 저장, etag 충돌 검사, 복구본 저장/재열기 구현.
- 31개 회귀/기능 검사 및 별도 Electron 프로세스 저장 smoke 통과.
- 신규 UI 연결 및 timeline/export adapter는 후속 단계로 명시.

## Phase 0 — 2026-09-28

- 설치 파일 정적 추출, ASAR 21개 파일 SHA-256 대조 복원.
- 격리 baseline 및 재현 가능한 source repack 도구 추가.
- 기존 사용자 데이터 이관과 원 제품 업데이트 실행 차단.
- 로컬 AI 20초 WAV 생성, 실제 앱 재실행 복원 검증.
- 기존 영상 UI로 1080p30/1080p60/4K30 출력 및 전체 decode 확인.
- 기능 inventory, 실패 이력, 재사용 후보 및 후속 계획 기록.
