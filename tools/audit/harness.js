// 확장을 설치하지 않고 실제 맥스롤 페이지에서 검사하는 도구.
// 크롬 155부터 --load-extension이 막혀 고친 빌드를 자동으로 설치할 수 없어서,
// 임시 프로필 크롬을 디버깅 포트로 띄우고 dist/dev의 확장 소스를 그대로 주입함 (chrome.* 만 흉내).
//   1) python3 tools/release.py   → dist/dev/le-kr-maxroll, data/le_ko_*.json 준비
//   2) node tools/audit/crawl.js  → 창 여러 개로 가이드 전체 검사
// 사전은 data/le_ko_*.json, 규칙은 dist/dev의 rules.json을 씀 (원격 사전이 아니라 로컬 것으로 검사).
// 주의: 이 방식에서는 콘솔에 React 하이드레이션 오류(#418 등)가 뜨는데 주입 시점 때문에 생기는 가짜 신호임.
//       실제 설치된 확장에서는 안 뜸 (2026-10-13 확인).
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const EXT = path.join(ROOT, "dist", "dev", "le-kr-maxroll");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const src = (f) => fs.readFileSync(path.join(EXT, "src", f), "utf8");

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const handlers = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id) {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      } else for (const h of handlers) h(m);
    };
    ws.onerror = () => reject(new Error("ws error"));
    ws.onopen = () => resolve({
      send: (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }),
      on: (h) => handlers.push(h),
      close: () => ws.close()
    });
  });
}

// ISOLATED world에 넣을 chrome.* 흉내. 사전은 가짜 주소(__lekr/)로 받아 오고 CDP가 파일로 응답.
// 미번역 모음(misses)은 <html data-test-misses>로도 내보내 페이지 쪽에서 읽을 수 있게 함.
const SHIM = `
(() => {
  const mem = { __proto__: null };
  const need = async (k) => {
    if (k in mem || !/^dict_/.test(k)) return;
    try { const r = await fetch(location.origin + "/__lekr/" + k); if (r.ok) mem[k] = await r.text(); } catch (_) {}
  };
  const get = async (q) => {
    const keys = q == null ? Object.keys(mem) : typeof q === "string" ? [q] : Array.isArray(q) ? q : Object.keys(q);
    for (const k of keys) await need(k);
    const out = {};
    for (const k of keys) { if (k in mem) out[k] = mem[k]; else if (q && typeof q === "object" && !Array.isArray(q)) out[k] = q[k]; }
    return out;
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: (q, cb) => { const p = get(q); if (typeof cb === "function") { p.then(cb); return; } return p; },
        set: async (o) => { Object.assign(mem, o); if (o.misses) document.documentElement.setAttribute("data-test-misses", JSON.stringify(o.misses)); }
      },
      onChanged: { addListener: () => {} }
    },
    runtime: { sendMessage: async () => ({}), getURL: (p) => location.origin + "/__lekr/pkg/" + p }
  };
})();
`;

