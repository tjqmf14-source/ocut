# O-CUT 0.14.1 자동 업데이트 — 2026-10-09

설치된 앱 0.14.0 → 0.14.1 자동 업데이트 적용과 실제 사용자 데이터 재실행을 확인했다. 설치 파일 86개와 기존 사용자 자료 22개 해시가 일치한다. 설치 앱의 음악 폴더 버튼과 완료된 곡 폴더 버튼도 실제 OS shell 호출에서 오류 없이 반환됐다.

133/133 검사·Studio 23단계 PASS. 기존 Windows 등록·시작 메뉴를 보존하므로 신규 등록/제거 2개 시나리오는 NOT RUN, 전체 설치 Gate BLOCKED. 별도 로컬 업데이트 Gate는 PASS.

설치 파일: D:\O-CUT\artifacts\release\O-CUT-Setup-0.14.1.exe (199716562바이트).

설치 SHA-256: 4a768e642a24907123d2f91c74219ffa4fd82e6ac44211c995f2ea1d076201cf.

ASAR SHA-256: b676a9a69d5b95bc714e0cd37acc9edad4ddd582f96128e47692ea3ab8123ce9.

업데이트 manifest SHA-256: b59b9fe116982d3d353ea52fd3a3044d061aad241eb43bcb807cb7ff0d9578c0.

앱 소스 커밋: b32c2021590822027576c079775c4fd2bbef89c3.

복구: 이전 앱: C:\Users\tjqmf\AppData\Local\Programs\O-CUT\backup-update-0.14.0-f65c0b484b0d470db61aed651d95c417. 사용자 자료: D:\O-CUT\.runtime\user-data-before-navigation-update-WY4vN9.

기능·검증 범위·미검증 항목: [생성 상태와 타임라인 보고서](PROGRESS_NAVIGATION_REPORT.md). 아래는 이전 버전 이력이다.

## O-CUT 0.14.0 자동 업데이트 검증

2026-10-06: 설치된 앱 0.13.0→0.14.0 자동 업데이트 적용 완료. 실제 사용자 데이터로 재실행해 9개 도구 탭·항상 보이는 가사창·연주곡 체크·16개 장르·7분·기본 10곡을 확인했다. 설치 파일 86개와 기존 사용자 자료 11개 해시가 일치한다.

Studio 전체 21단계·128/128 검사(실패·취소·skip·todo 0), 경로 보호 6개·격리 설치 8개, 실제 앱 교체/저장 취소/저장 후 재시작/이전 앱 실행 6개 흐름을 통과했다. 기존 Windows 등록·시작 메뉴를 보존하므로 신규 등록/제거 2개 시나리오는 NOT RUN, 전체 설치 Gate BLOCKED. 별도의 실제 로컬 업데이트 Gate는 PASS.

화면 검사는 1100·1366·1920 너비의 세 배치, 키보드 탐색, 크기 저장, 가사 보관/연주곡 제외, 수동 프롬프트 보호, 질감·장식·텍스트·전환의 실제 저장/재열기와 MP4 전체 디코딩을 포함한다. 음원은 실제 419.998667초 연주곡, 서로 다른 시드의 짧은 곡 10개와 한국어 가사 요청 1개를 생성했다. 보컬 요청의 구간/가사 텍스트가 worker 메타데이터에 정확히 전달되고 WAV가 비무음으로 디코딩됨을 확인했다. 발음/전체 가사 정확도와 음악적 완성도 판정은 아니다.

## 정확한 산출물과 복구

설치 파일: D:\O-CUT\artifacts\release\O-CUT-Setup-0.14.0.exe (199669303바이트).

설치 SHA-256: f38b2f51cd10bf6b8b51bb519e57e3ba0860a346bb6666ef7d65e5952133bd0d.

ASAR SHA-256: c1c934c1e4fadb2657a9e630d06647fcbcd84c308b0f9869c50732c58359897a.

업데이트 manifest SHA-256: 51914b451e730988eaf17fa436c0e39ec24e05caf638fd2d3c1cf31a35ec18aa.

앱 소스 체크포인트: f207a2ec7f3aba1d782c5e75caf2ab25ff34d80c.

이전 앱: C:\Users\tjqmf\AppData\Local\Programs\O-CUT\backup-update-0.13.0-4bf6217128384ac7a76377c4e1951416. 사용자 자료 체크포인트: D:\O-CUT\.runtime\user-data-before-editor-update-32ES3E.

근거: evidence/studio/gate.json, workspace-editor-qa.json, music-composer-qa.json; evidence/release/gate.json, installer-qa.json; evidence/updates/qa.json, published.json, editor-delivery.json. 과거 실패 시도 로그는 보존했으며 현재 결과는 이번 후보 해시와 일치하는 gate.json을 기준으로 한다.

