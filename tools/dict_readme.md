# le-kr-dict

[LE 한글 툴팁](https://github.com/fnrkp089/LETrans_Kr) 크롬 확장이 받아 쓰는 번역 사전입니다.
확장은 6시간마다 `version.json`을 확인하고, 버전이 바뀌면 사전을 새로 받아 sha256으로 검증한 뒤 저장합니다.

| 파일 | 내용 |
|---|---|
| `le_ko_letrans.json` | LETrans_Kr 한글 패치 용어 사전 |
| `le_ko_official.json` | 게임 공식 한글 용어 사전 |
| `rules.json` | 맥스롤 툴팁 어순·연결어 규칙 |
| `version.json` | 사전 버전과 파일별 sha256 |

사전은 게임 텍스트 테이블(영문·한글)에서 `tools/build_dict.py`로 생성합니다.
Last Epoch과 게임 텍스트의 권리는 Eleventh Hour Games에 있습니다. 비공식 팬 프로젝트입니다.
