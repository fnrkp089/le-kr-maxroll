"""LETrans_Kr 번역 테이블로 확장용 사전(data/le_ko_*.json)을 만든다.

필요한 것
  --ko   LETrans_Kr 릴리스의 *_ko.json 폴더 (없으면 --download로 최신 릴리스를 받음)
  --en   같은 숫자 ID로 된 영어 테이블 *_en.json 폴더 (작업장에서 추출한 원문)

선택
  --maxroll-data  맥스롤 data.json. 넣으면 실제로 몇 개가 매칭되는지 커버리지 보고서를 같이 출력

사용 예
  py tools/build_dict.py --download --en ../workbench/en --out data/le_ko_letrans.json
  py tools/build_dict.py --ko kr-patch --en en --maxroll-data data.json
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

RELEASE_BASE = "https://github.com/fnrkp089/LETrans_Kr/releases/latest/download"

# 같은 영어 문구가 여러 테이블에 다른 번역으로 있으면 앞쪽 테이블을 우선함.
# 툴팁에 보이는 아이템·속성 용어가 대사·퀘스트보다 중요하기 때문.
TABLE_PRIORITY = [
    "Item_Names", "Item_Affixes", "Properties", "Skills", "Abilities", "Ailments",
    "Descriptors", "Common", "UI", "Monolith_Timelines", "MonolithObjectives",
    "VaultMods", "MonsterMods", "Actors", "Abilities_Enemy", "GameGuide",
    "MapObjects", "Scenes", "Quests", "Cosmetics", "Dialogue", "Cinematics", "MtxAds",
]

# 툴팁·플래너에 안 나오는 대사·연출 테이블은 사전 크기만 키우므로 기본 제외
SKIP_TABLES = {"Dialogue", "Cinematics", "MtxAds", "Scenes"}

TAG = re.compile(r"<[^<>]+>")
# {0} 자리, 그리고 일부 테이블의 [최소,최대,소수점] 범위 표기도 수치 자리로 봄
NUMERIC_SLOT = re.compile(r"\{0(?::[^}]*)?\}|\[-?[\d.]+,-?[\d.]+(?:,-?[\d.]+)?\]")
ANY_NUMERIC_SLOT = re.compile(r"\{\d+(?::[^}]*)?\}|\[-?[\d.]+,-?[\d.]+(?:,-?[\d.]+)?\]")


PARA = re.compile(r"(?:\s*(?:\n|<br\s*/?>)\s*)+", re.I)
HANGUL_BRACE = re.compile(r"\{([^{}]*[\uac00-\ud7a3][^{}]*)\}")
BRACE = re.compile(r"\{([^{}0-9][^{}]*)\}")
NUM = re.compile(r"\d+(?:[.,]\d+)*")


def paragraphs(en_raw: str, ko_raw: str):
    """여러 문단짜리 설명은 맥스롤이 문단별로 따로 그리므로 문단 단위 쌍도 만듦."""
    en_p = [p for p in PARA.split(en_raw) if p.strip()]
    ko_p = [p for p in PARA.split(ko_raw) if p.strip()]
    if len(en_p) > 1 and len(en_p) == len(ko_p):
        # 문단 수가 같아도 한국어에서 문단이 합쳐지거나 갈리면 어긋남.
        # 짧은 제목성 문단은 빼고, 길이 비율이 맞는 쌍만 씀.
        out = []
        for e, k in zip(en_p, ko_p):
            e, k = e.strip(), k.strip()
            if len(e.split()) < 4:
                continue
            if not 0.15 <= len(k) / max(1, len(e)) <= 1.5:
                continue
            out.append((e, k))
        return out
    return []


def numbered(en: str, ko: str):
    """숫자가 든 문장을 숫자 자리 템플릿으로. 스킬 레벨·장비에 따라 숫자가 바뀌어도 맞추기 위함.
    한글 쪽 숫자 순서가 다를 수 있어서 같은 숫자끼리 짝지음."""
    en_n, ko_n = NUM.findall(en), NUM.findall(ko)
    if not en_n or sorted(en_n) != sorted(ko_n) or len(set(en_n)) != len(en_n):
        return None
    key = NUM.sub("#", en)
    pos = {n: i for i, n in enumerate(en_n)}
    tpl = NUM.sub(lambda m: "{%d}" % pos[m.group(0)], ko)
    return key, tpl


RANGE = re.compile(r"\[-?[\d.]+,-?[\d.]+(?:,-?[\d.]+)?\]")


def ranged(en: str, ko: str):
    """범위 표기 [200,350,3]를 숫자 자리로 바꿔 numbered 템플릿을 만듦 (맥스롤은 이 자리에 (200-350) 값을 그림)."""
    en_r, ko_r = RANGE.findall(en), RANGE.findall(ko)
    if not en_r or sorted(en_r) != sorted(ko_r) or len(set(en_r)) != len(en_r):
        return None
    if re.search(r"\{\d", en + ko):
        return None
    marks = {r: str(7770001 + i) for i, r in enumerate(en_r)}
    e2 = RANGE.sub(lambda m: marks[m.group(0)], en)
    k2 = RANGE.sub(lambda m: marks[m.group(0)], ko)
    en_n, ko_n = NUM.findall(e2), NUM.findall(k2)
    if sorted(en_n) != sorted(ko_n):
        return None
    # 범위가 아닌 일반 숫자는 같은 값이 여러 번 나와도 됨 (화면에서도 같은 숫자로 나오므로)
    pos = {}
    for i, n in enumerate(en_n):
        pos.setdefault(n, i)
    return NUM.sub("#", e2), NUM.sub(lambda m: "{%d}" % pos[m.group(0)], k2)


def clean(text: str) -> str:
    """리치 텍스트 태그 제거, 공백 정리. 맥스롤 화면에는 태그가 안 나오므로 키에서도 뺌."""
    return re.sub(r"\s+", " ", TAG.sub("", text)).strip()


def clean_ko(text: str) -> str:
    """번역문은 문단 줄바꿈을 살려둠 (맥스롤이 설명의 줄바꿈을 그대로 그림)."""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    # {매} 같은 용어 링크 표시는 남겨둠: 데이터 치환으로 들어가면 맥스롤이 {..}를 강조(<em>)로 그려줌.
    # 화면 계층에서 직접 쓰는 경우엔 dom.js가 중괄호를 떼고 씀.
    lines = [re.sub(r"[ \t]+", " ", TAG.sub("", l)).strip() for l in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def norm(text: str) -> str:
    return clean(text).replace("’", "'").lower()


def table_name(path: Path) -> str:
    return re.sub(r"_(ko|en)$", "", path.stem)


def load_tables(folder: Path, lang: str) -> dict[str, dict[str, str]]:
    tables = {}
    for path in sorted(folder.glob(f"*_{lang}.json")):
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise SystemExit(f"{path.name}: ID → 문자열 형태의 JSON이 아님")
        tables[table_name(path)] = {str(k): v for k, v in data.items() if isinstance(v, str)}
    return tables


def download_release(dest: Path) -> Path:
    """최신 LETrans_Kr 번역 릴리스를 받아 SHA256SUMS로 확인한 뒤 압축 해제."""
    def get(name: str) -> bytes:
        with urllib.request.urlopen(f"{RELEASE_BASE}/{name}", timeout=60) as r:
            return r.read()

    sums = {}
    for line in get("SHA256SUMS").decode("utf-8").splitlines():
        parts = line.split()
        if len(parts) == 2:
            sums[parts[1]] = parts[0]
    zip_name = next((n for n in sums if n.startswith("kr-patch-") and n.endswith(".zip")), None)
    if not zip_name:
        raise SystemExit("릴리스에서 kr-patch-*.zip을 찾지 못함")
    blob = get(zip_name)
    if hashlib.sha256(blob).hexdigest() != sums[zip_name]:
        raise SystemExit(f"{zip_name} 해시 불일치")
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for member in z.namelist():
            if member.endswith("_ko.json") and "/" not in member.strip("/") and ".." not in member:
                (dest / member).write_bytes(z.read(member))
    print(f"받음: {zip_name} → {dest}")
    return dest


# 툴팁 속성 줄의 명사는 아이템 이름표(Item_Names)보다 속성 쪽 표기를 따라야 함.
# 예: Armor → 방어도(속성) / 방어구(아이템 종류)
STAT_TABLES = ["Item_Affixes", "Descriptors", "Properties", "Skills"]


def build(ko_tables, en_tables):
    """영어 원문별로 한글 후보를 모은 뒤 가장 많이 쓰인 번역을 고름(동수면 테이블 우선순위).

    게임 테이블은 영어엔 수치 자리가 없고 한글에만 {0}이 있음.
      Increased Bleed Duration → 출혈 지속시간 {0} 증가
    이런 쌍은 slotted(값 자리가 있는 이름)로, 자리 없는 쌍은 names로 분류.
    """
    usable = {t for t in en_tables if t not in SKIP_TABLES}
    order = [t for t in TABLE_PRIORITY if t in usable] + sorted(usable - set(TABLE_PRIORITY))
    rank = {t: i for i, t in enumerate(order)}
    votes: dict[tuple[str, str], dict[str, list]] = {}  # (kind, norm en) -> ko -> [count, best_rank, table, en]
    stat_votes: dict[str, dict[str, list]] = {}

    def vote(bucket, key, ko, table, en):
        entry = bucket.setdefault(key, {}).setdefault(ko, [0, rank[table], table, en])
        entry[0] += 1
        entry[1] = min(entry[1], rank[table])

    for table in order:
        en_t, ko_t = en_tables.get(table, {}), ko_tables.get(table, {})
        for key, en_raw in en_t.items():
            ko_raw = ko_t.get(key)
            if not ko_raw or not en_raw:
                continue
            en, ko = clean(en_raw), clean_ko(ko_raw)
            if not en or not ko or en == ko or not re.search(r"[A-Za-z]", en):
                continue
            en_slots, ko_slots = ANY_NUMERIC_SLOT.findall(en), ANY_NUMERIC_SLOT.findall(ko)
            if en_slots:
                # 영어에도 자리가 있는 문장: {0} 하나씩일 때만 완성형 템플릿으로
                if len(en_slots) == 1 == len(ko_slots) and NUMERIC_SLOT.fullmatch(en_slots[0]):
                    vote(votes, ("templates", norm(NUMERIC_SLOT.sub("#", en))), ANY_NUMERIC_SLOT.sub("#", ko), table, en)
                # [최소,최대,소수] 범위가 여러 개인 고유 효과 문장: 범위와 일반 숫자를 모두 숫자 자리로
                nb = ranged(en, ko)
                if nb:
                    vote(votes, ("numbered", norm(nb[0])), nb[1], table, en)
                continue
            if ko_slots:
                if len(ko_slots) == 1:
                    vote(votes, ("slotted", norm(en)), ANY_NUMERIC_SLOT.sub("#", ko), table, en)
                continue
            pairs = [(en, ko)] + [(clean(a), clean_ko(b)) for a, b in paragraphs(en_raw, ko_raw)]
            # 설명 안의 {용어} 링크도 짝지음: {Everlasting Poison} ↔ {영구적인 중독}
            # 한국어는 어순이 달라 링크 순서가 바뀌므로, 링크가 딱 하나인 문장만 씀
            en_b, ko_b = BRACE.findall(en_raw), BRACE.findall(ko_raw)
            if len(en_b) == 1 == len(ko_b):
                pairs.append((en_b[0], clean_ko(ko_b[0])))
            for e, k in pairs:
                if not e or not k or not re.search(r"[A-Za-z]", e) or ANY_NUMERIC_SLOT.search(e + k):
                    continue
                vote(votes, ("names", norm(e)), k, table, e)
                nb = numbered(e, k)
                if nb:
                    vote(votes, ("numbered", norm(nb[0])), nb[1], table, e)
            if table in STAT_TABLES:
                vote(stat_votes, norm(en), ko, table, en)

    def pick(cands):
        return sorted(cands.items(), key=lambda kv: (-kv[1][0], kv[1][1]))

    out = {"names": {}, "slotted": {}, "templates": {}, "stats": {}, "numbered": {}}
    conflicts = []
    for (kind, k), cands in votes.items():
        ranked = pick(cands)
        out[kind][k] = ranked[0][0]
        if kind == "names" and len(ranked) > 1:
            conflicts.append({"en": ranked[0][1][3], "kept": ranked[0][0],
                              "others": {ko: c[0] for ko, c in ranked[1:]}, "kept_count": ranked[0][1][0]})
    for k, cands in stat_votes.items():
        best = pick(cands)[0][0]
        if best != out["names"].get(k):
            out["stats"][k] = best
    return out, conflicts


def coverage(maxroll_data: Path, names: dict) -> dict:
    """맥스롤 data.json의 표시용 문자열 중 사전에 있는 비율."""
    fields = {
        "name", "displayName", "affixName", "affixDisplayName", "affixTitle", "nodeName",
        "description", "altText", "loreText", "statName", "propertyName", "defaultAltText",
        "overrideAltText", "pointBonusDescription",
    }
    with maxroll_data.open(encoding="utf-8") as f:
        data = json.load(f)
    hit, miss = {}, {}

    def walk(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(v, str) and k in fields and re.search(r"[A-Za-z]", v):
                    bucket = hit if norm(v) in names else miss
                    bucket.setdefault(k, set()).add(v)
                else:
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(data)
    report = {}
    for k in sorted(set(hit) | set(miss)):
        h, m = len(hit.get(k, ())), len(miss.get(k, ()))
        report[k] = {"hit": h, "miss": m, "rate": round(h / (h + m), 3) if h + m else 0,
                     "miss_examples": sorted(miss.get(k, ()))[:15]}
    return report


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ko", type=Path, help="*_ko.json 폴더")
    p.add_argument("--download", action="store_true", help="최신 LETrans_Kr 릴리스를 받아서 사용")
    p.add_argument("--en", type=Path, required=True, help="*_en.json 폴더 (ID가 ko와 같아야 함)")
    p.add_argument("--maxroll-data", type=Path, help="커버리지 확인용 맥스롤 data.json")
    p.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "le_ko_letrans.json")
    args = p.parse_args(argv)

    ko_dir = args.ko
    if args.download:
        ko_dir = download_release(Path(__file__).resolve().parent / ".cache" / "kr")
    if not ko_dir:
        p.error("--ko 또는 --download 중 하나가 필요함")

    ko_tables = load_tables(ko_dir, "ko")
    en_tables = load_tables(args.en, "en")
    if not ko_tables or not en_tables:
        raise SystemExit("테이블을 찾지 못함 (*_ko.json / *_en.json)")
    missing = sorted(set(en_tables) - set(ko_tables))
    if missing:
        print("한글 테이블 없음:", ", ".join(missing), file=sys.stderr)

    maps, conflicts = build(ko_tables, en_tables)
    names = {**maps["names"], **maps["slotted"], **maps["stats"]}
    out = {
        "meta": {
            "source": "LETrans_Kr",
            "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            **{k: len(v) for k, v in maps.items()},
            "conflicts": len(conflicts),
        },
        **{k: dict(sorted(v.items())) for k, v in maps.items()},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("사전:", ", ".join(f"{k} {len(v)}" for k, v in maps.items()), f"/ 번역 갈림 {len(conflicts)} → {args.out}")

    report_dir = args.out.parent.parent / "reports"
    report_dir.mkdir(exist_ok=True)
    (report_dir / "conflicts.json").write_text(json.dumps(conflicts, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.maxroll_data:
        rep = coverage(args.maxroll_data, names)
        (report_dir / "coverage.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
        for k, v in rep.items():
            print(f"  {k:24s} {v['hit']:5d}/{v['hit'] + v['miss']:5d}  {v['rate']:.0%}")


if __name__ == "__main__":
    main()
