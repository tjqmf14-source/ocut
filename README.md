# O-CUT — AI Music & Video Studio

음악 생성부터 영상 편집·자막·시각화·출력으로 이어지는 독립 데스크톱 제작 도구를 개발하는 저장소입니다.

현재 **O-CUT 0.5 개발 빌드**를 사용할 수 있습니다. `dist/studio/O-CUT.exe`에서 로컬 AI 음악 생성 → 타임라인 → 볼륨·페이드 → 영상·텍스트·자막 → MP4 내보내기로 작업합니다. 기존 SRT/VTT 가져오기·자막 편집 기능도 유지합니다. 프로그램은 실행 파일만 옮기지 말고 `dist/studio` 폴더 전체를 유지해야 합니다.

이 PC의 FFmpeg/FFprobe를 사용하는 개발 빌드입니다. AI 음악은 기존 Python·YuE2 모델과 NVIDIA CUDA GPU를 사용하며 자동 다운로드/설치는 없습니다. 완성된 상용 제품이나 설치 배포판은 아닙니다. 자동 자막(STT)·자막 서식 확장, 음악 생성 고급 기능(MIDI/ABC/대기열), Spectrum, 전환/필터/키프레임, 자동 저장 UI, GPU 출력 및 설치 프로그램은 후속 개발 항목입니다.

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
