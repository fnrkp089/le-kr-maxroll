// 실제 맥스롤 페이지에서 툴팁을 자동으로 띄워 번역 오류를 찾는 검사 도구.
// 확장을 설치한 크롬의 개발자 도구 콘솔(또는 Claude in Chrome의 javascript_tool)에 붙여넣고:
//   await __runAudit({ max: 60, settle: 1500, hidden: 1 }); __auditReport(1)
// 옵션: sel(대상 선택자), max, skip(앞에서 건너뛸 개수, 여러 탭으로 나눌 때), nodedup(같은 이름도 전부),
//       settle(툴팁이 뜬 뒤 번역 기다리는 ms), hidden(Alt 설명처럼 숨은 줄도 검사)
// 플래너: sel '.lep-PaperdollEquipment .lep-slot img.lep-image, .lep-slot-altar img.lep-image, .lep-item, .lep-blessing:not(.lep-empty) img, [class*="node_Node__PkFGB"]', nodedup 1
//   (.lep-item은 신상 칸만 잡음. 장비는 .lep-slot 안의 img. 패시브는 숙련 버튼 [class*="masteries_Masteries__button"]을 눌러야 그 트리가 그려짐)
// 데이터베이스 표: sel '.lep-codex-tooltip-wrapper', nodedup 1
// 확장을 설치하지 않고 돌리려면 tools/audit/harness.js (임시 크롬에 소스 주입)
// 스킬 트리는 __pickSkill(i)로 스킬을 고른 뒤 sel '[class*="viewer_tree-skill"] [class*="node_Node__PkFGB"]'
// 주의: 백그라운드 탭에서도 돌도록 setTimeout 대신 MessageChannel로 기다림.
window.__runAudit = async function (opts) {
  opts = opts || {};
  const tick = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  const sleep = async (ms) => { const end = performance.now() + ms; while (performance.now() < end) await tick(); };
  const OK = /^(LP\d?|Alt|alt|Ctrl|ZHP|T\d|ALT|DPS|HP)$/; // 영어로 남아도 되는 약어
  const UNIT = "밀리초|조|초|개|회|번|중첩|미터|마리|포인트|등급|레벨|명|단계|칸|스택|분|시간|일|을|를|이|가|은|는|의|에|로|으로|만|천|배|장|인|등|차|당|억|입|위|와|과|까지|씩|부터|년|째|보다|마다|단층|%";
  const glue = new RegExp("\\d(?!(?:" + UNIT + "))[가-힣]"); // "150하수인" 같은 붙음
  const rendered = (el) => {
    if (el.nodeType === 3) return el.nodeValue;
    if (el.nodeType !== 1) return "";
    if (getComputedStyle(el).display === "none" && !opts.hidden) return "";
    if (el.tagName === "BR") return "\n";
    let s = el.dataset.lekrPre || ""; // ::before로 그린 번역문
    for (const c of el.childNodes) s += rendered(c);
    s += el.dataset.lekrPost || "";
    if (/^(DIV|P|LI|TR)$/.test(el.tagName)) s += "\n";
    else if (/^(TD|TH)$/.test(el.tagName)) s += " ";
    return s;
  };
  const sel = opts.sel || ".le-item,.le-skill,.le-passive,.le-affix,.le-idol,.le-blessing";
  const seen = new Set();
  const targets = [];
  for (const e of document.querySelectorAll(sel)) {
    const k = e.className.split(" ")[0] + ":" + (e.getAttribute("data-le-id") || "") + (e.getAttribute("data-le-unique") || "") + (e.getAttribute("data-le-text") || e.textContent).trim();
    if (!opts.nodedup && seen.has(k)) continue;
    if (opts.nodedup && !e.getClientRects().length) continue;
    seen.add(k);
    targets.push(e);
    if (targets.length >= (opts.skip || 0) + (opts.max || 60)) break;
  }
  targets.splice(0, opts.skip || 0);
  const fire = (el, types, x, y) => {
    const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window, pointerType: "mouse" };
    for (const t of types) el.dispatchEvent(new (t.startsWith("pointer") ? PointerEvent : MouseEvent)(t, o));
  };
  const res = [];
  window.__auditTexts = [];
  window.__auditHTML = [];
  for (let i = 0; i < targets.length; i++) {
    window.__prog = i;
    const e = targets[i];
    e.scrollIntoView({ block: "center" });
    await sleep(120);
    const r = e.getBoundingClientRect();
    const x = r.left + Math.min(6, r.width / 2), y = r.top + r.height / 2;
    let tgt = document.elementFromPoint(x, y);
    if (!tgt || !e.contains(tgt)) tgt = e.querySelector("span") || e;
    // 맥스롤 툴팁은 합성 마우스 이벤트로도 열림 (안쪽 요소에 보내야 함)
    fire(tgt, ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"], x, y);
    let tips = [];
    for (let w = 0; w < 12; w++) {
      await sleep(150);
      tips = [...document.querySelectorAll('[class*="_Tooltip__wrapper"]')].filter((t) => t.getClientRects().length);
      if (tips.length) {
        await sleep(opts.settle || 3000);
        tips = [...document.querySelectorAll('[class*="_Tooltip__wrapper"]')].filter((t) => t.getClientRects().length);
        break;
      }
    }
    const rec = { i, kind: e.className.split(" ")[0], src: (e.getAttribute("data-le-text") || e.textContent).trim().slice(0, 40), tips: tips.length, issues: [] };
    for (const tip of tips) {
      const txt = rendered(tip);
      window.__auditTexts.push([rec.src, txt]);
      for (const line of txt.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        const en = t.match(/[A-Za-z]{3,}/g);
        if (en && !en.every((w) => OK.test(w))) rec.issues.push("EN:" + t.slice(0, 70));
        if (/[{}]/.test(t)) rec.issues.push("BRACE:" + t.slice(0, 70));
        if (glue.test(t)) rec.issues.push("GLUE:" + t.slice(0, 70));
        if (/[\d%] 포인트당$/.test(t)) rec.issues.push("ORDER:" + t.slice(0, 70));
        if (/undefined|NaN|null|\[object/.test(t)) rec.issues.push("BAD:" + t.slice(0, 70));
        if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length) rec.issues.push("PAREN:" + t.slice(0, 70));
        if (/  /.test(t.replace(/\s{2,}$/, ""))) rec.issues.push("SPACE2:" + t.slice(0, 70));
      }
    }
    rec.issues = [...new Set(rec.issues)];
    if (rec.issues.length) window.__auditHTML.push([rec.src, tips.map((t) => t.outerHTML).join("")]);
    res.push(rec);
    fire(tgt, ["pointerout", "pointerleave", "mouseout", "mouseleave"], x, y);
    fire(document.body, ["mouseover", "mousemove"], 2, 2);
    await sleep(150);
  }
  window.__auditRes = res;
  return res.length;
};

window.__auditReport = (full) => {
  const all = window.__auditRes || [];
  const bad = all.filter((r) => r.issues.length);
  return JSON.stringify({
    page: location.pathname.split("/").pop(),
    total: all.length,
    ok: all.filter((r) => r.tips && !r.issues.length).length,
    noTip: all.filter((r) => !r.tips).map((r) => r.kind + ":" + r.src),
    bad: bad.map((r) => [r.kind, r.src, r.issues.slice(0, full ? 20 : 5)])
  });
};

// 플래너 스킬 목록에서 i번째 스킬을 골라 스킬 트리를 바꿈
window.__pickSkill = async (i) => {
  const sl = [...document.querySelectorAll('[class*="skills_SkillList__slot"]')].filter((e) => e.getClientRects().length);
  const s = sl[i];
  if (!s) return "none";
  s.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 300));
  const b = s.getBoundingClientRect();
  const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) || s;
  for (const ty of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
    t.dispatchEvent(new (ty.startsWith("pointer") ? PointerEvent : MouseEvent)(ty, { bubbles: true, view: window, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0 }));
  await new Promise((r) => setTimeout(r, 1500));
  return document.querySelectorAll('[class*="viewer_tree-skill"] [class*="node_Node__PkFGB"]').length;
};
