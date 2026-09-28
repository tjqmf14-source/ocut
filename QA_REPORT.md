# QA 보고서

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

최종 제품 Scenario A–E, 새 PC 설치, NVENC fallback, 장시간/대용량 timeline, 자막/STT/전환/키프레임은 **NOT RUN**입니다. Phase 0 출력은 원본 playlist 영상 기능의 검증이며 미래 O-CUT timeline의 검증이 아닙니다.

Phase 1 현재 검사: 31/31 통과, 실패/skip/취소 0. `evidence/phase1/tests.log`와 [Phase 1 보고서](PHASE1_REPORT.md)를 참조합니다. 실제 baseline UI/runtime/render 코드는 이 단계에서 변경하지 않았으며 해당 ASAR와 소스의 동일성을 재검증했습니다.
