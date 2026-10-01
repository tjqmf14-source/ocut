# QA 보고서

## 현재 Studio 검증 — 2026-10-01

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
