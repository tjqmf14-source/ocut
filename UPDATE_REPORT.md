# O-CUT 0.12.3 자동 업데이트 검증

2026-10-04: 이 PC의 로컬 개발 채널에 검증된 0.12.3을 서명 발행했다. 설치된 앱은 시작 시와 5분마다 확인하고, 새 버전을 준비한 뒤 정상 종료할 때 적용한다. 사용자가 매번 설치 파일을 실행할 필요가 없다. 저장하지 않은 작업은 저장·취소 확인을 거치며, 즉시 업데이트 후 다시 열기를 지원한다.

## 확인한 결과

- 전체 Studio 19단계, 119/119 자동 검사, 설치 경로 6개, 실제 설치 수명주기 10개 PASS. Windows 등록·시작 메뉴 생성과 제거도 이번 후보로 확인했다.
- 실제 0.11 앱 실행 중 준비 → 종료 후 0.12.3 교체 → 프로젝트·예약 대기열·사용자 추가 파일 보존 → 새 앱 재실행을 확인했다.
- 격리된 미래 버전 시험에서 저장 취소 시 열린 문서를 유지하고, 저장 후 실제 자동 재시작·재열기·대기열 복원을 확인했다. 미래 버전은 QA용이며 배포 채널에 발행하지 않았다.
- 변조된 패키지·서명·junction·이전 버전 거절, 제거 파일 잠금으로 실제 교체 중 실패를 유발한 뒤 이전 앱 복원, 예약한 부모 프로세스 종료 뒤 보조 프로그램 완료를 검사했다.
- 이전 앱과 제거 프로그램 백업을 보존하고 실제 이전 0.11 앱 실행을 확인했다.
- 사용자 설치 연결 상태: **CURRENT**, 기본 앱 폴더·등록이 없는 상태를 확인한 뒤 검증된 설치 파일로 최초 연결했다. 실제 사용자 데이터로 설치 앱을 실행해 최신 버전·업데이트 활성 상태를 확인했다. 기존 음악 관련 파일 11개는 설치와 실행 후에도 해시가 같았다. 보관본은 .runtime/user-data-before-updates-0Aljdh에 있으며 activation.json에 기록했다.

## 정확한 산출물

- 버전: 0.12.3; 앱 소스 체크포인트: 962f8d36704f4531dfed98c756228f51037f6659.
- 설치 파일: D:\O-CUT\artifacts\release\O-CUT-Setup-0.12.3.exe; 199700328바이트.
- 설치 SHA-256: 71346e60bafbc2a5b36629a47d7fc2b8adcfd6d5f30fe82e88ba2b6446c87055.
- ASAR SHA-256: 988342cc32c38342bb81a2f616de1e104231486c9b7d9a5af62068166fe27179.
- 업데이트 manifest SHA-256: 16c7baa3be231e3acd920f39570fcaf95a93394b02cb63fd942b39ca17f4f092.
- 소스 36개; 업데이트 파일 87개.
- 증거: evidence/studio/gate.json, evidence/release/gate.json, evidence/release/installer-qa.json, evidence/updates/qa.json, published.json, bootstrap.json, activation.json.

## 수정과 운영

Windows PowerShell을 Node의 detached 옵션으로 실행하면 이 환경에서 작업 없이 종료되는 오류를 실제 앱 시험에서 발견했다. 독립된 숨김 창을 만드는 Start-Process로 바꾸고, 부모 프로세스가 먼저 끝나도 실제 파일 교체가 완료되는 검사를 추가했다. 이어 Electron의 ASAR 가상 파일 처리 때문에 외부 업데이트 패키지가 폴더로 판정되는 오류를 발견해, 외부 파일 검증은 Electron 내장 original-fs로 실제 바이트를 읽도록 수정했다. 앱 자체에 들어 있는 보조 프로그램은 기존 ASAR 읽기를 유지한다. 이 구분은 [Electron ASAR 공식 문서](https://www.electronjs.org/docs/latest/tutorial/asar-archives)의 실제 파일 체크섬 검증 방식에 따른다. 실제 Electron 안에서 다시 준비 성공을 확인한 뒤 전체 검사를 재실행했다. 추가로 다시 열기를 누른 앱 창까지 숨겨지던 문제를 발견해, 보조 프로그램은 숨김으로 유지하고 명시적으로 요청한 앱 재시작만 정상 창으로 표시하도록 수정했다. 실제 창 표시도 재확인했다. 0.12.0·0.12.1·0.12.2 후보는 발행하지 않았고 수정한 0.12.3을 발행했다. 실패 기록은 evidence/updates/failure-0.12.1.json과 failure-0.12.2.json에 보존했다.

새 빌드 발행은 version.json의 버전을 올린 후 npm run build:update로 수행한다. 전체 기능·설치·업데이트 시험을 통과한 정확한 파일만 로컬 채널에 서명 발행한다. 공개키는 앱에 고정되고 개인키는 .runtime 아래에만 있으며 Git·소스 ZIP·앱에 포함하지 않는다. 새 키 파일과 폴더의 ACL은 현재 사용자·SYSTEM·Administrators만 허용하도록 보호했고 발행 시마다 검사한다. 새 npm/Python 의존성, 모델 다운로드, 유료 서비스, 외부 게시 없음. npm 개발 의존성 audit 0건이며 Electron/FFmpeg 전체 공급망 안전성을 의미하지 않는다.

## 복구와 범위

업데이트는 설치 폴더 안에 검증된 새 앱을 준비하고 이전 앱·제거 프로그램·설치 정보를 backup-update-*에 보관한다. 교체 오류 시 이전 상태를 복원한다. 백업을 자동 삭제하지 않으며, 필요하면 백업의 app/O-CUT.exe를 실행한다. 사용자 프로젝트·생성 음악·모델·앱 데이터는 업데이트 payload 대상 밖이다.

현재 채널은 D:/O-CUT/artifacts/updates에 있는 이 PC 전용 채널이다. 인터넷 자동 배포·다른 PC 업데이트는 제공하지 않는다. D:/O-CUT을 옮기거나 삭제하면 새 버전 확인이 중단된다. 실행 중 앱을 강제 종료하지 않는다. Windows Authenticode 서명, 새 PC/VM, 정전·디스크 부족·장시간 업데이트 스트레스: NOT RUN. 공개 원격 CI: NOT RUN. MIDI/ABC·GPU 영상 출력·런타임 갱신은 이번 범위 밖이다.

공식 참고: [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater), [Windows Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-7.5). 이 NSIS 로컬 설치 구조에는 별도의 검증·교체 경로를 구현했다.
