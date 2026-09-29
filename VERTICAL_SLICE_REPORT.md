# O-CUT 첫 편집 흐름 검증

2026-09-29 · `feature/render` · O-CUT 0.3 개발 빌드

영상·음원 가져오기 → 실제 파형 → 실시간 재생 → 분할/트림 → 한글 텍스트 → MP4 출력의 첫 제품 흐름을 실제 앱에서 검증했다. 전체 마스터 지시의 최종 Release Candidate는 아직 아니다.

## 실행 산출물

- 앱: `D:\O-CUT\dist\studio\O-CUT.exe` (폴더 전체 필요)
- 소스: `D:\O-CUT\src`
- 검사: `node scripts/verify-studio.cjs`
- 정확한 ASAR: `98791bf7e7ba9f78672f262f92dbe92c56873e88870d8c3d3cd6d2b2e7a1bea5`
- 패키지/소스 대응: `evidence/studio/gate.json`
- 사용자 안내: `STUDIO_GUIDE.md`

## 실제 결과

| 출력 파일 (artifacts/vertical-slice) | 크기 | 길이 | 화면 비교 SSIM |
|---|---:|---:|---:|
| O-CUT-1080p-30.mp4 | 2,153,145 bytes | 6초 | 0.993100 |
| O-CUT-1080p-60.mp4 | 2,194,428 bytes | 6초 | 0.992983 |
| O-CUT-2160p-30.mp4 | 5,085,145 bytes | 6초 | 0.992809 |
| O-CUT-image-music-text.mp4 | 247,515 bytes | 6초 | 0.990249 |

모두 H.264/AAC, 영상/음성 스트림 존재, 올바른 해상도/FPS/duration 및 전체 decode 통과. SHA-256은 `evidence/studio/artifacts.json`에 기록했다. 첫 세 파일은 소스의 440Hz/880Hz 두 음원이 혼합됐음을 실제 PCM으로 확인했다. 마지막 파일은 이미지의 회전 15도, 크기 75%, 불투명도 80%, 위치 이동과 한글 텍스트를 포함한다. 테스트 패턴은 QA 입력이며 앱에 데모 미디어로 내장하지 않는다.

43개 자동 검사에서 실패·취소·생략 0. 실제 shell 4개, timeline 7개, 출력 복구 3개 검증을 통과했다. 저장 후 앱 재실행, 잠금/해제, 포인터 이동/트림, 출력 중 취소, 기존 출력 바이트 보존, 임시 출력 제거, 원본 덮어쓰기 거절을 검사했다. 패키지 테스트는 현재 소스를 ASAR의 실제 바이트와 대조하고 남은 옛 파일도 검사한다.

## 변경과 경계

출력은 main 프로세스의 동일 Project Model을 읽는다. 시간·소스 범위·속도·변환·레이어 순서·mute/solo/volume을 FFmpeg 계획으로 변환하고, 텍스트는 미리보기와 같은 Canvas 코드로 그린다. CPU 출력, 진행률, 취소 및 metadata 검증을 제공한다. 입력 파일은 변경하지 않는다. 도구 실행에 shell을 사용하지 않는다.

기존 음악 기능/Python worker는 baseline에 보존했다. AI Music 패널 통합, 자막/STT, Spectrum, 전환/필터/키프레임, crop/reverse/freeze frame, 오디오 EQ/fade, 자동 저장/복구 UI, GPU 출력, H.265/독립 음원 출력, 정식 Windows 브랜딩/아이콘, installer와 새 PC 설치 검사는 남아 있다. 지원하지 않는 효과·키프레임 프로젝트 출력은 오류로 중단한다.

현재 PC의 FFmpeg/FFprobe 9.0과 복원한 Electron 런타임을 사용한다. 새로운 런타임 또는 개발 의존성을 추가하지 않았다. npm audit 0건은 설치된 개발 도구만의 결과이며 전체 런타임 안전성 보증은 아니다. 장시간/대용량 및 특수 코덱·SAR/회전 메타데이터·HDR·VFR 호환성은 NOT RUN이다.

## 실패 처리와 복구

잠금 선택 해제, FFmpeg 옵션 변경, 초기 N/A 진행률을 실제 검사로 발견하고 수정했다. 최종 화면 점검에서 이미지 트랙 추가 시 제목/클립 행 정렬 및 텍스트 우선순위 문제를 찾아 수정하고 회귀 검사를 추가했다. 마지막 실패 증거와 FFmpeg 작업 로그는 보존했다. 화면 비교는 배포 영상과 같은 YUV420 형식으로 수행하며 RGB 점수도 기록했다. 전체 프레임의 완전한 시각 동일성은 확인하지 않았다.

QA 데이터는 `.runtime`에 격리했다. 원본 installer와 추출 소스, 기존 사용자 곡/설정은 변경하지 않았다. `rebuild/baseline`, `core/project-engine`, `feature/studio-shell`, `feature/timeline` 체크포인트를 유지한다. 사용자 출력 파일은 성공 검증 전까지 기존 바이트를 보존하며 실패/취소는 임시 파일만 제거한다. 외부 MCP 실패는 없었고 원격 push/CI/설치 배포는 실행하지 않았다.
