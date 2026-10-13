// 창 여러 개로 가이드 전체(와 추가로 준 페이지)의 툴팁을 동시에 검사. harness.js 머리말 참고.
//   node tools/audit/crawl.js [창 수=5] [추가 페이지 경로 ...]
//   예: node tools/audit/crawl.js 5 resources/boss-loot-table-cheat-sheet planner/kj6jox0q
// 결과: reports/crawl.json (페이지별 검사 수·문제 줄). 같은 툴팁은 한 번만 봄.
// 진행 상황은 표준 출력에 페이지가 끝날 때마다 한 줄씩 나옴.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { launch, audit, ROOT } = require("./harness.js");

const WORKERS = Number(process.argv[2]) || 5;
const EXTRA = process.argv.slice(3);
const BASE = "https://maxroll.gg/last-epoch/";
const KEYSEL = ".le-item,.le-skill,.le-passive,.le-affix,.le-idol,.le-blessing";
const OUT = path.join(ROOT, "reports", "crawl.json");
const seen = new Set();
const results = [];

async function auditPage(p, slug) {
  // 다른 창에서 이미 본 툴팁은 건너뜀
  const fresh = JSON.parse(await p.ev(`(()=>{const seen=new Set(${JSON.stringify([...seen])}); const fresh=[]; for(const e of document.querySelectorAll(${JSON.stringify(KEYSEL)})){const k=e.className.split(" ")[0]+":"+(e.getAttribute("data-le-id")||"")+(e.getAttribute("data-le-unique")||"")+(e.getAttribute("data-le-text")||e.textContent).trim(); if(seen.has(k)) e.setAttribute("data-lekr-skip","1"); else {seen.add(k); fresh.push(k);}} return JSON.stringify(fresh)})()`));
  for (const k of fresh) seen.add(k);
  const sel = KEYSEL.split(",").map((s) => s + ":not([data-lekr-skip])").join(",");
  const rep = await audit(p, { sel, max: 500, settle: 1500, hidden: 1 });
  return { slug, total: rep.total, noTip: rep.noTip.length, bad: rep.bad };
}

(async () => {
  const t0 = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lekr-crawl-"));
  const bs = [];
  for (let i = 0; i < WORKERS; i++) {
    bs.push(await launch({ port: 9351 + i, profile: path.join(tmp, "w" + i), headless: false,
      extraArgs: ["--window-position=" + (i % 3) * 640 + "," + Math.floor(i / 3) * 520, "--window-size=640,520",
        "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion"] }));
  }
  const lp = await bs[0].open(BASE + "build-guides", { noExtension: true, wait: 7000 });
  const guides = JSON.parse(await lp.ev(`JSON.stringify([...new Set([...document.querySelectorAll('a[href*="/last-epoch/build-guides/"]')].map(a=>a.pathname.replace('/last-epoch/','')))].filter(p=>!/\\/(acolyte|mage|primalist|rogue|sentinel)$/.test(p)).sort())`));
  await lp.close();
  const queue = [...EXTRA, ...guides.filter((g) => !EXTRA.includes(g))];
  const all = queue.length;
  console.log("pages:", all);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const save = () => fs.writeFileSync(OUT, JSON.stringify({ elapsedSec: Math.round((Date.now() - t0) / 1000), pagesDone: results.length, pagesTotal: all, results }, null, 1));
  await Promise.all(bs.map(async (b, wi) => {
    for (;;) {
      const slug = queue.shift();
      if (!slug) return;
      let p;
      try {
        p = await b.open(BASE + slug, { wait: 10000 });
        const r = await auditPage(p, slug);
        results.push(r);
        console.log(`[${results.length}/${all}] w${wi} ${slug} total ${r.total} bad ${r.bad.length}`);
      } catch (e) {
        results.push({ slug, error: e.message.slice(0, 200) });
        console.log(`[${results.length}/${all}] w${wi} ${slug} ERROR ${e.message.slice(0, 120)}`);
      }
      try { await p.close(); } catch (_) {}
      save();
    }
  }));
  for (const b of bs) await b.close();
  const issues = new Map();
  for (const r of results) for (const [, src, list] of r.bad || []) for (const s of list) if (!issues.has(s)) issues.set(s, r.slug + " | " + src);
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s, tooltips ${results.reduce((n, r) => n + (r.total || 0), 0)}, errors ${results.filter((r) => r.error).length}, unique issue lines ${issues.size}`);
  for (const [s, w] of issues) console.log("  ", s, " <=", w);
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} process.exit(0); }, 3000);
})();
