# 작업 기록 (LE 한글 툴팁)

다음에 이 저장소를 여는 사람(또는 Claude)이 "왜 이렇게 했더라"를 복원할 수 있게 남기는 기록.
최신 상태: 0.6.0, 크롬 웹스토어 미등록(링크 공유)으로 심사 제출 (2026-10-12).

## 1. 목표와 범위

- maxroll.gg 라스트 에포크 페이지(가이드, 플래너, 티어리스트)의 게임 내용을 한글로.
- 번역 소스는 기계 번역이 아니라 게임 텍스트 테이블. LETrans_Kr(커스텀)과 공식 번역을 토글.
- 맥스롤 사이트 UI(메뉴, 버튼, Equipment/Stat Priority 등)는 번역 대상 아님. 게임 내용만.
- 아이템 이름은 LE Tools처럼 고유 이름만 표시(접사 칭호 떼기). 팝업에서 칭호 붙이기 선택 가능.
- 수치와 한글은 붙이지 않음: "150 하수인 피해" (붙여도 되는 단위·조사는 `core.js`의 `ATTACHED`).

## 2. 구조와 데이터 흐름

1. `background.js`가 le-kr-dict에서 사전(LETrans, 공식, rules)을 받아 `chrome.storage.local`에 문자열로 저장
   (`unlimitedStorage` 필요. 사전 하나가 약 6MB).
2. 페이지 진입 시 `store.js` + `bridge.js`(ISOLATED, document_start)가 사전을 읽어 blob 주소로 만들고 `html.dataset.lekrDict/lekrRules`에 넣음.
3. `main.js`(MAIN world)가 `window.fetch`를 감싸 `data.json` 응답을 가로채 `transformData`로 표시 필드를 한글로 바꿈.
   이때 `affixTitle` 목록(칭호 떼기용)과 "바꾼 한글 → 원래 영어" 역방향 표(reverse)를 `postMessage`로 보냄.
4. `dom.js`(ISOLATED, document_idle)가 MutationObserver로 툴팁이 뜰 때마다 남은 영어와 어순을 정리.

### 사전 구성 (`tools/build_dict.py`)

| 키 | 내용 |
|---|---|
| `names` | 자리 없는 쌍. 이름·문장. 같은 영어에 번역이 여럿이면 다수결 |
| `slotted` | 영어엔 수치 자리가 없고 한글에만 `{0}`이 있는 쌍 → 툴팁 속성 줄의 정답 어순 |
| `templates` | 영어·한글 둘 다 `{0}` 하나 |
| `stats` | 속성 문맥에서 일반 사전과 다른 표기 (Armor → 방어도 / 방어구) |
| `numbered` | 숫자를 `#`로 바꾼 문장 템플릿. `[200,350,3]` 범위 표기 문장도 여기 (`ranged()`) |

- 여러 문단 설명은 문단 단위 쌍도 만듦(길이 비율이 맞는 것만).
- 설명 속 `{용어}` 링크는 링크가 딱 하나일 때만 짝지음. 한국어는 어순이 달라 여러 개면 순서가 바뀜.
  (예전에 순서대로 짝지었다가 Werebear → "넝쿨의 목소리" 같은 오역이 났음. LETrans 번역 잘못이 아니었음.)
- 대사·연출 테이블(Dialogue, Cinematics, MtxAds, Scenes)은 제외.

### 화면 계층 처리 순서 (`dom.js` process)

1. `.lep-property` 줄: 수치 하나 → `translateLine`, 여러 개 → `translateMulti`(numbered 템플릿, 수치 색은 사라짐),
   링크·등급 색 조각이 있으면 `translateLinked`(조각을 자리표시자 U+E001~로 바꿔 문장째 번역, 순서가 같을 때만 적용), 마지막으로 `translateBlock`.
2. `.lep-scaling-stat`(능력치 증감 줄): `translateLinked`로 회색 `(포인트당 4%)` 조각 유지.
3. 줄 밖 `.lep-value`: "+30 per point" → "포인트당 +30" (값 칸 전체로 먼저 시도).
4. 나머지 텍스트 노드: `lookupText`. 플래너 메모 줄글(`.lep-RichTextEditor`)은 정확히 일치할 때만.
5. 글자 조각이 여럿인 작은 요소: 문장째 다시 시도.
6. `.lep-name` 칭호 떼기, `labelSelectors`(플래너 능력치 패널·트리 이름표), `buildNameSelectors`(티어리스트 빌드 이름).

## 3. 결정과 이유

- **데이터 치환 + 화면 정리 2단 구조**: 데이터만 바꾸면 맥스롤이 영어 연결어로 조립하는 줄(Minions have …, +X to …)이 남고,
  화면만 바꾸면 긴 설명이 문장 단위로 안 맞음. 둘 다 필요.
- **`name`, `title`, `affixTitle` 필드는 데이터에서 안 바꿈**: 맥스롤이 검색·연결 키로 쓸 수 있어서. 화면 계층에서 번역.
- **짬뽕 문장 되돌리기(deKo)**: 데이터 계층이 바꾼 상태이상·아이템 종류 이름을 맥스롤이 영어 문장에 끼워 넣음("Chance to 감속 on Spell Hit").
  reverse 표 + 사전 역색인(`koCandidates`)으로 영어 후보 조합을 만들어 번역에 성공하는 것을 씀.
- **사전 원격 배포(le-kr-dict, 공개 저장소)**: 레임툴즈도 같은 방식. 패키지 12MB → 51KB, 번역 수정이 심사 없이 반영,
  권리 문제 제기가 있으면 그 파일만 내리면 됨. 웹스토어 정책상 원격 "코드"는 금지지만 JSON 데이터는 허용.
