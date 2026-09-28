# O-CUT — AI Music & Video Studio

음악 생성부터 영상 편집·자막·시각화·출력으로 이어지는 독립 데스크톱 제작 도구를 개발하는 저장소입니다.

현재 확인된 제품은 **Phase 0 연구용 baseline**입니다. 완성된 O-CUT 영상 편집기는 아직 제공하지 않습니다. baseline 화면은 검증을 위해 복원한 원 프로그램 UI입니다.

- [Baseline 보고서](BASELINE_REPORT.md): 복원 범위, 실제 실행, AI 생성, 영상 출력, 위험과 미검증 항목
- [빌드 방법](BUILD.md)
- [아키텍처](ARCHITECTURE.md)
- [QA 증거](QA_REPORT.md)
- [Phase 1 코어 보고서](PHASE1_REPORT.md): `.ocut` 모델, history, 저장/복구 기반. UI 연결은 후속 단계.

`dist/baseline/O-CUT.exe`는 설치 없이 실행할 수 있는 연구용 앱입니다. 기본 데이터는 `%APPDATA%/O-CUT-Baseline`, 테스트 데이터는 `.runtime`에 격리합니다. AI 환경은 자동 포함되지 않으며 이번 QA는 이 PC의 기존 Python/모델을 offline으로 사용했습니다. 별도 상용 배포/installer가 아닙니다.
