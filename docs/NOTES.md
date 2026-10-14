# 작업 기록 (LE 한글 툴팁)

다음에 이 저장소를 여는 사람(또는 Claude)이 "왜 이렇게 했더라"를 복원할 수 있게 남기는 기록.
최신 상태: 0.6.3 (2026-10-14, 칭호 떼기 보완 + 0.6.2의 크롬 번역 대응). 0.6.2 심사를 취소하고 0.6.3으로 같은 날 다시 제출. 0.6.1 (2026-10-13). 0.6.0은 크롬 웹스토어 미등록(링크 공유)으로 심사 제출 (2026-10-12).

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
6. `.lep-name` 칭호 떼기, `labelSelectors`(플래너 능력치 패널·트리 이름표, 스킬 머리 이름, 숙련 보너스, Stat Priority, 능력치 값 툴팁), `buildNameSelectors`(티어리스트·플래너 빌드 이름).
   선택자는 원격 `rules.json`에 있어서 사전 배포만으로 추가됨. 잘못된 CSS 선택자가 들어가면 화면 처리 전체가 멈추니 실제 페이지에서 확인하고 올릴 것.

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
| 작업장에 번역이 있는데 사전에 없음 (벌집, 영원한 일식, "Requires a shield.") | `build_dict.py`가 한글에만 숫자가 있는 문장("조화력 1당"), 같은 범위가 두 번 나오는 문장, 세 단어 이하 문단을 버림 | 한글 쪽 숫자는 글자로 두고, 같은 범위는 순서대로 짝짓고, 마침표로 끝나는 짧은 문단은 살림 |
| 접사 조각 툴팁이 통째로 영어 ("Adds +x Health", "1H Axes") | 맥스롤이 수치 대신 `x`를 쓰고 게임의 "Adds:"에 접사 줄을 붙여 조립 | `core.js`가 `x`를 수치 자리로 처리, `rules.json` textRules에 `Adds`·`1H`·`2H` |
| "1% more More Damage Shock" | 맥스롤이 게임의 "more more Damage per stack of Shock"을 줄여서 조립 | `rules.json` templates에 직접 (Time Rot, Doom도) |
| 검사 도구가 "0보다", "10마다", "5단층"을 숫자 붙음으로 잡음 | `audit.js`의 붙여도 되는 말 목록에 없음 | `UNIT`에 추가 |
| 고친 빌드를 크롬에 자동으로 못 올림 | 크롬 155부터 `--load-extension` 막힘, 디버깅 파이프도 윈도우에서 안 붙음 | `tools/audit/harness.js`: 임시 크롬에 소스 주입 |
| 능력치 툴팁 설명이 사전에 있는데 안 붙음 ("Each point of intelligence grants 4% …") | `build_dict.py`의 `numbered()`가 한글에만 숫자가 있는 문장("1포인트당")을 버림 | 영어 숫자가 한글에 한 번씩 있으면 짝짓고 나머지는 글자로 둠 (템플릿 +282) |
| 플래너 고정 글자(스킬 머리 이름, 숙련 보너스, Stat Priority, 능력치 값 툴팁)가 영어 | `lep-` 클래스가 아니라 CSS 모듈 클래스·`.leplanner-tooltip`이라 화면 계층 범위 밖 | `rules.json`의 `labelSelectors`에 선택자 추가 (코드 수정 없음) |
| 능력치 툴팁의 "Amulet:"이 콜론 없이 "목걸이"로 | 느슨한 비교가 문장부호를 무시하고 먼저 맞음 | 콜론까지 넣은 nouns("Amulet:" → "목걸이:")가 우선함 |
| crawl.js가 끝나지 않음 | 보스 전리품 표 페이지가 여러 창 동시 실행 중 멈춰 응답이 영영 안 옴 (혼자 돌리면 괜찮음) | `harness.js`의 ev에 60초 제한 |
| 크롬 번역을 누르면 툴팁·이름이 다 깨짐 | 구글 번역이 우리가 바꾼 한글을 영어로 보고 다시 번역 ("근접 공격" → "최대 공격"), 툴팁도 뜰 때마다 번역 | `dom.js`의 `guard()`: 게임 내용 칸·툴팁·이름표에 `translate="no"`. 변경을 본 즉시 붙임 (0.6.2) |
| 플래너 장비 이름에 칭호가 남음 ("도적 산봉우리 - 황소", "집게 … 신상 - 투석기") | 맥스롤 `affixTitle` 목록에 없는 칭호(Rogue's)가 있고, 같은 말이 접두·접미 칭호 양쪽에 있으면("투석기", "- 투석기") 짧은 쪽이 먼저 떨어져 "-"만 남음. 하나라도 못 떼면 전체를 포기했음 | `stripTitles` 보완: " - 접미"를 떼고 앞 단어를 두 개까지 떼어 사전에 있는 이름이 나오면 씀 (0.6.3) |
| 레임툴즈와 충돌 | 둘 다 같은 글자를 바꿈 | maxroll.gg에서 레임툴즈 끄라고 안내 |

크롬 번역(구글 번역) 쪽 사실 (2026-10-14 확인):
- `translate="no"`는 지킴. 그 안에서 `translate="yes"`로 되살리는 건 안 통함.
- 문장 속 제외 조각(본문의 스킬·아이템 이름표)에서 문장을 끊어 조각마다 따로 번역함 → 이름표가 낀 문장은 어색해짐 ("공격 [휘둘러치기] 쌓다 [전장의 함성 광전사] 그리고 …").
  제외하지 않으면 문장은 매끄럽지만 이름이 바뀌고("휘둘러치기" → "이벤트러치기") 이름표 요소를 복제해 글자를 아무 자리에나 나눠 담음. 이름을 지키는 쪽을 택함.
- 플래너 메모(`role="textbox"` 편집기)는 우리와 상관없이 번역하지 않음.
- 번역된 페이지는 `<html class="translated-ltr" lang="ko">`, 바꾼 글자는 `<font>`로 감쌈.
- 검사: `node tools/audit/translate.js [페이지] [선택자]` (번역 없이·켜고 두 번 열어 제외 칸과 툴팁 글자 비교).

맥스롤 쪽 사실:
- 툴팁은 합성 마우스 이벤트(pointerover/mouseover 등, 안쪽 요소 대상)로도 열림 → 자동 검사 가능.
- 설명 렌더러가 `{X}`를 `<em>X</em>`로, `\n`을 `<br>`로 바꿈(한글 포함). 그래서 데이터 계층 사전엔 한글 `{용어}`를 남기고, 화면 계층에서 직접 쓰는 문장은 중괄호를 뗌.
- 한국어 로케일에서 큰 숫자를 "1.9만", "7.8천" 식으로 표기.
- 플래너 능력치 패널·트리 이름표는 `lep-` 클래스가 아니라 CSS 모듈 클래스(`stats_StatSection`, `masteries_Masteries__title` 등).

## 5. 검사 이력 (0.5.x → 0.6.0)

- 가이드 12개, 티어리스트 3개, 플래너 3개(장비·축복·능력치 패널·메모·패시브·스킬·위버 트리), 툴팁 약 900개를 숨은 Alt 설명까지 자동 검사해 오류 0건.
- 회귀 테스트: 줄 55/55, 텍스트 215/216, 특수효과 16/16 (LETrans·공식 둘 다).
- 스토어 빌드(사전 없이 시작)로 원격 사전 받기까지 확인.
- 0.6.1 (2026-10-13): 가이드 73개 전부 + 자료 글 85개 + 티어리스트 3개 + 플래너 5개 + 데이터베이스를 돌려 남은 영어를 수집.
  고친 뒤 `crawl.js`(창 5개)로 76페이지·툴팁 1,287개 재검사, 새 문제 0.
- 사전 2026.10.13-2227: 플래너 빌드 5개 before/after. 고정 글자 영어 218/353 → 0, 능력치 값 툴팁 영어 줄 88% → 약 1%.
  최종 규칙으로 `crawl.js` 8창: 77페이지·툴팁 1,355개, 문제 줄은 Sigils Of Hope 1건. 마지막에 넣은 "이름: 값" 규칙은 가이드 전체로 재검사하지 않음.

## 6. 작업 순서 (자주 하는 일)

- **한글패치(LETrans) 새 버전 배포 후**: 워크벤치의 한글 테이블 + 영어 테이블로 `build_dict.py` → `node tests/run.js letrans` →
  `python3 tools/release.py` → `dist/dict/`를 le-kr-dict에 커밋.
  사전 두 개를 만든 뒤 `python3 tools/auto_rules.py`로 이름 자리 문장 규칙을 다시 만듦 (rules.json의 `"auto": true` 항목을 지우고 새로 넣음).
  공식 사전은 작업장 `official_snapshots/<빌드>/ko`와 `en`(`official_update_check.py`가 게임에서 뽑은 최신 공식)으로 만들고 meta.source를 "공식 번역"으로 바꿈.
  `ko_dump_new`/`en_dump_new`는 2026-10-02 추출본이라 지금 공식과 다름. LETrans 사전의 `--en`도 같은 스냅샷 영문을 씀.
- **미번역 문구 처리**: 팝업 "미번역 내보내기" → 먼저 작업장 테이블(`lastepoch-kr-patch_workbench-main`의 `en_dump_new` + `ko_fix_origin5`)에서 태그를 떼고 느슨하게 검색.
  맥스롤이 줄이거나 조립한 형태("more More Damage Shock" ← "more more Damage per stack of Shock")이거나 빌더가 버린 문장인 경우가 많음.
  그래도 없으면 `rules.json`의 `nouns`/`templates`/`textRules`에 추가 → 테스트 → 사전 배포.
- **코드 수정 후**: `node tools/bundle.js`(release.py가 자동 실행) → manifest 버전 올림 → 스토어 패키지 탭에 zip 업로드.
- **실제 페이지 검사**: 여러 탭에 가이드·플래너를 띄우고 탭마다 audit.js 실행(skip/max로 나눔). settle 1500ms면 충분.
  확장을 설치하지 않고 로컬 사전·고친 소스로 돌리려면 `python3 tools/release.py` 뒤 `node tools/audit/crawl.js 5` (약 13분).
- **맥스롤이 값으로 걸러내는 문자열**: 필터가 비면 `rules.json`의 `dataKeep`에 필드와 정규식 추가 (축복 Grand 필터가 그 예).
- **미번역 내보내기에 사이트 UI가 섞이면**: `rules.json`의 `missIgnore`에 추가.

- **자동 검사 양 조절**: 맥스롤은 Cloudflare 뒤에 있음. 2026-10-13 하루에 약 600페이지를 열었고 차단은 없었지만, 전체 crawl은 배포 직전에 한 번, 창은 3~4개로.
  캡차나 차단 화면이 보이면 그날은 자동 검사를 멈춤 (같은 IP라 평소 접속도 막힘).

## 7. 남은 일 / 아이디어

- 웹스토어 심사 결과 대응 (반려 시 메일 내용 기준으로 수정).
- 파이어폭스 지원 요청이 들어옴 (2026-10-13). 아직 시도 안 함. 걸릴 곳: 백그라운드가 `service_worker`라 manifest를 따로 써야 함,
  `browser_specific_settings.gecko.id` 필요, `world: "MAIN"`은 파이어폭스 128 이상, 사전을 blob 주소로 페이지에 넘기는 부분은 해봐야 앎. 배포는 AMO에 따로.
- 반응 좋으면 공개로 전환, 마키 프로모션 타일(1400×560) 제작.
- 데이터베이스 페이지: 확장은 동작함. 스킬 카드 설명 약 190종(맥스롤 자체 문구), `Breakdown` 라벨이 영어. 커뮤니티 빌드 목록은 번역 대상 없음.
- 플래너에 남은 영어(게임 테이블에 없음): "Increases the base damage of … spells and attacks." 7종, 하수인 레벨 문장, 비껴가는 타격 설명(맥스롤 "half damage" ≠ 게임 "35% less"). Stat Priority 부위 이름·능력치 종류 선택은 사이트 UI라 둠.
- 범위 다듬기(소유자 의견: 아이템·노드·스킬이면 충분): 자동 규칙 50개 중 게임 문장만 남기기, 범용 규칙 "이름:"·"이름: 값"을 능력치 툴팁 이름 목록으로 좁히기.
  능력치 툴팁 소제목 6개("추가 출처:" 등)와 플래너 빌드 제목·태그는 맥스롤 UI에 가까워 빼도 됨.
- 0.6.4 후보(코드): "비제한 수치: 81%" 값의 흰색 글자색 유지 (지금은 줄 전체를 한 번에 바꿔 색이 사라짐).
- 데이터베이스 접사 조각은 앞 50개만 확인(48개 정상). 약 550개 전체는 미확인.
- 게임 테이블에 원문이 없어 남은 것: Sigils Of Hope의 "Consumes all sigils…" (게임은 Symbols of Hope로 이름이 바뀜).
