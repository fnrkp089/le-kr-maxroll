"""사전의 {0} 자리 문장 중 수치가 아니라 이름이 들어가는 것을 rules.json의 textRules로 자동 변환.

게임 UI 테이블에는 "Unlocked by spending points in the {0} passive tree." 같은 문장이 있는데,
엔진은 templates를 수치가 하나 있을 때만 쓰므로 이름이 들어가면 번역하지 못함.
이런 문장을 정규식 규칙으로 바꿔 두면 직접 규칙을 써넣지 않아도 됨.

  python3 tools/build_dict.py ... (letrans, 공식 둘 다 만든 뒤)
  python3 tools/auto_rules.py

rules.json은 두 사전이 같이 쓰므로 번역이 두 사전에서 같은 문장만 넣음.
자동 규칙은 "auto": true 표시가 붙고, 실행할 때마다 지우고 다시 만듦. 직접 쓴 규칙 뒤, 범용 규칙 앞에 넣음.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES = ROOT / "data" / "rules.json"
# 범용 규칙이 시작하는 자리. 자동 규칙은 이 앞에 넣어 직접 쓴 규칙이 먼저 걸리게 함
ANCHOR = "^Unique or Set (.+)$"
# 수치 자리로 보이는 문장은 templates가 이미 처리하므로 뺌
NUMERIC = re.compile(
    r"#\s*(%|seconds?|meters?|points?|stacks?|times?|hours?|m\b|s\b)|[+\-x]\s*#|level #|tier #|rank #|\(#\)|"
    r"# (more|less|increased|reduced|additional|max|of|to|per|ward|gold|favor|charges?|corruption|forging|memory|reputation|knowledge|random|affix|weaver|bees|echoes)\b|^#|: #|#$|#[!?.]?$|least #|capacity of #|costs #"
)


def candidates():
    a = json.loads((ROOT / "data" / "le_ko_letrans.json").read_text(encoding="utf-8"))["templates"]
    b = json.loads((ROOT / "data" / "le_ko_official.json").read_text(encoding="utf-8"))["templates"]
    out = []
    for en, ko in sorted(a.items()):
        if b.get(en) != ko or en.count("#") != 1 or ko.count("#") != 1 or "\n" in ko:
            continue
        if NUMERIC.search(en) or len(re.sub(r"[^a-z]", "", en)) < 10:
            continue
        esc = lambda t: re.escape(t).replace("\\ ", " ")  # 공백은 그대로 (읽기 쉽게)
        head, tail = en.split("#")
        tail_re = esc(tail[:-1]) + r"\.?" if tail.endswith(".") else esc(tail)
        out.append({"re": "^" + esc(head) + "(.+?)" + tail_re + "$", "ko": ko.replace("#", "$1"), "auto": True})
    return out


def main():
    rules = json.loads(RULES.read_bytes().decode("utf-8"))
    hand = [r for r in rules["textRules"] if not r.get("auto")]
    auto = candidates()
    at = next((i for i, r in enumerate(hand) if r.get("re") == ANCHOR), len(hand))
    block = [{"_comment": "자동 생성 (tools/auto_rules.py): 사전의 {0} 자리 문장에 이름이 들어가는 경우. 직접 고치지 말 것", "auto": True}] + auto
    rules["textRules"] = hand[:at] + block + hand[at:]
    RULES.write_bytes(json.dumps(rules, ensure_ascii=False, indent=2).encode("utf-8"))
    print(f"자동 규칙 {len(auto)}개 (직접 쓴 규칙 {len([r for r in hand if r.get('re')])}개)")


if __name__ == "__main__":
    main()
