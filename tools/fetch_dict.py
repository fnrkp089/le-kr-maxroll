"""개발·테스트용: le-kr-dict 저장소의 최신 사전을 data/ 로 받아온다 (sha256 확인).
  python3 tools/fetch_dict.py
"""
import hashlib, json, urllib.request
from pathlib import Path

BASE = "https://raw.githubusercontent.com/fnrkp089/le-kr-dict/main/"
DATA = Path(__file__).resolve().parent.parent / "data"

index = json.loads(urllib.request.urlopen(BASE + "version.json").read())
for name, meta in index["files"].items():
    if name == "rules.json":
        continue  # 규칙은 이 저장소의 data/rules.json이 원본
    body = urllib.request.urlopen(BASE + name).read()
    if hashlib.sha256(body).hexdigest() != meta["sha256"]:
        raise SystemExit(f"{name}: 해시 불일치")
    (DATA / name).write_bytes(body)
    print(f"{name} {len(body)//1024}KB")
print("사전 버전", index["version"])
