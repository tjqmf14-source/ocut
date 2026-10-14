# O-CUT 0.16.0 기본 편집 반영 — 2026-10-14

선택한 기본 편집 우선 범위의 개선을 실제 설치 앱에 반영하고 재실행했습니다. CapCut의 전체 기능 복제는 완료하지 않았습니다.

## 변경

- 좌우 트림·속성창 길이 변경 시 선형/홀드 키프레임의 남은 움직임과 원본 시간 대응 유지. 128개 키프레임의 확장·분할 경계 오류 수정.
- 선택한 여러 클립의 동시 분할(Ctrl+B / S), 간격을 유지하는 복제(Ctrl+D), 잠기지 않은 클립 선택(Ctrl+A), 한 번의 실행 취소.
- 앞/뒤 자르기 버튼, 트림 스냅(Alt로 일시 해제), Escape/포인터 취소. 겹친 삭제 구간을 중복 계산하지 않는 리플 삭제.
- 기존 미출고 직접 화면 이동·크기·회전, 타임라인 키프레임, 오디오 페이드 기능을 함께 검증해 출고.
- FFmpeg 9.0 지연 오디오의 NOPTS 문제를 샘플 기준 시간 재생성으로 수정. 출력 오디오의 시작과 길이를 검사.

## 검증

| 항목 | 결과 |
|---|---|
| 전체 단위 테스트 | 161/161 PASS, fail/cancelled/skipped/todo 0 |
| Studio 전체 게이트 | 26단계 PASS, 동일 ASAR |
| 실제 편집/오디오/저장 후 재실행 | 8개 검사 PASS, renderer 오류 0 |
| 실제 MP4 화면 | 전체 디코딩 PASS, 미리보기 SSIM 0.997155 |
| 실제 MP4 오디오 | 유효한 시간·전체 길이·페이드·클립 밖 무음 PASS |
| 격리 실제 업데이트 | PASS |
| 설치 앱 활성화 | 0.14.1 → 0.16.0 PASS |
| 설치 파일 무결성 | 86개 파일 manifest 일치 |
| 사용자 자료 보존 | 2개 보호 파일 SHA-256 일치 |
| 전체 Windows 설치/등록 게이트 | BLOCKED; 기존 등록을 보존하므로 신규 등록/제거 NOT RUN |

소스 커밋: 2711544d9d9b22fd4c0451540ccb22bb03a35c04

ASAR SHA-256: 788374fd608be0251be70d0b246c5db3ae6e16cdf3cdb872d80dbcb6929bb5e6

설치 후보: D:\O-CUT\artifacts\release\O-CUT-Setup-0.16.0.exe

설치 SHA-256: 9339ad0336858c51286d06bf78863699697f7438bc65fdcdbced2390342ef999

## 제한과 복구

CapCut 설치본의 지역화·설정·PE 리소스에서 기능 표기를 조사했습니다. CapCut 실제 실행·네이티브 엔진 디컴파일·전체 기능 동등성은 NOT CHECKED/NOT RUN입니다. AI/클라우드·서버 효과 카탈로그, 속도 곡선·광학 흐름·추적·배경 제거 등은 이번 구현 범위에 포함하지 않았습니다. 페이드·질감·전환을 가진 클립의 분할 제한은 유지됩니다.

의존성 추가·제거는 없습니다. CapCut 코드·모델·폰트·아이콘·효과 에셋을 이식하지 않았습니다. Windows 등록·다른 설치·서명키는 변경하지 않았고 외부 발행은 하지 않았습니다.

검증 중 출력 오디오 오류를 재현해 수정했으며, 텍스트 편집 테스트의 일회 실패에는 진단과 테스트 창 격리를 추가했습니다. 수정 후 전체 게이트를 다시 통과했습니다. 실제 설치 전달 관측 스크립트에서는 비동기 준비 상태를 기다리는 방식, 도우미의 waiting 상태 판정 및 SHA-256 대소문자 표현을 바로잡고 설치·백업·자료 해시를 재검증했습니다. REA MCP 실패는 없었습니다. 전체 CapCut 실행 검증은 기능 표기 조사와 독립 구현을 우선한 이번 범위에서 NOT RUN입니다. 별도 formatter/linter 설정은 없어 NOT RUN이며, 모든 앱 JavaScript 모듈의 node --check는 빌드에서 실행했습니다.

이전 설치 백업: C:\Users\tjqmf\AppData\Local\Programs\O-CUT\backup-update-0.14.1-981a17fbed9c4420ac26fd007753bf5c

편집 전 기존 변경 백업은 이 채팅의 work/ocut-before-capcut에 보존했습니다. 앱 적용은 정상 종료 경로를 사용했고 미저장 작업을 강제로 종료하지 않았습니다. 사용자 자료는 별도 보호 파일 해시로 확인했습니다.

근거: D:/O-CUT/evidence/studio/gate.json, timeline-editing-qa.json, evidence/updates/qa.json, installed-delivery.json, evidence/release/gate.json.
