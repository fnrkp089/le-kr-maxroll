// 확장이 페이지를 얼마나 멈추게 하는지 재는 도구 (고치기 전·후 비교). harness.js 머리말 참고.
//   node tools/audit/perf.js <소스폴더,소스폴더,...|none> [회수=2] [페이지 ...]
//   소스폴더는 src/와 data/rules.json이 있는 폴더 (dist/dev/le-kr-maxroll 형태). none = 확장 없이.
//   예: node tools/audit/perf.js none,C:/tmp/base,dist/dev/le-kr-maxroll 3 planner/kj6jox0q
// 재는 것: 로딩 중 긴 작업(50ms 넘는 것) 합·최대·TBT, JS 힙, 가만히 둔 10초의 스크립트 시간, 툴팁 띄우기·플래너 스킬 트리 바꾸기 중의 작업 시간.
// 화면 글자(::before 번역문 포함)와 툴팁 글자를 reports/perf/<라벨>-<페이지>.txt로 남겨 결과가 같은지 비교함.
const path = require("path");
const fs = require("fs");
const os = require("os");

const exts = (process.argv[2] || "none").split(",");
const ROUNDS = Number(process.argv[3]) || 2;
const PAGES = process.argv.slice(4).length ? process.argv.slice(4) : ["planner/kj6jox0q", "build-guides/bladedancer-leveling-guide"];
const BASE = "https://maxroll.gg/last-epoch/";
const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "reports", "perf");

const START = `(() => { window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true }); } catch (_) {} })();`;
const RENDER = `window.__rendered = function r(el) {
  if (el.nodeType === 3) return el.nodeValue;
  if (el.nodeType !== 1 || /^(SCRIPT|STYLE|NOSCRIPT|IFRAME)$/.test(el.tagName)) return "";
  if (el.tagName === "BR") return "\\n";
  let s = el.dataset.lekrPre || "";
  for (const c of el.childNodes) s += r(c);
  s += el.dataset.lekrPost || "";
  if (/^(DIV|P|LI|TR|H\\d)$/.test(el.tagName)) s += "\\n";
  return s;
};
window.__ltSum = (from) => { const l = window.__lt.filter(([s]) => s >= from); return { n: l.length, sum: Math.round(l.reduce((a, [, d]) => a + d, 0)), max: Math.round(Math.max(0, ...l.map(([, d]) => d))), tbt: Math.round(l.reduce((a, [, d]) => a + Math.max(0, d - 50), 0)) }; };
1`;

const metric = async (p) => {
  const { metrics } = await p.cdp.send("Performance.getMetrics");
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { task: m.TaskDuration * 1000, script: m.ScriptDuration * 1000, heap: m.JSHeapUsedSize / 1048576 };
};

// 함수별 자기·누적 시간 상위. PERF_PROFILE=load(로딩) 또는 hover(툴팁 띄우기)
function printProfile(prof, label) {
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const key = (n) => (n.callFrame.functionName || "(anon)") + " " + (n.callFrame.url.split("/").pop() || "") + ":" + (n.callFrame.lineNumber + 1);
  const self = new Map();
  const total = new Map();
  for (let i = 0; i < prof.samples.length; i++) {
    const dt = (prof.timeDeltas[i] || 0) / 1000;
    let n = byId.get(prof.samples[i]);
    self.set(key(n), (self.get(key(n)) || 0) + dt);
    const seen = new Set();
    for (let id = n.id; id != null; id = parent.get(id)) {
      const k = key(byId.get(id));
      if (!seen.has(k)) { seen.add(k); total.set(k, (total.get(k) || 0) + dt); }
    }
  }
  const skip = (k) => /^\((idle|program|garbage collector|root)\)/.test(k);
  const fmt = (m) => [...m].filter(([k]) => !skip(k)).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => "  " + Math.round(v) + "ms " + k).join("\n");
  console.log("profile " + path.basename(label) + " self\n" + fmt(self) + "\ntotal\n" + fmt(total));
}

