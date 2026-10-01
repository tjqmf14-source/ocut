# O-CUT 0.6 시각화·음악 영상 검증

개발 브랜치: `feature/visualizer`. 검증일: 2026-10-02 KST. 전체 제품이나 설치 배포의 완료를 의미하지 않는다.

최종 결과: **70/70 자동 검사, 시각화 6개 실행 시나리오 및 기존 전체 Gate 통과**. 실패/skip/테스트 취소 0. 현재 ASAR SHA-256: `729b03d6b91f8cb43b40f1dd8895e0edca900cf1dc1438930b321025fca2fca6` (소스 파일 25개). 시각화 비교 프레임 SSIM 0.998908–0.999372. 출력은 실제 MP4 6개이며 기존 기능까지 합쳐 전체 Gate에서 12개 MP4를 검증했다.

## 실제 구현

음원 PCM에 기반한 6가지 시각화(Wave, Bars, Line, Circular, Mirror, Spectrum), 소스별 분석 캐시, 크기/위치/회전/불투명도/색상/막대 수/선 두께/감도/부드러움/빛 번짐/주파수 범위 편집을 추가했다. 음악 영상 만들기는 기존 편집 가능한 타임라인에 배경·제목·음원·시각화·페이드를 배치한다. 원본을 바꾸지 않고 `.ocut`에 편집 상태를 저장한다.

시각화는 독립 오버레이이며 오디오를 중복 재생하지 않는다. 무음인 시각화 트랙의 M/S는 비활성화하고, 해당 트랙의 solo 값이 저장된 문서도 실제 음악을 음소거하지 않도록 처리했다. 페이드 없는 시각화 분할은 sourceStart/sourceEnd와 설정을 보존한다. 페이드가 있으면 기존처럼 먼저 0으로 설정한 뒤 분할해야 한다.

원본 FFT 분석 코드 `baseline/electron/spectrum-analysis.js`를 바이트 그대로 보존·재사용했다. 새 의존성/모델/Python/코덱 설치, 유료 API, 외부 업로드, 기존 사용자 곡·설정 변경은 없다. 새 앱 기능과 별도로 원본 재배포 권리/최종 패키지 라이선스 검토를 완료했다고 주장하지 않는다.

## 검증 방식

전체 `verify-studio.cjs`는 core/build, 단위 검사, 실제 shell/timeline, 기존 영상/이미지/자막/복구, GPU 음악 생성, 새 시각화 QA를 순서대로 실행한다. 정확한 최종 패키지 SHA 및 단계 결과는 `evidence/studio/gate.json`, 소스 바이트 목록은 `build.json`, 단위 검사 수는 `gate-tests.log`를 기준으로 한다.

시각화 QA는 직전 실제 GPU 생성 WAV에서 3초를 잘라 소스로 사용한다. 파일 선택 대화상자만 QA 경로로 응답시키며 음원 분석, worker, 편집, Canvas, FFmpeg는 실제 구현을 실행한다. 검증 항목은 다음과 같다.

1. 패키지 안의 worker가 PCM을 분석하고 길이·페이드가 맞는 편집 프로젝트를 생성.
2. 실제 오디오 재생 중 재생 시간과 시각화 프레임이 변화.
3. 6가지 모양을 MP4로 출력하고 전체 decode, 미리보기 대비 SSIM 및 색상 픽셀 존재/비율 확인.
4. source trim·속도·타임라인 위치·사용자 시각화 설정의 source-time 계산.
5. 투명 레이어 생성 도중 취소해 기존 목표 파일과 편집기를 보존하고 부분 출력 제거.
6. 앱 종료/재실행 후 프로젝트를 동일하게 복원하고 디스크 캐시 수정 시간 불변 확인.

Bars는 1080p30의 0.5/1.5/2.5초 프레임을 비교하며, Wave/Line/Spectrum은 720p30, Circular는 4K30, Mirror는 1080p60의 1.5초 프레임을 비교한다. 모든 SSIM 기준은 0.98 초과다. 배경만 남은 잘못된 출력이 높은 SSIM으로 통과하지 않도록 실제 색상 픽셀이 유지되는지도 검사한다. 전 프레임이 수치상 동일하거나 모든 입력 코덱이 검증됐다는 의미는 아니다.

단위 검사는 실제 무음이 0을 유지하고 440 Hz/4 kHz 입력이 다른 대역에 나타나는지, 분석 결정성, 범위/NaN/Infinity 거절, source 연속성, Undo, alpha overlay/음성 중복 방지, visualizer solo 경계를 포함한다.

## 사용 가능한 산출물

- 앱: `dist/studio/O-CUT.exe` (폴더 전체 유지).
- 실제 영상 6개: `artifacts/visualizer/O-CUT-<모양>-<해상도>p<fps>.mp4`.
- 프로젝트: `artifacts/visualizer/시각화 편집.ocut`. 이 PC의 QA 원음 경로를 참조하는 프로젝트이며 음원을 포함한 이식 가능한 번들이 아니다.
- 실행 증거: `evidence/studio/visualizer-qa.json`, `gate-visualizer.log`, `visualizer-editor.png`.
- 패키지와 commit 대조: `artifacts/visualizer/BUILD-INFO.json`.

## 한계·미실행·복구

- 현재 분석은 10분 이하 소스, 24 kHz mono, 30fps FFT 128대역/파형 64구간이다. 60fps는 같은 분석 시점 데이터를 읽는다. 10분 한계 스트레스·대형 다중 시각화 프로젝트·장시간 편집: **NOT RUN**.
- Wave의 막대 수/주파수 설정은 적용하지 않는다. 선 두께는 선 계열, 막대 너비는 막대 수에서 결정된다.
- 오디오 믹스 전체/트랙 mute·volume을 자동 추종하는 시각화 모드는 없다. 음원·시각화 클립의 트림/위치/속도/페이드는 독립적이며 동일한 수치를 적용해 동기화한다.
- 시각화 출력은 alpha 중간 영상을 만들어 cacheDir/exports에 보관하므로 시간과 디스크 공간이 추가로 든다. 자동 캐시 정리는 구현하지 않았다.
- 자동 자막/STT, MIDI/ABC/음악 batch UI, 전환/필터/키프레임, 자동 저장 UI, GPU encoder, installer, 새 PC: **NOT RUN / 후속 작업**.
- 의존성 변경 없음. 전체 Electron/Python/모델/FFmpeg 공급망 감사·배포 권리 검토, 원격 GitHub 게시/CI: **NOT RUN**. 새 외부 MCP 경로/실패는 없다. 별도 linter/typechecker는 저장소에 구성되지 않아 **NOT RUN**, JS 구문·단위·실행 검사를 수행한다.
- 복구 기준은 이전 음악 기능 체크포인트 `009e93c8680941cbab16cc4c3114e4ce18618554`. 이전 앱을 별도 폴더에서 재빌드하고 사용자 파일은 유지한다. 이전 앱은 새 visualizer effect/오디오 overlay를 지원하지 않으므로 현재 앱에서 시각화 클립을 삭제해 다른 이름으로 저장한 사본을 사용한다. DB/사용자 데이터 마이그레이션은 없다.
