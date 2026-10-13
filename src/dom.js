// ISOLATED world, document_idle.
// 데이터 계층에서 못 바꾼 부분(맥스롤 코드가 직접 조립하는 영어 연결어, 수치 어순)을 화면에서 정리.
// React가 관리하는 DOM이라 노드를 옮기거나 새로 만들지 않고,
// 기존 텍스트 노드 값만 바꾸고 앞뒤 문구는 ::before/::after 속성으로 그림.
(async function () {
  const { createEngine, HANGUL } = globalThis.LEKR;
  const defaults = { enabled: true, showOriginal: true, source: "letrans", itemTitles: false };
  let cfg = await chrome.storage.local.get(defaults);
  if (!cfg.enabled) return;

  const { dictText, rulesText } = await globalThis.LEKR_STORE.load(cfg.source);
  if (!dictText || !rulesText) {
    console.warn("[LE 한글] 번역 사전을 아직 받지 못했어요. 인터넷 연결을 확인하고 새로고침하세요.");
    return;
  }
  const dict = JSON.parse(dictText);
  const rules = JSON.parse(rulesText);
  const engine = createEngine(dict, rules, { itemTitles: cfg.itemTitles });

  const LINE = ".lep-property";
  const SCALING = ".lep-scaling-stat";
  const PROSE = ".lep-RichTextEditor, [data-lexical-text]";
  const VALUE = ".lep-value";
  const TEXT_SCOPE = [
    "[class^='lep-']", "[class*=' lep-']",
    ".le-skill", ".le-item", ".le-passive", ".le-affix", ".le-embed"
  ].join(",");

  // 텍스트 노드마다 원문과 우리가 쓴 값을 기억. React가 값을 다시 쓰면 그게 새 원문.
  const original = new WeakMap();
  const written = new WeakMap();
  const touched = new Set();
  let applying = false;

  // 화면에 직접 쓰는 번역문에선 {용어} 표시를 뗌 (맥스롤의 강조 처리를 거치지 않으므로). {0} 같은 숫자 자리는 둠
  const unbrace = (s) => (s == null ? s : String(s).replace(/\{([^{}]*[^\d{}\s][^{}]*)\}/g, "$1"));
  // 맥스롤이 영어 문장에 끼워 넣은 데이터 계층 한글 조각을 영어로 되돌림 ("Chance to 감속 on Spell Hit" → "Chance to Slow on Spell Hit")
  // 같은 한글이 여러 영어에서 왔을 수 있어서(방어도 분쇄 ← Armor Shred / Shred Armor) 후보 조합을 여러 개 만들고
  // 번역에 성공하는 첫 조합을 씀
  let revKeys = null;
  let revMap = null;
  function deKoAll(s) {
    if (!s || !HANGUL.test(s) || !/[A-Za-z]{2,}/.test(s)) return [s];
    const map = globalThis.__lekrReverse;
    if (!map || !map.size) return [s];
    if (revMap !== map) {
      revMap = map;
      revKeys = [...map.keys()].filter((k) => HANGUL.test(k)).sort((a, b) => b.length - a.length);
    }
    let marked = s;
    const slots = [];
    for (const k of revKeys) {
      if (!HANGUL.test(marked)) break;
      if (!marked.includes(k)) continue;
      const c = [...new Set([].concat(map.get(k), engine.koCandidates(k)))].slice(0, 8);
      marked = marked.split(k).join(String.fromCharCode(0xe0a0 + slots.length));
      slots.push(c);
      if (slots.length > 6) break;
    }
    if (!slots.length) return [s];
    let outs = [marked];
    slots.forEach((cands, i) => {
      const ch = String.fromCharCode(0xe0a0 + i);
      const next = [];
      for (const o of outs) for (const c of cands) if (next.length < 32) next.push(o.split(ch).join(c));
      outs = next;
    });
    return outs;
  }
  const deKo = (s) => deKoAll(s)[0];
  // 후보마다 fn을 돌려 처음 성공한 결과
  function firstOk(s, fn) {
    for (const v of deKoAll(s)) {
      const r = fn(v);
      if (r) return r;
    }
    return null;
  }
  const sourceOf = (n) => (written.has(n) && written.get(n) === n.nodeValue ? original.get(n) : n.nodeValue);
  function setText(node, value) {
    value = unbrace(value);
    if (!(written.has(node) && written.get(node) === node.nodeValue)) original.set(node, node.nodeValue);
    if (node.nodeValue !== value) node.nodeValue = value;
    written.set(node, value);
  }

  // 수치 칸 안의 영어: 칸 전체 글자로 먼저 ("1"," in ","7" → "1/7", "+30"," per point" → "포인트당 +30"), 안 되면 노드별로
  function translateValueEl(value) {
    const vnodes = [];
    const vw = document.createTreeWalker(value, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = vw.nextNode())) vnodes.push(n);
    const vfull = vnodes.map(sourceOf).join("");
    if (!/[A-Za-z]/.test(vfull)) return;
    const vko = vnodes.length > 1 && engine.translateValue(vfull);
    if (vko) {
      vnodes.forEach((t, i) => setText(t, i ? "" : vko));
      value.dataset.lekrVal = "1";
    } else {
      for (const t of vnodes) {
        const v = engine.translateValue(sourceOf(t));
        if (v) {
          setText(t, v);
          value.dataset.lekrVal = "1";
        }
      }
    }
    touched.add(value);
  }

  // 수치 하나가 들어간 툴팁 줄: [앞 문구][.lep-value][뒤 문구]
  // 앞뒤 문구가 텍스트 노드든 작은 span이든 상관없이 글자만 모아서 번역함.
  function translateLine(el) {
    const values = el.querySelectorAll(VALUE);
    if (values.length > 1) return translateMulti(el, values);
    if (values.length !== 1) return false;
    const value = values[0];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const before = [];
    const after = [];
    let n;
    while ((n = walker.nextNode())) {
      if (value.contains(n)) continue;
      (value.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING ? before : after).push(n);
    }
    translateValueEl(value);
    const SEP = "\u0001";
    const joined = before.map(sourceOf).join("") + SEP + after.map(sourceOf).join("");
    const [pre, post] = deKo(joined).split(SEP);
    if (!/[A-Za-z]/.test(pre + post)) return el.dataset.lekrPre !== undefined;

    const r = firstOk(joined, (v) => {
      const [a, b] = v.split(SEP);
      return engine.translateLine(a, b, true);
    }) || engine.translateLine(pre, post);
    if (!r) {
      delete el.dataset.lekrPre;
      delete el.dataset.lekrPost;
      return translateMulti(el, values);
    }
    for (const t of before.concat(after)) setText(t, "");
    el.dataset.lekrPre = unbrace(r.pre);
    el.dataset.lekrPost = unbrace(r.post);
    if (cfg.showOriginal) el.title = (pre + value.textContent + post).replace(/\s+/g, " ").trim();
    touched.add(el);
    return true;
  }

  // 수치 칸이 여러 개인 줄(고유 효과 문장 등): 게임 문장 템플릿으로 통째 번역. 수치 색은 사라짐
  function translateMulti(el, values) {
    if (!INLINE_ONLY(el)) return false;
    const vals = [...values];
    const parts = [];
    const nodes = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    let lastVal = null;
    while ((n = w.nextNode())) {
      nodes.push(n);
      const v = vals.find((x) => x.contains(n));
      if (v) {
        if (v !== lastVal) parts.push({ value: "" });
        parts[parts.length - 1].value += sourceOf(n);
        lastVal = v;
      } else {
        parts.push({ text: sourceOf(n) });
        lastVal = null;
      }
    }
    const full = parts.map((p) => (p.value != null ? p.value : p.text)).join("").replace(/\s+/g, " ").trim();
    if (!/[A-Za-z]{2,}/.test(full)) return false;
    // 글자 조각을 하나로 이어 한글 조각 되돌리기 후보를 만들고, 다시 조각별로 나눠 템플릿 조회
    const SEP = "\u0001";
    const textJoined = parts.filter((p) => p.value == null).map((p) => p.text).join(SEP);
    const ko = firstOk(textJoined, (v) => {
      const texts = v.split(SEP);
      let i = 0;
      return engine.lookupValues(parts.map((p) => (p.value != null ? p : { text: texts[i++] })));
    });
    if (!ko) {
      engine.misses.add(full);
      return false;
    }
    for (const t of nodes) setText(t, "");
    el.dataset.lekrPre = unbrace(ko);
    el.dataset.lekrBlock = "1";
    if (cfg.showOriginal) el.title = full;
    touched.add(el);
    return true;
  }

  // 문장 중간에 끼어 있는 짧은 연결어는 따로 번역하면 문장이 깨지므로 건드리지 않음
  const STOP = new Set(["a", "an", "and", "or", "the", "of", "in", "on", "for", "with", "by", "at", "from", "as", "is", "if", "per"]);

  // 색 입힌 조각(시간선 링크, 고유/세트 등급)이 낀 문장: 조각은 그대로 두고 사이 글자만 바꿈.
  // 조각을 자리표시자로 바꿔 문장째 번역한 뒤, 번역문의 조각 순서가 원문과 같을 때만 적용.
  const KEEP = "a, [class*='lep-rarity'], .lep-per-point";
  function translateLinked(el) {
    const all = [...el.querySelectorAll(KEEP)];
    const keeps = all.filter((k) => !all.some((o) => o !== k && o.contains(k)));
    if (!keeps.length || keeps.length > 9 || !INLINE_ONLY(el)) return false;
    const segs = [[]]; // 조각 사이 텍스트 노드 묶음
    const keepNodes = keeps.map(() => []);
    let src = "";
    let last = -1;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const ki = keeps.findIndex((k) => k.contains(n));
      if (ki >= 0) {
        keepNodes[ki].push(n);
        if (ki !== last) {
          src += String.fromCharCode(0xe001 + ki);
          segs.push([]);
          last = ki;
        }
        continue;
      }
      segs[segs.length - 1].push(n);
      src += sourceOf(n);
    }
    if (segs.length !== keeps.length + 1) return false;
    const full = deKo(src).replace(/\s+/g, " ").trim();
    if (!/[A-Za-z]{2,}/.test(full.replace(/[\uE001-\uE0FF]/g, ""))) return false;
    const ko = firstOk(src, (v) => engine.lookupText(v.replace(/\s+/g, " ").trim()));
    if (!ko) return false;
    const pieces = ko.split(/[\uE001-\uE0FF]/);
    const order = ko.match(/[\uE001-\uE0FF]/g) || [];
    if (order.length !== keeps.length || order.some((c, i) => c.charCodeAt(0) !== 0xe001 + i)) return false;
    // 사이 글자
    pieces.forEach((piece, i) => {
      const nodes = segs[i];
      if (nodes.length) {
        nodes.forEach((t, j) => setText(t, j ? "" : piece));
      } else if (piece.trim()) {
        const host = i ? keeps[i - 1] : keeps[0];
        host.dataset[i ? "lekrPost" : "lekrPre"] = unbrace(piece);
        touched.add(host);
      }
    });
    // 조각 안 글자 (등급 이름, 시간선 이름)
    keeps.forEach((k, i) => {
      const nodes = keepNodes[i];
      const raw = nodes.map(sourceOf).join("");
      const text = deKo(raw).replace(/\s+/g, " ").trim();
      if (!text || !/[A-Za-z]{2,}/.test(text)) return;
      const kk = firstOk(raw, (v) => engine.lookupText(v.replace(/\s+/g, " ").trim()));
      if (kk) nodes.forEach((t, j) => setText(t, j ? "" : kk));
    });
    el.dataset.lekrLinked = "1";
    if (cfg.showOriginal) el.title = full.replace(/[\uE001-\uE0FF]/g, (c) => keepNodes[c.charCodeAt(0) - 0xe001].map(sourceOf).join("").trim());
    touched.add(el);
    return true;
  }

  // 여러 조각(색 입힌 이름, 수치 등)으로 나뉜 한 문장: 통째로 번역해서 앞 문구로 그림.
  // 조각별 색은 사라지지만 문장이 맞게 나옴. 안에 div가 있는 큰 덩어리는 건드리지 않음.
  const INLINE_ONLY = (el) => !el.querySelector("div, p, li, ul, table, img, svg");
  function translateBlock(el) {
    if (!INLINE_ONLY(el)) return false;
    const nodes = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) nodes.push(n);
    const raw = nodes.map(sourceOf).join("");
    const full = deKo(raw).replace(/\s+/g, " ").trim();
    if (!full || !/[A-Za-z]{2,}/.test(full) || full.length > 600) return false;
    const ko = firstOk(raw, (v) => engine.lookupText(v.replace(/\s+/g, " ").trim()));
    if (!ko) {
      engine.misses.add(full);
      return false;
    }
    for (const t of nodes) setText(t, "");
    el.dataset.lekrPre = unbrace(ko);
    el.dataset.lekrBlock = "1";
    if (cfg.showOriginal) el.title = full;
    touched.add(el);
    return true;
  }

  // 텍스트 노드별 번역 뒤에도 영어가 남은 작은 덩어리는 문장 단위로 다시 시도
  function hasEnglishLeft(el) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (/[A-Za-z]{3,}/.test(n.nodeValue) && written.get(n) !== n.nodeValue) return true;
    return false;
  }

  function textPieces(el) {
    let c = 0;
    for (const n of el.childNodes) if (n.nodeType === 3 && sourceOf(n).trim()) c++;
    return c;
  }

  // 바로 앞이 숫자로 끝나면 한글과 붙지 않게 띄움 (150하수인 피해 → 150 하수인 피해)
  function endsWithNumber(node) {
    let prev = node.previousSibling;
    while (prev && prev.nodeType === 3 && !prev.nodeValue.trim()) prev = prev.previousSibling;
    if (!prev) return false;
    return /[\d%)]\s*$/.test(prev.textContent) && !/\s$/.test(prev.textContent);
  }

  // 수치 없는 문자열: 텍스트 노드 단위로 교체. 줄 단위로 처리된 노드는 건너뜀.
  function translateTexts(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        const line = p && p.closest(LINE);
        if (line && line.dataset.lekrPre !== undefined) return NodeFilter.FILTER_REJECT;
        return p && p.closest("[data-lekr-block], [data-lekr-linked], [data-lekr-val]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      const orig = sourceOf(node);
      const raw = deKo(orig);
      const text = raw && raw.trim();
      if (!text || !/[A-Za-z]/.test(text) || STOP.has(text.toLowerCase())) continue;
      if (HANGUL.test(text) && !/[A-Za-z]{3,}/.test(text)) continue;
      // 플래너 메모 같은 줄글은 단어 하나만 바꾸면 문장이 깨지므로 문장 전체가 사전에 있을 때만
      const pe = node.parentElement;
      const prose = pe && pe.closest(PROSE) && !pe.closest(".le-skill, .le-item, .le-passive, .le-affix, .le-gametip");
      const ko = prose ? engine.lookupExact(text) : firstOk(orig, (v) => engine.lookupText(v.trim()));
      if (!ko) {
        if (text.length <= 80) engine.misses.add(text);
        continue;
      }
      let lead = raw.match(/^\s*/)[0];
      const tail = raw.match(/\s*$/)[0];
      if (!lead && endsWithNumber(node)) lead = " ";
      setText(node, lead + ko + tail);
      if (node.parentElement) touched.add(node.parentElement);
    }
  }

  // 아이템 이름에서 접사 칭호 떼기 (LE Tools처럼 고유 이름만): "활달한 산의 발 - 거인" → "산의 발"
  const NAME = ".lep-name";
  function stripTitles(el) {
    const titles = globalThis.__lekrTitles;
    if (cfg.itemTitles || !titles || !titles.size) return;
    const nodes = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) nodes.push(n);
    const full = nodes.map((t) => t.nodeValue).join("").replace(/\s+/g, " ").trim();
    if (!full) return;
    let rest = full;
    for (let guard = 0; guard < 4; guard++) {
      let cut = false;
      for (const t of titles) {
        if (!t || t.length >= rest.length) continue;
        if (rest.startsWith(t + " ")) { rest = rest.slice(t.length + 1).trim(); cut = true; break; }
        if (rest.endsWith(" " + t)) { rest = rest.slice(0, rest.length - t.length - 1).trim(); cut = true; break; }
      }
      if (!cut) break;
    }
    if (rest === full) return;
    // 남은 게 실제 아이템 이름일 때만 (엉뚱하게 자르지 않게)
    if (!engine.koNames.has(rest) && !engine.lookup(rest)) return;
    const shown = engine.koNames.has(rest) ? rest : engine.lookup(rest);
    if (nodes.length === 1) {
      setText(nodes[0], shown);
    } else {
      for (const t of nodes) setText(t, "");
      el.dataset.lekrPre = unbrace(shown);
    }
    if (cfg.showOriginal && !el.title) el.title = full;
    touched.add(el);
  }

  // 플래너 능력치 패널 이름표: 속성 이름 표기 우선
  const LABEL = (rules.labelSelectors || []).join(",");
  function translateLabel(el) {
    const nodes = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (sourceOf(n).trim()) nodes.push(n);
    if (!nodes.length || nodes.length > 4) return;
    const src = nodes.map(sourceOf).join("").replace(/\s+/g, " ").trim();
    if (!src || !/[A-Za-z]{2,}/.test(src)) return;
    const ko = firstOk(src, (v) => (HANGUL.test(v) ? null : engine.noun(v) || engine.lookupText(v)));
    if (!ko) {
      engine.misses.add(src);
      return;
    }
    nodes.forEach((t, i) => setText(t, i ? "" : ko));
    if (cfg.showOriginal) el.title = src.trim();
    touched.add(el);
  }

  // 티어리스트·빌드 목록의 빌드 이름
  const BUILD = (rules.buildNameSelectors || []).join(",");
  function translateBuildName(el) {
    const nodes = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      // 빈 줄바꿈이나 <script> 안 텍스트는 빼고 실제 글자가 있는 노드만
      if (n.parentElement && n.parentElement.closest("script, style")) continue;
      if (sourceOf(n).trim()) nodes.push(n);
    }
    if (nodes.length !== 1) return;
    const src = sourceOf(nodes[0]);
    if (!src || HANGUL.test(src) || !/[A-Za-z]/.test(src)) return;
    const ko = engine.lookup(src) || engine.buildName(src);
    if (!ko) {
      engine.misses.add(src.trim());
      return;
    }
    setText(nodes[0], ko);
    if (cfg.showOriginal) el.title = src.trim();
    touched.add(el);
  }

  function process(root) {
    if (!cfg.enabled || !root || root.nodeType !== 1) return;
    applying = true;
    try {
      const lines = root.matches(LINE) ? [root] : root.querySelectorAll(LINE);
      for (const el of lines) if (!translateLine(el) && !translateLinked(el)) translateBlock(el);
      // 줄 밖의 수치 칸 (패시브 노드 능력치 "+30 per point")
      const vals = root.matches(VALUE) ? [root] : root.querySelectorAll(VALUE);
      for (const v of vals) if (!v.closest(LINE)) translateValueEl(v);
      // 스킬 툴팁의 능력치 증감 줄: "8% increased Damage (4% per point)" — 회색 괄호는 살리고 문장째
      const scal = root.matches(SCALING) ? [root] : root.querySelectorAll(SCALING);
      for (const el of scal) if (!translateLinked(el)) translateBlock(el);
      const scopes = root.matches(TEXT_SCOPE) || root.closest(TEXT_SCOPE) ? [root] : root.querySelectorAll(TEXT_SCOPE);
      for (const el of scopes) translateTexts(el);
      // 조각난 문장: 안쪽이 인라인 요소뿐이고 아직 영어가 남은 lep-* 덩어리
      const blocks = root.matches(TEXT_SCOPE) ? [root, ...root.querySelectorAll(TEXT_SCOPE)] : root.querySelectorAll(TEXT_SCOPE);
      for (const el of blocks) {
        if (el.dataset.lekrBlock || el.dataset.lekrLinked || el.dataset.lekrPre !== undefined) continue;
        if (el.closest("[data-lekr-block], [data-lekr-linked]") !== el && el.closest("[data-lekr-block], [data-lekr-linked]")) continue;
        // 글자 조각이 하나뿐인 요소는 텍스트 노드 번역으로 충분
        if (!el.firstElementChild && textPieces(el) < 2) continue;
        if (INLINE_ONLY(el) && hasEnglishLeft(el) && !translateLinked(el)) translateBlock(el);
      }
      const names = root.matches(NAME) ? [root] : root.querySelectorAll(NAME);
      for (const el of names) stripTitles(el);
      if (LABEL) {
        const labels = root.matches(LABEL) ? [root] : root.querySelectorAll(LABEL);
        for (const el of labels) translateLabel(el);
      }
      if (BUILD) {
        const builds = root.matches(BUILD) ? [root] : root.querySelectorAll(BUILD);
        for (const el of builds) translateBuildName(el);
      }
    } finally {
      applying = false;
    }
  }

  function restoreAll() {
    applying = true;
    for (const el of touched) {
      delete el.dataset.lekrBlock;
      delete el.dataset.lekrLinked;
      delete el.dataset.lekrVal;
      delete el.dataset.lekrPre;
      delete el.dataset.lekrPost;
      el.removeAttribute("title");
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) if (written.get(n) === n.nodeValue && original.has(n)) n.nodeValue = original.get(n);
    }
    touched.clear();
    applying = false;
  }

  // 변경된 부분만 모아서 프레임마다 한 번 처리
  const queue = new Set();
  const chan = new MessageChannel();
  chan.port1.onmessage = () => {
    scheduled = false;
    const batch = [...queue];
    queue.clear();
    for (const el of batch) if (el.isConnected) process(el);
  };
  let scheduled = false;
  function enqueue(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return;
    queue.add(el.closest(LINE) || el.closest(SCALING) || el);
    if (!scheduled) {
      scheduled = true;
      // setTimeout은 백그라운드 탭에서 1초 이상 밀리므로 메시지 채널로 다음 작업 틱에 처리
      chan.port2.postMessage(0);
    }
  }

  new MutationObserver((records) => {
    if (applying || !cfg.enabled) return;
    for (const r of records) {
      if (r.type === "characterData") enqueue(r.target);
      else for (const n of r.addedNodes) enqueue(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  process(document.body);
  window.addEventListener("lekr-titles", () => process(document.body));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.showOriginal) cfg.showOriginal = changes.showOriginal.newValue;
    if (changes.itemTitles) location.reload();
    if (changes.enabled) {
      cfg.enabled = changes.enabled.newValue;
      cfg.enabled ? process(document.body) : restoreAll();
    }
  });

  // 미번역 문자열 모으기 (팝업에서 내보내기)
  setInterval(async () => {
    if (!engine.misses.size) return;
    const { misses = [] } = await chrome.storage.local.get("misses");
    // 사이트 UI 문구(맥스롤 버튼 등)는 번역 대상이 아니므로 내보내기에서 뺌 (rules.missIgnore)
    const ignore = new Set(rules.missIgnore || []);
    const fresh = [...engine.misses].filter((m) => !ignore.has(m.trim()));
    const merged = [...new Set([...misses.filter((m) => !ignore.has(m)), ...fresh])].slice(-3000);
    engine.misses.clear();
    chrome.storage.local.set({ misses: merged });
  }, 5000);
})();
