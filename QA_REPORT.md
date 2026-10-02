# QA 보고서

## 현재 Studio 검증 — 2026-10-02

0.7 텍스트 서식과 로컬 STT는 [TEXT_STT_REPORT.md](TEXT_STT_REPORT.md)를 기준으로 한다. 전체 Gate 13단계, **75/75 검사(실패/skip/취소 0)** 및 기존 편집/음악/시각화 회귀 검사를 통과했다. 텍스트 4개 시나리오와 STT 6개 시나리오를 실제 앱에서 검사했다. 새 MP4 5개를 포함해 이번 Gate에서 MP4 17개 전체 decode를 확인했다.

ASAR SHA-256: `af7bc553e653989d3fa096444fe7ecd3622101f620b3009f81a708a95f45d1c6`. 소스 28개와 패키지 바이트, 외부 Python worker의 동일성을 확인했다. 한국어 합성 음성의 GPU/CPU 인식, 트림·속도·시작 시간, 한 번의 Undo, 즉시/worker 시작 후 취소, SRT/MP4, 재실행 복원을 검증했다. 텍스트 네 프리셋 프레임 SSIM 0.999431–0.999562.

최대 길이 STT·잡음·노래·다국어 정확도, installer/새 PC, 전환·키프레임: NOT RUN. 기존 환경만 사용했으며 새 패키지 설치·모델 다운로드는 없다. 이전 취소 경합 실패 증거와 QA 스크립트 시간 표기 실패는 보존했다.

## 0.6 당시 Studio 검증 — 2026-10-02

0.6 시각화/음악 영상 구성은 [VISUALIZER_REPORT.md](VISUALIZER_REPORT.md)를 기준으로 한다. 최종 Gate에서 **70/70 검사(실패/skip/취소 0)**, 기존 shell/timeline/영상/자막/음악/복구 및 새 시각화 6개 시나리오가 통과했다. 실제 MP4 12개를 만들었으며 시각화 6종에는 1080p60과 4K30도 포함된다. 비교한 시각화 프레임의 SSIM은 0.998908–0.999372다. 무음 0, 실제 주파수 반응, 재생 변화, 출력 중 음성 중복 방지, 취소/파일 보존, 저장/캐시 재사용을 확인했다.

ASAR SHA-256은 `729b03d6b91f8cb43b40f1dd8895e0edca900cf1dc1438930b321025fca2fca6`이며 현재 소스 25개를 패키지에서 꺼내 비교했다. 원본 FFT 코드 및 음악 worker 보존을 확인했다. 10분 최대 길이 스트레스/복수 장시간 시각화, STT, 전환/키프레임 및 installer는 NOT RUN이다.

## 0.5 당시 Studio 검증 — 2026-10-02

0.5 음악 생성과 오디오 페이드는 [MUSIC_REPORT.md](MUSIC_REPORT.md)를 기준으로 한다. 전체 Gate에서 core/build, **61/61 검사(실패/skip/취소 0)**, shell 4, timeline 7, 복구 3, 자막 7, 음악 7과 실제 MP4 6개를 검증했다. ASAR SHA-256은 `8fd73e09f28d27ca39a32ed8f064d5e42d37172895d735ce8886244674ff66f2`이며 `evidence/studio/gate.json`에 현재 소스 20개 manifest가 있다.

RTX 5080 / YuE2 0.1.6에서 실제 19.998667초 음악을 생성했다. 6초로 트림하고 볼륨 75%, 페이드 인 1초·아웃 2초를 적용한 1080p MP4 전체 decode와 PCM 배율을 확인했다. 생성 중 편집, 실제 생성 취소, 재실행 후 생성 기록·프로젝트 복원이 통과했다. 보컬 가사 정확성, 표준 품질·40/60초 설정별 품질, 새 PC 설치 및 전체 제품 시나리오 C/D는 NOT RUN이다. 새 설치나 의존성 변경은 없다.

UI 검사에서 Promise를 반환하는 대기 조건이 편집 완료 전에 통과할 수 있음을 확인해 동기적인 렌더러 상태 조건으로 수정했다. 이후 위 전체 Gate를 새로 실행했다. 음악 QA의 앞선 실패 기록은 `music-failure.json`에 남겨 두었고 실제 생성 성공과 전체 시나리오 성공을 구분한다.

## 0.4 당시 Studio 검증 — 2026-10-01

0.4 자막 기능은 [CAPTION_REPORT.md](CAPTION_REPORT.md)를 기준으로 합니다. 53개 검사에서 실패/skip/취소 0. 한 번의 전체 Gate에서 shell 4개, timeline 7개, 복구 3개, 자막 7개와 실제 MP4 5개 검증을 통과했습니다. 현재 패키지는 `evidence/studio/gate.json`의 해시와 소스 manifest를 기준으로 합니다.

