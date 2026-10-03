# Windows 설치 후보 — O-CUT 0.10.0

2026-10-03 최종 후보는 **96/96 자동 검사(실패·skip·취소·todo 0)**, **설치 경로 6개** 및 **실제 설치 9개 시나리오**를 통과했다. 설치본에서 시스템 PATH의 FFmpeg와 Python 없이 실제 영상/음원 import, 텍스트 편집, 프로젝트 저장, 1920×1080 30fps H.264/AAC MP4 출력과 전체 decode를 확인했다.

설치 파일은 199,670,447바이트(약 200MB), payload 85개 파일과 별도 manifest를 포함한다. ASAR SHA-256: `1035a284b7a1ef3d63aa69a87dde31cc315f422b0cfd6179e7a31d32f3251bc0`. 설치 파일 SHA-256: `081a01cbd145bf425cec87768aec4f0004639ce629727ebddb71641d0f4b150f`. 앱 소스 커밋: `289374f1d84a982fe53676be2f469708fbffc3dd`.

설치 파일과 실제 lifecycle 검증의 최종 결과는 `evidence/release/installer-qa.json` 및 `build.json`의 SHA-256이 일치하는 경우에만 유효하다. 개발 빌드의 기능 Gate와 설치 프로그램의 Gate는 분리한다.

## 구성과 동작

`artifacts/release/O-CUT-Setup-0.10.0.exe`는 현재 사용자용 Windows 64비트 설치 후보다. 기본 위치는 `%LOCALAPPDATA%\Programs\O-CUT`이며 실행 파일은 그 아래 `app\O-CUT.exe`다. 시작 메뉴와 Windows 제거 목록에 등록한다. 관리자 권한, 자동 시작, 파일 연결 변경은 요청하지 않는다.

일반 편집과 MP4 출력에 필요한 FFmpeg/FFprobe 9.0을 포함한다. 원래 개발 빌드의 ASAR를 변경하지 않고 실행 파일의 ProductName·FileDescription·버전·파일명·아이콘을 O-CUT으로 바꾼다. Electron/Chromium 라이선스와 FFmpeg의 원본 README/GPL 문서, 출처 안내 및 한국어 사용 설명서를 포함한다. 모델·Python·기존 사용자 곡·설정·자격 증명은 포함하지 않는다.

AI 음악과 자동 자막은 별도 로컬 Python·모델을 연결해야 한다. 설치 프로그램에서 다운로드하거나 설치하지 않는다. 기존 원본의 Electron 33.4.11과 음악 worker·FFT를 보존한 로컬 개발 후보이며, 최신 런타임 보안 갱신이나 원본 파생 코드의 외부 재배포 승인을 완료했다고 주장하지 않는다. 외부 게시·서명·유료 서비스 사용은 없다.

## 설치와 데이터 보호

새 빈 폴더 또는 동일 제품 표식이 있는 폴더에 설치한다. 소유권을 확인할 수 없는 기존 시작 메뉴 폴더도 덮어쓰지 않는다. 실제 경로와 상위 폴더의 junction/reparse point를 거부한다. 실행 중인 앱의 교체를 거부한다. 먼저 `.ocut-stage`에 파일을 준비한 뒤 활성화하며, 재설치 시 이전 `app` 폴더를 `backup-*`으로 보존한다. 새 폴더 활성화에 실패하면 이전 폴더로 이름을 되돌리는 경로가 있다. 실제 디스크 부족/정전 도중의 복원은 별도 검증이 필요하다.

제거는 패키지의 명시적인 파일 목록만 대상으로 하고 디렉터리는 비어 있을 때만 제거한다. 제거 전에 하위 디렉터리의 reparse point도 검사한다. 사용자 프로젝트·원본 미디어·`%APPDATA%\O-CUT`·알 수 없는 파일·`backup-*`은 보존한다. 이전 버전으로 돌아가려면 보존한 백업의 `O-CUT.exe`를 실행한다. 백업의 자동 정리 기능은 없다.

준비 중 오류로 `.ocut-stage`가 남으면 덮어쓰지 않는다. 해당 폴더를 확인하거나 새 빈 설치 폴더를 선택한다. 설치 성공은 종료 코드만으로 판정하지 않고 실제 파일 전체의 manifest 해시와 앱 실행으로 확인한다. NSIS가 잘못된 `/D` 값을 무시하고 기본 위치로 설치하는 동작을 발견했다. 현재는 OS 원본 명령행에서 대상을 다시 확인해 일반 파일 대상과 잘못 인용된 `/D`를 거절한다. 기본 설치 폴더가 변경되지 않는지도 검사한다.