// opts: port, profile(임시 프로필 폴더), headless, rulesFile(다른 규칙으로 비교할 때), extraArgs
async function launch({ port, profile, headless, rulesFile, extraArgs }) {
  const args = ["--user-data-dir=" + profile, "--remote-debugging-port=" + port, "--no-first-run", "--no-default-browser-check", "--window-size=1500,1000", "--lang=ko-KR"];
  if (headless) args.push("--headless=new");
  if (extraArgs) args.push(...extraArgs);
  args.push("about:blank");
  spawn(CHROME, args, { stdio: "ignore", detached: true }).unref();
  const base = "http://127.0.0.1:" + port;
  let ver;
  for (let i = 0; i < 20; i++) { await sleep(1000); try { ver = await fetch(base + "/json/version").then((r) => r.json()); break; } catch (_) {} }
  if (!ver) throw new Error("browser did not start");
  const root = await connect(ver.webSocketDebuggerUrl);

  const files = {
    dict_letrans: fs.readFileSync(path.join(ROOT, "data", "le_ko_letrans.json")),
    dict_official: fs.readFileSync(path.join(ROOT, "data", "le_ko_official.json")),
    dict_rules: fs.readFileSync(rulesFile || path.join(EXT, "data", "rules.json"))
  };
  // document_idle 흉내: DOMContentLoaded 뒤 load 또는 200ms 중 빠른 쪽
  const isolated = SHIM + "\n" + src("store.js") + "\n" + src("bridge.js") + "\n" +
    "(() => { const idle = () => {\n" + src("core.js") + "\n" + src("dom.js") + "\n" + src("toggle.js") + "\n};\n" +
    "let ran = false; const once = () => { if (!ran) { ran = true; idle(); } }; const arm = () => { if (document.readyState === 'complete') return once(); window.addEventListener('load', once); setTimeout(once, 200); }; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm); else arm(); })();";
  // document_start 흉내: <html>이 생긴 직후, 맨 위 프레임의 maxroll.gg에서만
  const atStart = (body) => "(() => { if (window !== window.top || location.hostname !== 'maxroll.gg') return; const run = () => {\n" + body + "\n}; if (document.documentElement) run(); else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); run(); } }).observe(document, { childList: true }); })();";

  // opts: noExtension(확장 없이 원본 페이지), wait(로딩 대기 ms)
  async function open(url, opts) {
    opts = opts || {};
    const t = await fetch(base + "/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
    const c = await connect(t.webSocketDebuggerUrl);
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    if (!opts.noExtension) {
      await c.send("Fetch.enable", { patterns: [{ urlPattern: "*://maxroll.gg/__lekr/*" }] });
      c.on((m) => {
        if (m.method !== "Fetch.requestPaused") return;
        const body = files[m.params.request.url.split("/__lekr/")[1]];
        c.send("Fetch.fulfillRequest", body
          ? { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body: body.toString("base64") }
          : { requestId: m.params.requestId, responseCode: 404, body: "" }).catch(() => {});
      });
      await c.send("Page.addScriptToEvaluateOnNewDocument", { source: atStart(isolated), worldName: "lekr_isolated" });
      await c.send("Page.addScriptToEvaluateOnNewDocument", { source: atStart(src("main.js")) });
    }
    const ev = async (expression) => {
      const res = await c.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) throw new Error("page: " + ((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || res.exceptionDetails.text));
      return res.result.value;
    };
    await c.send("Page.navigate", { url });
    await sleep(opts.wait || 10000);
    return { ev, close: async () => { c.close(); await fetch(base + "/json/close/" + t.id).catch(() => {}); } };
  }
  return { version: ver.Browser, open, close: async () => { try { await root.send("Browser.close"); } catch (_) {} } };
}

const AUDIT = fs.readFileSync(path.join(__dirname, "audit.js"), "utf8");

// 페이지에서 audit.js를 돌리고 보고서를 받음. 오래 걸리는 await는 연결이 끊기므로 시작만 시키고 진행을 물어봄.
async function audit(page, opts) {
  await page.ev(AUDIT + "; 1");
  await page.ev(`window.__fin = 0; window.__prog = -1; __runAudit(${JSON.stringify(opts || {})}).then(() => (window.__fin = 1), (e) => (window.__fin = String(e))); 1`);
  let last = -2, same = 0;
  for (;;) {
    await sleep(3000);
    const [fin, prog] = JSON.parse(await page.ev("JSON.stringify([window.__fin, window.__prog])"));
    if (fin === 1) break;
    if (fin) throw new Error("audit: " + fin);
    same = prog === last ? same + 1 : 0;
    last = prog;
    if (same >= 10) throw new Error("stuck at target " + last);
  }
  return JSON.parse(await page.ev("__auditReport(1)"));
}

module.exports = { launch, audit, sleep, ROOT, EXT };
