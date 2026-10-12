# LE 한글 툴팁

라스트 에포크 빌드 사이트 [maxroll.gg](https://maxroll.gg/last-epoch)의 아이템·스킬·패시브 툴팁을
게임 한글 용어([LETrans_Kr](https://github.com/fnrkp089/LETrans_Kr) 또는 공식 번역)로 바꿔 보여주는 크롬 확장입니다.
기계 번역이 아니라 게임 텍스트 테이블에서 뽑은 사전으로 번역합니다.

비공식 팬 프로젝트이며 Eleventh Hour Games, Maxroll과 관련이 없습니다.

## 구조

| 계층 | 파일 | 하는 일 |
|---|---|---|
| 사전 받기 | `src/background.js` | 서비스 워커. [le-kr-dict](https://github.com/fnrkp089/le-kr-dict)의 `version.json`을 6시간마다 확인하고, 바뀌면 사전을 받아 sha256 검증 후 `chrome.storage`에 저장 |
| 사전 읽기 | `src/store.js` | 콘텐츠 스크립트용. 저장된 사전을 읽고, 없으면 백그라운드에 받아오라고 요청 (개발용 빌드는 패키지 안 사전으로 대체) |
| 설정 전달 | `src/bridge.js` | MAIN world는 `chrome.*`를 못 써서 사전을 blob 주소로 만들어 `<html data-lekr-*>`로 넘김 |
| 데이터 치환 | `src/hook.js` → `src/main.js` (MAIN world) | 플래너가 받는 `assets-ng.maxroll.gg/leplanner/game/data.json` 응답을 가로채 설명·이름 필드를 한글로 바꿈 |
| 화면 정리 | `src/dom.js`, `src/dom.css` | 맥스롤 코드가 조립하는 영어 연결어, 수치 어순, 짬뽕 문장 처리. React DOM을 건드리지 않게 텍스트 노드 값만 바꾸고 앞뒤 문구는 `::before/::after`로 그림 |
| 엔진 | `src/core.js` | 사전 조회, 줄 템플릿, 접두·접미 규칙, 데이터 치환 |
| 규칙 | `data/rules.json` | 연결어 → 한국어 어순 규칙, 보충 명사, 플래너 이름표 선택자 |
| 전환 버튼 | `src/toggle.js` | 페이지 오른쪽 아래 [한글 \| LETrans \| 공식 \| 원문] |

`src/main.js`는 `node tools/bundle.js`로 만드는 묶음 파일(core.js + hook.js)이라 직접 고치지 않습니다.

## 사전 만들기

`*_ko.json`은 숫자 ID → 한글이라 같은 ID의 영어 테이블 `*_en.json`이 필요합니다(게임에서 추출한 원문, 저장소에 넣지 않음).

```bash
python3 tools/build_dict.py --ko <LETrans 한글 테이블 폴더> --en <영어 테이블 폴더> --out data/le_ko_letrans.json
python3 tools/build_dict.py --ko <공식 한글 덤프 폴더>     --en <영어 테이블 폴더> --out data/le_ko_official.json
```

이미 배포된 사전으로 개발·테스트만 할 거면 `python3 tools/fetch_dict.py`.

## 테스트

```bash
node tests/run.js letrans      # 실제 맥스롤 문구로 회귀 테스트 (v를 붙이면 전체 출력)
node tests/run.js official
```

실제 페이지 검사는 `tools/audit/audit.js` (사용법은 파일 맨 위 주석).

## 배포

```bash
python3 tools/release.py
```

- `dist/store/le-kr-<버전>.zip`: 웹스토어 업로드용 (사전 미포함)
- `dist/dev/le-kr-maxroll/`: 압축해제 설치용 (사전 포함, 오프라인 동작)
- `dist/dict/`: le-kr-dict 저장소에 올릴 파일 + `version.json`

사전만 바뀌면 `dist/dict/`를 le-kr-dict에 올리면 끝(심사 없음). 코드가 바뀌면 manifest 버전을 올리고 스토어에 zip을 다시 올립니다.

자세한 작업 기록과 결정 이유는 [docs/NOTES.md](docs/NOTES.md).