## 검증 방법과 발견한 문제

`qa-installer-paths.cjs`는 실제 NSIS 스크립트와 작은 시험 payload로 새 경로·중첩 경로·빈 폴더·기존 자료·파일 대상·junction·제거 경로를 검사한다. `qa-installer.cjs`는 최종 설치 파일의 해시부터 시작해 전체 payload 바이트 비교, 설치된 앱 실행, 실제 import/편집/저장/MP4 전체 decode, 실행 중 재설치 거부, 재설치 백업 실행, 제거 후 사용자 파일 보존을 검사한다. 일반 설치 통합 검사는 기존 사용자 등록과 바로가기가 모두 없는 경우에만 수행하고 생성한 항목을 제거한 뒤 원상태를 확인한다.

초기 실패의 원인은 NSIS `/D` 인수를 공백 때문에 자동 인용한 시험 코드와, 존재하지 않는 경로에서 빈 문자열을 반환하는 NSIS `GetFullPathName`이었다. `/D`와 `_?=`를 마지막 비인용 인수로 전달하고, 경로 정규화는 길이/실패를 검사하는 Win32 `GetFullPathNameW`로 수정했다. 컴파일 경고가 있는 패키지는 통과시키지 않는다. 실패 기록은 보존한다. 실행 중 보호는 읽기 가능 여부가 아니라 실행 파일의 배타적 쓰기 열기로 확인하며 실패 핸들을 수치로 비교한다.

초기 경로 시험은 요청한 대상만 확인해 NSIS가 기본 폴더에 작은 시험 payload를 만든 것을 놓쳤다. 이후 기본 폴더까지 대조하도록 보강했다. 그 폴더의 모든 파일·문자열과 제거 프로그램 해시가 격리 시험본과 일치하는지 확인한 뒤 `.runtime`으로 이동해 보존하고, 기본 폴더가 없던 상태로 복구했다. 실제 앱이나 사용자 파일은 없었다. 정확한 파일 해시와 보관 위치는 `evidence/release/fixture-isolation.json`에 있다.

공식 근거: [NSIS 명령행 인수](https://nsis.sourceforge.io/Docs/Chapter3.html), [NSIS 경로·파일 명령](https://nsis.sourceforge.io/Docs/Chapter4.html), [사용자 권한 요청](https://nsis.sourceforge.io/Reference/RequestExecutionLevel), [RCEdit 2.0.0](https://github.com/electron/rcedit/releases/tag/v2.0.0).

## 남은 한계

깨끗한 별도 PC/VM, 전자 서명·SmartScreen 평판, 다른 Windows 버전/보안 제품, 시스템 강제 종료 중 설치, 디스크 부족, 실제 구버전에서 신버전으로의 migration, 최신 Electron 공급망 검증: NOT RUN. 같은 버전 재설치와 이 PC에서 PATH/Python을 제외한 실행은 새 PC 검증을 대신하지 않는다. 고급 MIDI/ABC/일괄 생성 UI, GPU 출력, 장시간 복잡한 4K 편집도 최종 제품 완료 범위에 남아 있다.

빌드 도구는 기존 NSIS 3.04 캐시와 공식 RCEdit 2.0.0 실행 파일을 사용하며 SHA-256을 고정한다. RCEdit는 프로젝트 안의 빌드 도구로만 다운로드했고 시스템에 설치하지 않았다. npm 의존성 변경은 없다. 새로 동봉하는 런타임 도구는 FFmpeg/FFprobe 두 실행 파일이다. 정확한 원본 위치·해시·파일 목록은 `evidence/release/build.json`에 기록한다.

개발 의존성의 `npm audit`는 취약점 0건이다(`evidence/release/npm-audit.json`). 이 검사는 동봉된 Electron·FFmpeg·기존 Python/모델의 전체 공급망을 검사한 결과가 아니다. GUI 설치 마법사 버튼의 자동 조작은 NOT RUN이며, 실제 무인 설치와 생성된 앱·Windows 등록·제거 동작을 검증한다.
