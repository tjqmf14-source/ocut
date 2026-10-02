# O-CUT 0.7 — 텍스트 서식과 로컬 자동 자막

2026-10-02 KST. 개발 빌드이며 최종 설치 배포판이 아니다.

## 결과

전체 `verify-studio.cjs` 13단계와 75/75 검사를 통과했다. 실패·skip·취소·todo는 0이다. ASAR SHA-256은 `af7bc553e653989d3fa096444fe7ecd3622101f620b3009f81a708a95f45d1c6`이며 현재 소스 28개와 패키지 내용을 바이트 비교했다. 외부 음악 worker 보존과 새 STT worker 복사 동일성도 검사했다.

기존 shell 4, timeline 7, 복구 3, 자막 7, 음악 7, 시각화 6 시나리오와 영상/이미지 합성을 다시 검증했다. 추가 텍스트 4, STT 6 시나리오를 통과했으며 이번 Gate에서 실제 MP4 17개를 생성해 전체 decode했다. 원본 installer/baseline, 기존 사용자 곡·설정·모델은 변경하지 않았다.

## 실제 동작

- 제목·자막·가사·하단 이름표 네 프리셋, Windows 글꼴·굵기·크기·자간·줄 간격·정렬·색·그라데이션·외곽선·그림자·배경.
- 서식 Undo/Redo, 같은 서식 자막 분할/병합, 프로젝트 저장·재실행. 다른 서식의 병합은 문서 변경 없이 거절한다.
- 공통 Canvas 그리기로 MP4 출력. Chromium에서 자간 10px 입력 시 O-CUT 문자열 폭이 실제 126.640625 → 176.640625px로 변함을 확인했다.
- 네 프리셋의 1080p30 2초 MP4를 전체 decode하고 실제 글자 픽셀과 preview/output SSIM을 비교했다: title 0.999511, subtitle 0.999562, lyrics 0.999484, lowerThird 0.999431.
- 기존 Whisper base 모델로 한국어 음성을 실제 GPU와 CPU에서 각각 인식했다. SAPI Heami 합성 문장인 “안녕하세요. 오늘은 음악과 영상을 편집합니다. 자막을 만들고 내용을 확인합니다.”를 양쪽에서 인식했다. 이것은 표적 연결 검증이며 일반 음성 정확도 평가가 아니다.
- 입력 앞 2초 트림, 1.25배속, 타임라인 1초 시작 조건에서 인식 구간을 클립의 6.5초 범위 안에 배치했다. 자막 전체 추가를 한 번의 Undo로 취소할 수 있다.
- 요청 즉시 취소 및 Python 모델 로딩 시작 후 취소에서 기존 프로젝트가 바이트 직렬화 기준 동일했다. SRT/실제 H.264+AAC 출력과 앱 재실행 후 정확한 프로젝트 복원도 통과했다.

## 환경과 증거

실행은 이 PC의 Python 3.12.14, torch 2.10.0+cu128, Transformers 4.57.6, RTX 5080 및 FFmpeg 9.0을 사용했다. Whisper base 캐시는 `e37978b90ca9030d5170a5c07aadb050351a65bb` snapshot이다. `local_files_only` 및 offline 환경으로 읽었고 설치·모델 다운로드·유료 API 사용은 없다. 새 npm/runtime 패키지를 추가하지 않았으며 기존 Python 환경의 torch/transformers/numpy를 기능 의존성으로 사용한다.

- `evidence/studio/gate.json`, `gate-tests.log`: 전체 단계, 패키지 해시, 소스 manifest 및 검사 수.
- `text-style-qa.json`, `text-style-editor.png`: 실제 서식 UI/출력/재실행 증거.
- `transcription-qa.json`, `transcription-editor.png`: 실제 인식 문장·GPU/CPU 작업 로그·취소·저장 증거.
- `artifacts/text-style`: 네 MP4/프레임 이미지 및 외부 미디어 없는 서식 프로젝트.
- `artifacts/transcription`: 인식된 SRT/MP4 및 이 PC QA 음성 파일 경로를 참조하는 프로젝트. 원음 포함 이식 가능한 번들은 아니다.
- `artifacts/transcription/BUILD-INFO.json`: 검증된 커밋과 패키지 대조 기록.

최초 STT 검사에서 사전 probe가 끝나기 전에 취소 요청이 와 controller가 없던 경합을 발견했다. 인증된 IPC 접수 즉시 controller를 만들고 최종 적용 직전에도 확인하도록 수정한 뒤 전체 Gate를 다시 통과했다. `transcription-failure.json`은 이전 실패 기록이다. 텍스트 QA 스크립트의 FFmpeg seek `.5` 표기를 `0.5`로 수정한 이전 기록은 `text-style-failure.json`에 남아 있다.

## 한계와 복구

최대 30분 클립/20분 처리 제한이다. 최대 길이 스트레스, 실제 녹음 잡음·다국어·보컬 가사 정확도, word-level timestamp: **NOT RUN**. 자동 자막은 잠기지 않은 자막 트랙에 추가하므로 재인식 시 겹칠 수 있으며 기존 결과를 Undo/삭제한 뒤 재시도한다. 글꼴 자동 설치와 자동 줄바꿈은 없다. 현재 Python/모델 연결이 없는 새 PC 설치: **NOT RUN**.

전환/필터/키프레임, 자동 저장 UI, installer, 원격 GitHub 게시/CI, 전체 Electron/Python/모델 공급망 감사: **NOT RUN / 후속 작업**. 별도 linter/typechecker가 구성되지 않아 **NOT RUN**, JS 구문·Python AST·단위·실제 앱 검증을 수행했다. 새 외부 MCP 실패/대체 경로는 없다.

복구 기준은 이전 체크포인트 `09edc14e58487c84c004e486938801311346a238`. 별도 폴더에서 해당 버전을 빌드하고 사용자 파일을 보존한다. 0.6은 textStyle 효과를 출력하지 못하므로 스타일 없는 이전 프로젝트 사본으로 사용한다. 자동 자막 자체는 기존 subtitle 구조이며 DB/사용자 데이터 마이그레이션은 없다.