로컬 채널만 사용하며 기존 개인키·서명·해시·정상 종료 후 교체 경로를 유지했다. 사용자 앱 강제 종료·재설치·음악/모델 삭제, 새 외부 의존성·API 비용·타사 유료 장식은 없다. 공개 배포·원격 CI·새 PC/VM·Windows Authenticode·정전·디스크 부족은 NOT RUN이다. 긴 4K 질감 영상 성능, 7분 곡 10개 연속 생성, 장시간 보컬 및 가사 청음/전사 정확도 검사는 NOT RUN이다. texture 효과가 있는 새 프로젝트를 이전 앱에서 출력하는 것은 지원하지 않으므로 복구 시 프로젝트 사본을 보존한다.

아래는 이전 버전 이력이다.

## 0.13.0 자동 업데이트 검증 이력

2026-10-04 서명 발행, 2026-10-05 사용자 설치 적용 완료. 기존 0.12.3 앱을 실행해 자체 업데이트 확인·준비 후 깨끗한 창을 정상 종료했고, 보조 프로그램이 0.13.0으로 교체했다. 새 앱을 실제 사용자 데이터로 다시 열어 버전과 새 음악 화면을 확인했다. 최초 연결 스크립트나 설치 파일을 다시 실행하지 않았다. 기존 사용자 앱이 실행 중이면 그대로 두도록 사전 확인했으며 검사 시 실행 중인 사용자 앱은 없었다.

- Studio 20단계·124/124 검사 PASS. 실제 419.998667초 연주곡 1개와 서로 다른 시드의 짧은 곡 10개 생성·전체 디코딩을 확인했다.
- 장시간 GPU 검사만 동일 ASAR·원본 worker·어댑터·검사 스크립트 및 11개 WAV 해시를 새로 확인해 정확히 같은 산출물의 결과를 재사용했다. 나머지 전체 회귀·설치·업데이트 검사는 후보에서 실행했다.
- 경로 보호 6개·격리 설치 8개 PASS. 기존 사용자 Windows 등록을 보존하므로 신규 등록/제거는 NOT RUN, 전체 release Gate는 BLOCKED다. 검증된 이 PC의 로컬 업데이트 범위만 발행했다.
- 격리된 실제 0.11→0.13.0 교체, 저장·취소, 미래 버전 시험에서 실제 자동 재시작, 대기열·프로젝트 보존, 이전 앱 실행 등 6개 흐름 PASS. 미래 버전 0.13.1은 테스트용이며 발행하지 않았다.
- 실제 설치: 0.12.3→0.13.0, 상태 applied/current. 설치 파일 86개 해시 일치, 기존 음악 관련 파일 11개 보존. 바탕화면 바로가기의 기존 대상 경로도 유지한다.

## 정확한 산출물과 복구

- 앱 소스 체크포인트: 72c79943f1b1b7182de1040bc2bb9f9fc0b72e96.
- 설치 파일: D:\O-CUT\artifacts\release\O-CUT-Setup-0.13.0.exe; 199745841바이트; SHA-256 6642154550f37a00086ea44b1554d461ca937a42ad4663a11cd0ec129cde9083.
- 앱 ASAR SHA-256: 1cf5fe25abffe19407e79e1b4774ebbea167eff91591fe88ed23cc48e341a988.
- 업데이트 manifest SHA-256: a9edfd0ebb2fdf84b05e77700d8906a59c418e3a25db49fba213f812cdf3f1bd; 파일 88개.
- 이전 앱·제거 프로그램 백업: C:\Users\tjqmf\AppData\Local\Programs\O-CUT\backup-update-0.12.3-e81d737850844d15bd02d69490f06b15.
- 사용자 자료 체크포인트: D:\O-CUT\.runtime\user-data-before-music-update-ifl4s4.
- 증거: evidence/studio/gate.json, music-composer-qa.json; evidence/release/gate.json, installer-qa.json; evidence/updates/qa.json, published.json, activation.json, music-delivery.json.

현재 PC의 D:/O-CUT/artifacts/updates 로컬 채널만 사용한다. 기존 개인키 보호·서명·해시 검증과 정상 종료 후 적용 경로를 유지한다. 새 의존성·모델 다운로드·유료 서비스·외부 게시는 없다. 과거 앱과 사용자 자료를 삭제하지 않는다. 복구가 필요하면 백업 안 app/O-CUT.exe를 실행할 수 있다.

7분 곡 10개 연속 생성·7분 표준/보컬 품질·전체 청음 평가는 NOT RUN이다. 원격 CI·새 PC/VM·Windows Authenticode·정전·디스크 부족·장시간 업데이트 스트레스는 이번 범위 밖이며 NOT RUN이다. 아래는 이전 버전의 이력이다.

## 0.12.3 자동 업데이트 검증 이력

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