async function measure(b, label, slug) {
  const planner = slug.startsWith("planner/");
  const p = await b.open(BASE + slug, { noExtension: label === "none", wait: planner ? 14000 : 10000, startScript: START,
    beforeNavigate: process.env.PERF_PROFILE === "load" ? async (c) => { await c.send("Profiler.enable"); await c.send("Profiler.setSamplingInterval", { interval: 200 }); await c.send("Profiler.start"); } : null });
  if (process.env.PERF_PROFILE === "load") printProfile((await p.cdp.send("Profiler.stop")).profile, label + " load");
  try {
    await p.cdp.send("Performance.enable");
    await p.ev(RENDER);
    const load = JSON.parse(await p.ev("JSON.stringify(__ltSum(0))"));
    const m0 = await metric(p);
    // 가만히 둔 10초 동안의 스크립트 시간 (끝없는 처리 반복 같은 상시 부하)
    await new Promise((res) => setTimeout(res, 10000));
    const mi = await metric(p);
    const r = { label, slug, load, heapMB: Math.round(m0.heap), idleScriptMs: Math.round(mi.script - m0.script) };
    const texts = ["### body", await p.ev("__rendered(document.body)")];

    // 툴팁 띄우기 (audit.js 그대로, 기다림은 짧게)
    const { audit } = require("./harness.js");
    const sel = planner
      ? '.lep-PaperdollEquipment .lep-slot img.lep-image, .lep-slot-altar img.lep-image, .lep-item, .lep-blessing:not(.lep-empty) img, [class*="node_Node__PkFGB"]'
      : ".le-item,.le-skill,.le-passive,.le-affix,.le-idol,.le-blessing";
    const t0 = await p.ev("performance.now()");
    const m1 = await metric(p);
    if (process.env.PERF_PROFILE === "hover") { await p.cdp.send("Profiler.enable"); await p.cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await p.cdp.send("Profiler.start"); }
    const rep = await audit(p, { sel, max: 30, settle: 500, hidden: 1, nodedup: planner ? 1 : 0 });
    const m2 = await metric(p);
    if (process.env.PERF_PROFILE === "hover") printProfile((await p.cdp.send("Profiler.stop")).profile, label);
    r.hover = { tips: rep.total, taskMs: Math.round(m2.task - m1.task), scriptMs: Math.round(m2.script - m1.script), ...JSON.parse(await p.ev(`JSON.stringify(__ltSum(${t0}))`)) };
    texts.push("### tips", JSON.parse(await p.ev("JSON.stringify(window.__auditTexts)")).map(([s, t]) => s + "\n" + t).join("\n---\n"));

    // 플래너: 스킬 트리를 차례로 바꿔 큰 화면 갱신을 일으킴
    if (planner) {
      const t1 = await p.ev("performance.now()");
      const m3 = await metric(p);
      for (let i = 0; i < 5; i++) await p.ev(`__pickSkill(${i})`);
      const m4 = await metric(p);
      r.skills = { taskMs: Math.round(m4.task - m3.task), scriptMs: Math.round(m4.script - m3.script), ...JSON.parse(await p.ev(`JSON.stringify(__ltSum(${t1}))`)) };
      texts.push("### skill tree", await p.ev(`__rendered(document.querySelector('[class*="viewer_tree-skill"]') || document.body)`));
    }
    fs.writeFileSync(path.join(OUT, `${path.basename(label)}-${slug.replace(/\W+/g, "_")}.txt`), texts.join("\n"));
    return r;
  } finally {
    await p.close();
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lekr-perf-"));
  const rows = [];
  // 같은 크롬을 쓰면 캐시·JIT가 뒤 순서에 유리하므로 소스마다 크롬을 따로 띄우고, 회차마다 순서를 돌림
  for (let round = 0; round < ROUNDS; round++) {
    const order = exts.map((_, i) => exts[(i + round) % exts.length]);
    for (const label of order) {
      if (label !== "none") process.env.LEKR_EXT = path.resolve(label);
      delete require.cache[require.resolve("./harness.js")];
      const { launch } = require("./harness.js");
      const b = await launch({ port: 9451, profile: path.join(tmp, "r" + round + path.basename(label)), headless: false,
        extraArgs: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion"] });
      for (const slug of PAGES) {
        try {
          const r = await measure(b, label, slug);
          rows.push(r);
          console.log(JSON.stringify({ round, ...r, label: path.basename(label) }));
        } catch (e) {
          console.log(JSON.stringify({ round, label: path.basename(label), slug, error: e.message.slice(0, 200) }));
        }
      }
      await b.close();
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  // 소스·페이지별 중앙값
  const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  console.log("\nmedian  label | page | load TBT/max/sum | heapMB | idle script | hover task/TBT | skills task/TBT");
  for (const label of exts) for (const slug of PAGES) {
    const rs = rows.filter((r) => r.label === label && r.slug === slug);
    if (!rs.length) continue;
    const g = (f) => med(rs.map(f));
    console.log(`  ${path.basename(label)} | ${slug} | ${g((r) => r.load.tbt)}/${g((r) => r.load.max)}/${g((r) => r.load.sum)} | ${g((r) => r.heapMB)} | ${g((r) => r.idleScriptMs)} | ${g((r) => r.hover && r.hover.taskMs)}/${g((r) => r.hover && r.hover.tbt)} | ${g((r) => r.skills && r.skills.taskMs)}/${g((r) => r.skills && r.skills.tbt)}`);
  }
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} process.exit(0); }, 2000);
})();