- **공식 번역 포함**: 공식 용어 토글을 제공. 문제가 되면 le-kr-dict에서 `le_ko_official.json`만 내리면 됨.
- **이름에서 Maxroll 뺌**: 남의 상표라 심사 리스크. 설명에만 "maxroll.gg에서 동작"으로.
- **권한 최소화**: `storage`, `unlimitedStorage`만. host_permissions 없음(콘텐츠 스크립트 matches로 충분, 사전 fetch는 CORS 허용).
- **커밋에 Claude 공동작성자 표시 안 함**: 저장소 주인 요청.

## 4. 삽질 기록 (재발 주의)

| 증상 | 원인 | 해결 |
|---|---|---|
| 데이터 치환이 한 번도 안 됨 (`LEKR` undefined) | 크롬은 같은 파일을 content_scripts 여러 항목에 넣으면 한 번만 주입 → MAIN world에 core.js가 없었음 | MAIN용 묶음 파일 `src/main.js` (`tools/bundle.js`) |
| 백그라운드 탭에서 번역이 1초 넘게 늦음 | setTimeout이 백그라운드에서 밀림 | 처리 예약을 MessageChannel로 |
| 같은 이유로 검사 도구가 멈춤 | 〃 | audit.js의 sleep도 MessageChannel |
| "(4% 포인트당" 괄호 잘림 | 느슨한 비교(문장부호 무시)로 " per point)"를 찾으며 ")" 손실 | 짝 안 맞는 소괄호만 되살림 (`}` 같은 건 살리지 않음) |
| "2% 증가 마나 효율" | 아이템 이름 조립 규칙이 " increased Mana Efficiency"까지 조립 | 단어가 대문자로 시작할 때만 조립 |
| "Unique 철 그리브", "Mage 투구" | 데이터 계층 한글이 영어 문장에 끼워짐 | deKo |
| 위버 노드 설명 영어 | 맥스롤 데이터가 게임 덤프보다 최신 패치 문구 | `rules.json` nouns에 직접 번역 추가 |
| 플래너 메모 "버전:?" | 줄글 단어를 느슨한 비교로 번역 | 줄글은 정확 일치만 |
| 웹스토어 대시보드 자동 조작 불가 | 크롬이 웹스토어 페이지 스크립팅을 막음 ("The extensions gallery cannot be scripted") | 사람이 직접 입력 |
| 데이터베이스 축복 Grand 필터가 빈 표 | 맥스롤이 `displayName`이 "Grand "로 시작하는지로 걸러내는데 데이터 계층이 "상급 …"으로 바꿈 | `rules.json`의 `dataKeep`(필드별 정규식)에 걸리는 값은 데이터에서 안 바꾸고 화면 계층이 번역 |
| 레임툴즈와 충돌 | 둘 다 같은 글자를 바꿈 | maxroll.gg에서 레임툴즈 끄라고 안내 |

맥스롤 쪽 사실:
- 툴팁은 합성 마우스 이벤트(pointerover/mouseover 등, 안쪽 요소 대상)로도 열림 → 자동 검사 가능.
- 설명 렌더러가 `{X}`를 `<em>X</em>`로, `\n`을 `<br>`로 바꿈(한글 포함). 그래서 데이터 계층 사전엔 한글 `{용어}`를 남기고, 화면 계층에서 직접 쓰는 문장은 중괄호를 뗌.
- 한국어 로케일에서 큰 숫자를 "1.9만", "7.8천" 식으로 표기.
- 플래너 능력치 패널·트리 이름표는 `lep-` 클래스가 아니라 CSS 모듈 클래스(`stats_StatSection`, `masteries_Masteries__title` 등).

## 5. 검사 이력 (0.5.x → 0.6.0)

- 가이드 12개, 티어리스트 3개, 플래너 3개(장비·축복·능력치 패널·메모·패시브·스킬·위버 트리), 툴팁 약 900개를 숨은 Alt 설명까지 자동 검사해 오류 0건.
- 회귀 테스트: 줄 55/55, 텍스트 215/216, 특수효과 16/16 (LETrans·공식 둘 다).
- 스토어 빌드(사전 없이 시작)로 원격 사전 받기까지 확인.

## 6. 작업 순서 (자주 하는 일)

- **한글패치(LETrans) 새 버전 배포 후**: 워크벤치의 한글 테이블 + 영어 테이블로 `build_dict.py` → `node tests/run.js letrans` →
  `python3 tools/release.py` → `dist/dict/`를 le-kr-dict에 커밋.
- **미번역 문구 처리**: 팝업 "미번역 내보내기" → `rules.json`의 `nouns`/`templates`/`textRules`에 추가 → 테스트 → 사전 배포.
- **코드 수정 후**: `node tools/bundle.js`(release.py가 자동 실행) → manifest 버전 올림 → 스토어 패키지 탭에 zip 업로드.
- **실제 페이지 검사**: 여러 탭에 가이드·플래너를 띄우고 탭마다 audit.js 실행(skip/max로 나눔). settle 1500ms면 충분.

## 7. 남은 일 / 아이디어

- 웹스토어 심사 결과 대응 (반려 시 메일 내용 기준으로 수정).
- 반응 좋으면 공개로 전환, 마키 프로모션 타일(1400×560) 제작.
- 커뮤니티 빌드, 데이터베이스(아이템 목록) 페이지는 아직 검사 안 함.