SRT 가져오기·분할/병합·수정·Undo/Redo, VTT 변환 안내, 잘못된 파일 거절, 직접 작성·검색·SRT 재저장, 실제 자막 영상, 앱 재실행 복원을 검사했습니다. 자막 영상은 1920×1080 / 30fps / 7초 / H.264+AAC이며 전체 decode와 0.8/4.2/6.5초 프레임 비교 SSIM 0.993924 / 0.999579 / 0.999616을 통과했습니다.

미디어 범위 응답 206/길이/실제 바이트를 실제 앱에서 검사했습니다. 자동 자막/STT, 서식 전체 호환성, Scenario C의 전환, Scenario D의 AI 패널/시각화 및 installer는 여전히 NOT RUN입니다.

## 0.3 당시 Studio 검증 — 2026-09-29

첫 편집 흐름은 [VERTICAL_SLICE_REPORT.md](VERTICAL_SLICE_REPORT.md)를 기준으로 합니다. 한 번의 `verify-studio.cjs` 실행에서 Build, 43개 검사(실패/skip/취소 0), 실제 앱 shell 4개, timeline 7개, 출력 복구 3개 및 실제 MP4 4개 검증을 모두 통과했습니다. `evidence/studio/gate.json`에 정확한 ASAR SHA-256과 소스 manifest가 있습니다.

Scenario A: 실제 영상/음원 import → split/trim → 프로젝트 저장 → 같은 프로젝트 export 통과. Scenario B: image/music/text/waveform → 1080p 출력 통과(회전/위치/크기/불투명도 포함). Scenario E: 저장 → 종료 → 재실행 → 프로젝트 동일 복원 통과. Scenario C/D는 자막/전환/AI 패널/시각화 미구현으로 NOT RUN입니다.

1080p30, 1080p60, 4K30 모두 6초 H.264/AAC이며 전체 decode를 확인했습니다. 2.5초 프레임 YUV420 SSIM은 각각 0.993100 / 0.992983 / 0.992809이고 440Hz와 880Hz 두 소스의 음성도 확인했습니다. 변환된 이미지 조합은 SSIM 0.990249입니다. 이것은 표적 QA이며 모든 프레임/모든 입력 형식의 일치를 주장하지 않습니다.

`evidence/studio/render-failure.json`에는 성공 전 실제 진행률 오류가 남아 있습니다. FFmpeg가 첫 timestamp 전에 출력하는 N/A를 수치로 처리한 원인을 수정하고 전체 Gate를 재실행했습니다. 이전 RGB SSIM 차이는 출력과 같은 YUV420에서 비교해 분리했으며 RGB 수치도 `render-qa.json`에 함께 보존했습니다. FFmpeg 9에서 제거된 옵션도 현재 공식 문서에 맞게 수정했습니다.

개발 도구 의존성 audit는 취약점 0건입니다. 전체 Electron/Python/코덱 공급망 감사는 NOT RUN입니다. 설치 프로그램/새 PC/장시간 편집/NVENC/H.265/HDR·VFR 호환성은 NOT RUN입니다.

## Phase 0 및 Phase 1 당시 기록

Phase 0 상세 결과 및 미검증 기능은 [BASELINE_REPORT.md](BASELINE_REPORT.md)를 기준으로 합니다.

| 증거 | 내용 |
|---|---|
| evidence/phase0/build.json | 빌드 종류, executable, ASAR SHA-256 |
| evidence/phase0/source-manifest.json | 복원한 21개 파일의 SHA-256 |
| evidence/phase0/static-inventory.json | 분류, 원본 대비 변경, 57개 IPC |
| evidence/phase0/unit-tests.log | 테스트 수/실패/skip/취소 요약 |
| evidence/phase0/runtime-qa.json | 실제 앱 시작, 격리, AI 생성, 분석, 재실행 |
| evidence/phase0/ai-events.json | 실제 Python generation stage 이벤트 |
| evidence/phase0/render-qa.json | 실제 출력 metadata/파일/SSIM/decode |
| evidence/phase0/render-qa-attempt1.json | 최초 render QA 실패 이력, 성공으로 덮지 않음 |
| evidence/phase0/renders/2026-09-28T13-21-33-206Z | 세 MP4, MP3/WAV, ffprobe JSON |
| evidence/phase0/npm-audit.json | 개발 도구 의존성 취약점 0건 |

Phase 0 당시 최종 제품 Scenario A–E, 새 PC 설치, NVENC fallback, 장시간/대용량 timeline, 자막/STT/전환/키프레임은 **NOT RUN**이었습니다. Phase 0 출력은 원본 playlist 영상 기능의 검증이며 현재 Studio 검증과 구분합니다.

Phase 1 현재 검사: 31/31 통과, 실패/skip/취소 0. `evidence/phase1/tests.log`와 [Phase 1 보고서](PHASE1_REPORT.md)를 참조합니다. 실제 baseline UI/runtime/render 코드는 이 단계에서 변경하지 않았으며 해당 ASAR와 소스의 동일성을 재검증했습니다.
