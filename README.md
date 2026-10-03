# O-CUT — AI Music & Video Studio

음악 생성부터 영상 편집·자막·시각화·출력으로 이어지는 독립 데스크톱 제작 도구를 개발하는 저장소입니다.

현재 **O-CUT 0.11 개발 빌드**를 사용할 수 있습니다. `dist/studio/O-CUT.exe`에서 로컬 AI 음악 생성 → 타임라인 → 볼륨·페이드 → 영상·텍스트·자동 자막·시각화 → MP4 내보내기로 작업합니다. **시각화 → 음악 영상 프로젝트 만들기**로 음악 한 곡에서 편집 가능한 기본 영상을 구성합니다. 위치·크기·회전·불투명도·볼륨 키프레임, 색 보정과 여섯 가지 전환을 편집합니다. 자동 저장과 최근 프로젝트·복구 목록, 여러 곡 예약·일시 정지·재개를 지원합니다. 프로그램은 실행 파일만 옮기지 말고 `dist/studio` 폴더 전체를 유지해야 합니다.

Windows 설치 후보는 `artifacts/release/O-CUT-Setup-0.10.0.exe`입니다. FFmpeg/FFprobe를 포함하며 설치 후 시작 메뉴의 **O-CUT**으로 실행합니다. 설치본은 개발 폴더와 별도로 배치합니다. 검증 결과와 보존·제거 동작은 [설치 보고서](RELEASE_REPORT.md)를 확인하세요. 전자 서명과 새 PC/VM 검증을 완료한 상용 배포판은 아닙니다.

AI 음악은 기존 Python·YuE2 모델과 NVIDIA CUDA GPU, 자동 자막은 로컬 Whisper 모델과 Transformers를 사용하며 자동 다운로드/설치는 없습니다. 자막은 GPU 자동 선택과 CPU 모드를 지원하고 글꼴·색·배경·그림자 및 네 가지 프리셋을 편집합니다. 음악 생성 고급 기능(MIDI/ABC), GPU 출력, 최신 런타임 갱신은 후속 개발 항목입니다. 시각화 분석은 10분 이하 소스, 음성 인식은 30분 이하 클립으로 제한합니다.

- [자동 저장·복구·반응성 보고서](RECOVERY_REPORT.md)
- [음악 대기열 검증 보고서](MUSIC_QUEUE_REPORT.md)
- [색 보정·전환 검증 보고서](EFFECTS_REPORT.md)
- [키프레임 검증 보고서](KEYFRAME_REPORT.md)
- [텍스트 서식·로컬 자동 자막 보고서](TEXT_STT_REPORT.md)

- [시각화·음악 영상 검증 보고서](VISUALIZER_REPORT.md)
- [음악 생성·페이드 검증 보고서](MUSIC_REPORT.md)
- [자막 기능 검증 보고서](CAPTION_REPORT.md)

- [첫 편집 흐름 검증 보고서](VERTICAL_SLICE_REPORT.md)
- [타임라인 보고서](PHASE3_REPORT.md)
- [사용 방법](STUDIO_GUIDE.md)

- [Baseline 보고서](BASELINE_REPORT.md): 복원 범위, 실제 실행, AI 생성, 영상 출력, 위험과 미검증 항목
- [빌드 방법](BUILD.md)
- [아키텍처](ARCHITECTURE.md)
- [QA 증거](QA_REPORT.md)
- [Phase 1 코어 보고서](PHASE1_REPORT.md): `.ocut` 모델, history, 저장/복구 기반의 당시 검증 기록.

`dist/baseline/O-CUT.exe`는 설치 없이 실행할 수 있는 연구용 앱입니다. 기본 데이터는 `%APPDATA%/O-CUT-Baseline`, 테스트 데이터는 `.runtime`에 격리합니다. AI 환경은 자동 포함되지 않으며 이번 QA는 이 PC의 기존 Python/모델을 offline으로 사용했습니다. 별도 상용 배포/installer가 아닙니다.
