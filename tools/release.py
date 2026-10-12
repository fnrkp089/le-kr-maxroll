"""배포 묶음 만들기.
  dist/store/le-kr-<ver>.zip : 웹스토어 업로드용 (manifest.json이 zip 맨 위, 사전 미포함)
  dist/dev/le-kr-maxroll/   : 압축해제 설치용 (사전 포함, 오프라인에서도 동작)
  dist/dict/                : 사전 저장소(le-kr-dict)에 올릴 파일 + version.json(sha256)
"""
import hashlib, json, shutil, subprocess, sys, zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
subprocess.run(["node", str(ROOT / "tools" / "bundle.js")], check=True)
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
ver = manifest["version"]

SKIP_DIRS = {"dist", "tests", "reports", "tools", "docs", ".git"}
def ext_files(with_dicts):
    for p in sorted(ROOT.rglob("*")):
        rel = p.relative_to(ROOT)
        if p.is_dir() or rel.parts[0] in SKIP_DIRS or rel.name in {"README.md", "CLAUDE.md", ".gitignore", "icon512.png", "hook.js"}:
            continue
        if not with_dicts and rel.parts[0] == "data" and rel.name.startswith("le_ko_"):
            continue
        yield p, rel

shutil.rmtree(DIST, ignore_errors=True)
(DIST / "store").mkdir(parents=True)
store_zip = DIST / "store" / f"le-kr-{ver}.zip"
with zipfile.ZipFile(store_zip, "w", zipfile.ZIP_DEFLATED) as z:
    for p, rel in ext_files(False):
        z.write(p, rel.as_posix())

dev = DIST / "dev" / "le-kr-maxroll"
for p, rel in ext_files(True):
    (dev / rel).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, dev / rel)

dict_dir = DIST / "dict"
dict_dir.mkdir(parents=True)
files = {}
for name in ["le_ko_letrans.json", "le_ko_official.json", "rules.json"]:
    data = (ROOT / "data" / name).read_bytes()
    (dict_dir / name).write_bytes(data)
    files[name] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
shutil.copy2(ROOT / "tools" / "dict_readme.md", dict_dir / "README.md")
kst = datetime.now(timezone(timedelta(hours=9)))
index = {"version": kst.strftime("%Y.%m.%d-%H%M"), "extension": ver, "files": files}
(dict_dir / "version.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"store": str(store_zip), "store_kb": store_zip.stat().st_size // 1024, "dict_version": index["version"]}, ensure_ascii=False))
