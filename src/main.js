// 자동 생성 파일: node tools/bundle.js (직접 수정 금지, src/core.js와 src/hook.js를 고칠 것)
// LE 한글 툴팁: 공용 번역 엔진 (MAIN world와 ISOLATED world 양쪽에서 로드됨)
(function (root) {
  if (root.LEKR) return;

  const VALUE = "#"; // 툴팁 줄에서 수치 자리를 나타내는 토큰
  const HANGUL = /[가-힣]/;

  // 매칭용 키: 따옴표 통일, 공백 정리, 소문자
  function norm(s) {
    return String(s)
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/armour/g, "armor"); // 맥스롤 일부 데이터는 영국식 표기
  }
  const tnorm = (s) => norm(s).replace(/\s*#\s*/g, VALUE);
  // 맥스롤 내부 이름은 따옴표·띄어쓰기가 빠진 경우가 있음 (Apiarists Comb, IsadoraTombbinding)
  // 두 가지로 풀어서 비교: 따옴표만 뺀 것 / 소유격 's까지 뺀 것
  const loose = (s) => norm(s).replace(/[^a-z0-9]/g, "");
  const looseNoPoss = (s) => norm(s).replace(/'s\b/g, "").replace(/[^a-z0-9]/g, "");

  // 데이터 치환 대상 필드. 맥스롤 data.json에서 화면에 그대로 표시되는 문자열만.
  // propertyName은 맥스롤이 "X% Increased " + 이름처럼 조립하는 재료라서 빼고,
  // 조립된 줄 전체를 화면 계층에서 게임 문장(slotted)으로 번역함.
  // name/title은 맥스롤이 검색·연결에 쓸 수 있어서 화면 계층에서 번역함.
  // affixTitle은 바꾸지 않고 칭호 목록(아이템 이름에서 떼어낼 것)으로만 모음.
  const DATA_FIELDS = new Set([
    "displayName", "affixName", "affixDisplayName",
    "nodeName", "description", "altText", "loreText", "statName",
    "defaultAltText", "overrideAltText", "pointBonusDescription",
    "setName", "typeName", "subTypeName", "baseTypeName"
  ]);
  const TITLE_FIELD = "affixTitle";
  // 화면 계층에서 색 입힌 조각(링크·등급)을 자리표시자로 바꿔 문장째 번역할 때 쓰는 문자
  const SLOT_RE = /[\uE001-\uE0FF]/;

  function toMap(obj, keyFn = norm) {
    const m = new Map();
    for (const [k, v] of Object.entries(obj || {})) if (!k.startsWith("_")) m.set(keyFn(k), v);
    return m;
  }

  function createEngine(dict, rules, opts) {
    dict = dict || {};
    rules = rules || {};
    // 아이템 이름의 접사 칭호(활달한 ~ - 거인)를 붙일지. 기본은 LE Tools처럼 고유 이름만.
    const withTitles = !!(opts && opts.itemTitles);
    const names = toMap(dict.names);
    for (const [k, v] of toMap(rules.nouns)) if (!names.has(k)) names.set(k, v);
    const looseNames = new Map();
    for (const [k, v] of names) {
      for (const l of [loose(k), looseNoPoss(k)]) if (l.length >= 6 && !looseNames.has(l)) looseNames.set(l, v);
    }
    const looseGet = (k) => looseNames.get(loose(k)) || looseNames.get(looseNoPoss(k));
    // "Unique Leather Coat"처럼 등급 + 기본 이름으로 조립된 문자열의 앞 단어
    const textPrefixes = toMap(rules.textPrefixes);
    const numbered = toMap(dict.numbered); // "skeletons have # base health." → "해골의 기본 생명력은 {0}입니다."
    const stats = toMap(dict.stats);
    const bag = (s) => norm(s).split(" ").sort().join(" ");
    const bagNames = new Map();
    const bagSlotted = new Map();
    const fillBag = (src, dst) => {
      for (const [k, v] of Object.entries(src || {})) {
        const n = k.split(" ").length;
        if (n < 2 || n > 6) continue;
        const b = bag(k);
        dst.set(b, dst.has(b) && dst.get(b) !== v ? null : v); // 같은 단어 묶음이 여러 뜻이면 쓰지 않음
      }
    };
    fillBag(dict.names, bagNames);
    fillBag(dict.slotted, bagSlotted); // 속성 문맥에서 우선하는 표기 (예: Armor → 방어도)
    const slotted = toMap(dict.slotted); // "Increased Bleed Duration" → "출혈 지속시간 # 증가"
    const templates = toMap(dict.templates, tnorm);
    for (const [k, v] of toMap(rules.templates, tnorm)) if (!templates.has(k)) templates.set(k, v);

    // [영어 접두, 한국어 접두, 영어 이름 변형들]  변형의 {n}에 나머지 이름이 들어감
    const prefixes = (rules.prefixes || []).map(([en, ko, forms]) => [norm(en), ko, forms || []]);
    const suffixes = (rules.suffixes || []).map(([en, ko, forms]) => [norm(en), ko, forms || []]);
    const core = (rules.core || []).map((r) => ({ re: new RegExp(r.re, "i"), ko: r.ko, noun: r.noun || 0 }));
    // 맥스롤 표현을 게임 속성 이름으로 바꿔 찾기. 예: "+# to Summon Skeleton" → "Level of Summon Skeleton"
    const reshape = (rules.reshape || []).map((r) => ({ re: new RegExp(r.re, "i"), names: r.names || [r.name], fallback: r.fallback, noun: r.noun || 0 }));
    const textRules = (rules.textRules || []).filter((r) => r.re).map((r) => ({ re: new RegExp(r.re, "i"), ko: r.ko }));

    const valueRules = Object.entries(rules.valueText || {})
      .filter(([k]) => !k.startsWith("_"))
      .map(([re, ko]) => [new RegExp(re, "i"), ko]);
    // 수치 칸 안에 섞인 영어 (예: "1 in 20" → "1/20")
    function translateValue(text) {
      const t = text.trim();
      for (const [re, ko] of valueRules) if (re.test(t)) return text.replace(t, t.replace(re, ko));
      return null;
    }

    const misses = new Set();

    function lookup(text) {
      if (!text) return null;
      const key = norm(text);
      if (!key) return null;
      const exact = names.get(key);
      if (exact) return exact;
      const v = looseGet(key);
      if (!v) return null;
      // 느슨한 비교는 문장부호를 무시하므로, 문장 조각이 짝 안 맞는 괄호로 잘려 있으면 되살림 ("per point)" → "포인트당)")
      const opens = (key.match(/\(/g) || []).length;
      const closes = (key.match(/\)/g) || []).length;
      let out = v;
      if (closes > opens && /\)\W*$/.test(key) && !/\)\W*$/.test(out)) out += ")";
      if (opens > closes && /^\W*\(/.test(key) && !/^\W*\(/.test(out)) out = "(" + out;
      return out;
    }

    // 화면의 문자열 하나: 사전 → 숫자 바뀐 문장 → 값 하나짜리 속성 줄 → 태그 목록 → 조립 규칙 → 등급 접두
    function lookupText(text, depth = 0) {
      const hit = lookup(text);
      if (hit) return hit;
      const t = text.replace(/\s+/g, " ").trim();
      if (!t || depth > 6) return null;
      // 값 자리가 있는 속성 이름이 값 없이 이름표로만 나올 때 (패시브 스탯 이름 등)
      const sl = slotted.get(norm(t)) || (/^[A-Za-z' ]+$/.test(t) ? bagSlotted.get(bag(t)) : null);
      if (sl) {
        return sl
          .replace(/의\s*#\s*(를|을|이|가|는|은)/, "$1")
          .replace(/의\s*#/, "")
          .replace(/\s*#\s*/, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      const nums = t.match(/\d+(?:[.,]\d+)*/g);
      if (nums) {
        const tpl = numbered.get(norm(t.replace(/\d+(?:[.,]\d+)*/g, "#")));
        if (tpl) return tpl.replace(/\{(\d+)\}/g, (_, i) => nums[Number(i)] ?? "");
      }
      const sub = (s) => (/[A-Za-z]{2,}/.test(s) ? lookupText(s, depth + 1) : s);
      if (nums && nums.length === 1) {
        const tpl = templates.get(tnorm(t.replace(nums[0], VALUE)));
        if (tpl) return tpl.replace(VALUE, nums[0]);
      }
      for (const r of textRules) {
        const m = t.match(r.re);
        if (!m) continue;
        let ok = true;
        const out = r.ko.replace(/\$(\d)/g, (_, i) => {
          const g = (m[Number(i)] || "").trim();
          const v = sub(g);
          if (v == null) ok = false;
          return v ?? g;
        });
        if (ok) return out;
      }
      // 자리표시자(색 입힌 조각)가 섞인 구절: 조각 사이 글자만 따로 번역
      if (SLOT_RE.test(t)) {
        const parts = t.split(/([\uE001-\uE0FF])/).map((p) => {
          if (SLOT_RE.test(p) || !p.trim()) return p.trim() ? p : "";
          const c = CONNECT[norm(p)];
          return c != null ? c : sub(p.trim());
        });
        if (parts.every((p) => p != null)) return parts.filter((p) => p !== "").join(" ").replace(/\s+/g, " ").trim();
        return null;
      }
      // "8% increased Damage"처럼 수치 하나 + 속성 이름
      if (nums && nums.length === 1) {
        const m = t.match(/^(.*?)([+-]?\d+(?:[.,]\d+)*%?)(.*)$/);
        if (m && /[A-Za-z]/.test(m[1] + m[3])) {
          const r = translateLine(m[1], m[3], true);
          if (r) return r.pre + m[2] + r.post;
        }
      }
      // "Minion, Intelligence" 같은 태그 목록
      if (t.includes(", ")) {
        const parts = t.split(/,\s*/).map(sub);
        if (parts.every(Boolean)) return parts.join(", ");
      }
      const sp = t.indexOf(" ");
      if (sp > 0) {
        const head = textPrefixes.get(norm(t.slice(0, sp)));
        const rest = head && sub(t.slice(sp + 1));
        if (rest) return `${head} ${rest}`;
      }
      // 접사 칭호가 붙은 아이템 이름: [앞 칭호] 이름 [of 뒤 칭호]
      // 예: Mercurial Foot of the Mountain of the Giant → 활달한 산의 발 - 거인
      //     Manafused Exulis → 마나융합 엑술리스
      // 아이템 이름처럼 단어마다 대문자로 시작할 때만 (" increased Mana Efficiency" 같은 문구 제외)
      if (t.length <= 80 && !/\d/.test(t) && t.split(" ").every((w) => /^(of|the|[A-Z'"(])/.test(w))) {
        const words = t.split(" ");
        const n = words.length;
        const part = (a, b) => lookup(words.slice(a, b).join(" "));
        let best = null;
        for (let i = 0; i < n; i++) {
          const pre = i ? part(0, i) : "";
          if (i && !pre) continue;
          for (let j = n; j > i; j--) {
            if (j < n && words[j].toLowerCase() !== "of") continue;
            if (!i && j === n) continue; // 칭호가 하나도 없으면 조립 아님
            const suf = j < n ? part(j, n) : "";
            if (j < n && !suf) continue;
            const mid = part(i, j);
            if (!mid) continue;
            const len = j - i; // 가운데 이름이 길수록 우선
            const text = [pre, mid, suf].filter(Boolean).join(" ");
            if (!best || len > best.len) best = { len, text };
          }
        }
        if (best) return best.text;
      }
      // 정관사 차이 (The Age of Winter ↔ Age of Winter)
      // 단어 순서만 다른 경우 (Shred Armor Effect ↔ Armor Shred Effect). 같은 단어 묶음이 여러 뜻이면 안 씀
      if (/^[A-Za-z' ]+$/.test(t)) {
        const bg = bagNames.get(bag(t));
        if (bg) return bg;
      }
      if (/^the /i.test(t)) return sub(t.slice(4));
      // 끝 마침표 차이
      return lookup("the " + t) || (/\.$/.test(t) ? lookup(t.slice(0, -1)) : lookup(t + "."));
      return null;
    }
    const CONNECT = { or: "또는", and: "및", ",": ",", "": "" };

    // 속성 명사: 이미 한글이면 그대로, 속성 표기 우선, 없으면 일반 사전
    function noun(text) {
      const t = text.replace(/\s+/g, " ").trim();
      if (!t) return null;
      if (HANGUL.test(t) && !/[A-Za-z]{2,}/.test(t)) return t;
      const k = norm(t);
      return stats.get(k) || names.get(k) || looseGet(k) || bagNames.get(bag(k)) || null;
    }

    // 값이 붙은 속성 이름 하나를 한글 줄로. sign/pct는 맥스롤이 텍스트로 떼어 놓은 "+", "%"
    function nameLine(nameEn, sign, pct) {
      const k = norm(nameEn);
      if (!k) return null;
      const s = slotted.get(k) || bagSlotted.get(bag(k));
      if (s) return s.replace(VALUE, sign + VALUE + pct);
      const n = noun(nameEn);
      if (n) return `${n} ${sign}${VALUE}${pct}`;
      return null;
    }

    // pre + [값] + post 로 쪼개진 툴팁 한 줄을 한국어 어순으로 재배치.
    // 성공하면 {pre, post}, 모르면 null.
    function translateLine(pre, post, quiet) {
      const en = (pre + VALUE + post).replace(/\s+/g, " ").trim();
      if (!en.includes(VALUE)) return null;

      // 1. 영어에도 수치 자리가 있는 완성형 문장
      const direct = templates.get(tnorm(en));
      if (direct) return split(direct);
      const sign = en.match(/([+-]?)#(%?)/);
      if (sign && (sign[1] || sign[2])) {
        const bare = templates.get(tnorm(en.replace(sign[0], VALUE)));
        if (bare) return split(bare.replace(VALUE, sign[1] + VALUE + sign[2]));
      }

      // 2. 수치 토큰을 빼면 게임 속성 이름이 되는 경우 (대부분의 접사 줄)
      //    "+#% Chance to Inflict Bleed on Hit" → 이름 "Chance to Inflict Bleed on Hit"
      const tok = sign ? sign[0] : VALUE;
      const sg = sign ? sign[1] : "";
      const pc = sign ? sign[2] : "";
      const at = en.indexOf(tok);
      if (at === 0 || at + tok.length === en.length) {
        const name = en.replace(tok, " ").trim();
        const r = nameLine(name, sg, pc);
        if (r) return split(r);
      }

      // 3. 접두·접미 조건문을 떼고 다시 시도. 게임 표기 변형(예: "X for Minions")을 먼저 찾음
      let body = en;
      const koParts = [];
      for (let guard = 0; guard < 4; guard++) {
        const lower = body.toLowerCase();
        const p = prefixes.find(([e]) => lower.startsWith(e));
        const s = !p && suffixes.find(([e]) => lower.endsWith(e));
        if (!p && !s) break;
        const [e, ko, forms] = p || s;
        body = (p ? body.slice(e.length) : body.slice(0, body.length - e.length)).trim();
        const m = body.match(/^([+-]?)#(%?)\s*(.+)$/);
        if (m) {
          for (const f of forms) {
            const r = nameLine(f.replace("{n}", m[3]), m[1], m[2]);
            if (r) return split([...koParts, r].join(" "));
          }
        }
        koParts.push(ko);
      }

      // 4. 나머지 이름만으로 (조건문은 한국어 접두로)
      const m = body.match(/^([+-]?)#(%?)\s*(.+)$/);
      if (m) {
        const r = nameLine(m[3], m[1], m[2]);
        if (r) return split([...koParts, r].join(" ").replace(/\s+/g, " ").trim());
      }

      // 5. 표현 바꿔 찾기
      for (const rule of reshape) {
        const mm = body.match(rule.re);
        if (!mm) continue;
        const fill = (s) => s.replace(/\$(\d)/g, (_, i) => mm[Number(i)] || "");
        for (const nm of rule.names) {
          const r = nameLine(fill(nm), mm[1] || "", mm[2] || "");
          if (r) return split([...koParts, r].join(" ").replace(/\s+/g, " ").trim());
        }
        const nounKo = rule.noun && noun(mm[rule.noun]);
        if (rule.fallback && nounKo) {
          const out = rule.fallback.replace(/\$(\d)/g, (_, i) => (Number(i) === rule.noun ? nounKo : mm[Number(i)] || ""));
          return split([...koParts, out].join(" ").replace(/\s+/g, " ").trim());
        }
      }

      // 6. 일반 규칙 (increased/more 등 + 명사)
      for (const rule of core) {
        const mm = body.match(rule.re);
        if (!mm) continue;
        const idx = rule.noun;
        const nounKo = idx ? noun(mm[idx]) : "";
        if (idx && !nounKo) break;
        const out = rule.ko.replace(/\$(\d)/g, (_, i) => (Number(i) === idx ? nounKo : mm[Number(i)] || ""));
        return split([...koParts, out].join(" ").replace(/\s+/g, " ").trim());
      }
      if (!quiet) misses.add(en);
      return null;
    }

    // 수치 바로 뒤에 붙어도 되는 말 (단위·조사). 그 밖의 한글이 오면 한 칸 띄움.
    const ATTACHED = /^(을\(를\)|은\(는\)|이\(가\)|을|를|이|가|은|는|의|에|로|으로|와|과|만큼|까지|씩|당|배|초|분|시간|일|개|회|번|중첩|미터|마리|포인트|등급|레벨|명|단계|칸|스택)/;

    function split(ko) {
      const i = ko.indexOf(VALUE);
      if (i < 0) return null;
      let pre = ko.slice(0, i);
      let post = ko.slice(i + VALUE.length);
      if (/[가-힣A-Za-z]$/.test(pre)) pre += " ";
      if (HANGUL.test(post.charAt(0)) && !ATTACHED.test(post)) post = " " + post;
      return { pre, post };
    }

    // data.json 전체를 돌며 표시용 문자열만 교체. 원본 객체를 직접 수정.
    // 수치 칸이 여러 개인 줄: parts = [{text}|{value}] → 숫자 자리 템플릿으로 통째 번역
    function lookupValues(parts) {
      let key = "";
      const fills = [];
      for (const p of parts) {
        if (p.value != null) {
          const m = String(p.value).trim().match(/^([+-]?)(.*?)(%?)$/);
          key += m[1] + VALUE + m[3];
          fills.push(m[2]);
        } else {
          key += String(p.text).replace(/\d+(?:[.,]\d+)*/g, (n) => {
            fills.push(n);
            return VALUE;
          });
        }
      }
      const k = norm(key);
      const tpl = numbered.get(k) || numbered.get(k.replace(/\.$/, "")) || numbered.get(k + ".");
      if (!tpl) return null;
      return tpl.replace(/\{(\d+)\}/g, (_, i) => fills[Number(i)] ?? "");
    }

    function bySentence(value) {
      const out = value.split(/(\n+)/).map((para) => {
        if (/^\n+$/.test(para) || !para.trim()) return para;
        const ss = para.split(/(?<=[.!?])\s+(?=[A-Z{])/);
        if (ss.length < 2 && lookupText(para) == null) return null;
        const ko = ss.map((x) => lookupText(x));
        return ko.every((x) => x != null) ? ko.join(" ") : null;
      });
      return out.every((p) => p != null) ? out.join("") : null;
    }

    const dataKeep = {};
    for (const [field, list] of Object.entries(rules.dataKeep || {})) if (Array.isArray(list)) dataKeep[field] = list.map((re) => new RegExp(re));
    function transformData(data) {
      const result = { replaced: 0, missed: 0, titles: [], reverse: [] };
      const reverse = new Map(); // 화면에서 맥스롤이 영어 문장에 끼워 넣는 짧은 한글 → 원래 영어
      const titles = new Set();
      const seen = new WeakSet();
      (function walk(node) {
        if (!node || typeof node !== "object" || seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
          for (const item of node) walk(item);
          return;
        }
        for (const key of Object.keys(node)) {
          const value = node[key];
          if (typeof value === "string") {
            if (key === TITLE_FIELD && value && !HANGUL.test(value)) {
              titles.add(value);
              const kt = lookupText(value);
              if (kt) titles.add(kt);
              continue;
            }
            if (!DATA_FIELDS.has(key) || !value || HANGUL.test(value)) continue;
            // 맥스롤이 값 자체로 걸러내는 문자열은 그대로 둠 (축복 "Grand " 필터). 화면 계층이 번역 (rules.dataKeep)
            if (dataKeep[key] && dataKeep[key].some((re) => re.test(value))) continue;
            let ko = key === "statName" ? noun(value) || lookupText(value) : lookupText(value);
            // 여러 문단이면 문단별로 (게임 원문과 문단 구성이 다를 때)
            if (!ko && /\n/.test(value)) {
              const parts = value.split(/(\n+)/);
              const out = parts.map((p) => (/^\n+$/.test(p) || !p.trim() ? p : lookupText(p)));
              if (out.every((p) => p != null)) ko = out.join("");
            }
            // 문장별로 (게임 원문에 없는 문장 조합일 때)
            if (!ko && key === "description" || !ko && key === "altText") ko = bySentence(value);
            if (ko && value.length <= 80) {
              const list = reverse.get(ko) || [];
              if (list.length < 4 && !list.includes(value)) list.push(value);
              reverse.set(ko, list);
            }
            if (ko) {
              node[key] = ko;
              result.replaced++;
            } else if (/[A-Za-z]/.test(value)) {
              result.missed++;
            }
          } else if (value && typeof value === "object") {
            walk(value);
          }
        }
      })(data);
      result.titles = [...titles];
      result.reverse = [...reverse];
      return result;
    }

    // 빌드 이름 (스킬 + 전직): "Shield Throw Time Rot VK" → "방패 투척 시간 부패 공허기사"
    // 단어를 앞에서부터 사전 구절로 덮되, 가장 긴 구절 우선(조각 수 최소)
    const buildTerms = toMap(rules.buildTerms);
    function termKo(ph) {
      const k = norm(ph);
      if (buildTerms.has(k)) return buildTerms.get(k);
      if (/^\(.*\)$/.test(ph)) return ph;
      const hit = names.get(k) || looseGet(k);
      if (hit) return hit;
      // 단수·복수 차이 (Skeleton ↔ Skeletons, Storm Crows ↔ Storm Crow)
      const alt = k.endsWith("s") ? k.slice(0, -1) : k + "s";
      if (names.has(alt)) return names.get(alt);
      // 소환수 이름은 "X 소환" 스킬로만 있는 경우가 많음 (Sabertooth → 검치호 소환 → 검치호)
      for (const key of ["summon " + k, "summon " + alt]) {
        const v = names.get(key);
        if (v && / 소환$/.test(v)) return v.replace(/ 소환$/, "");
      }
      return null;
    }
    function buildName(text) {
      const w = text.replace(/\s+/g, " ").trim().split(" ");
      const n = w.length;
      if (!n || n > 8) return null;
      const dp = Array(n + 1).fill(null);
      dp[0] = [];
      for (let i = 1; i <= n; i++) {
        for (let j = 0; j < i; j++) {
          if (!dp[j]) continue;
          const ko = termKo(w.slice(j, i).join(" "));
          if (ko && (!dp[i] || dp[j].length + 1 < dp[i].length)) dp[i] = dp[j].concat(ko);
        }
      }
      return dp[n] ? dp[n].join(" ") : null;
    }

    const koNames = new Set([...names.values()]);
    // 줄글(플래너 메모) 안 텍스트용: 느슨한 비교 없이 정확히 같은 문장만
    // 한글 → 영어 후보 (사전 기준, 짧은 이름만). 화면에서 끼워 넣어진 한글 조각을 되돌릴 때 씀
    let koIndex = null;
    function koCandidates(ko) {
      if (!koIndex) {
        koIndex = new Map();
        for (const [k, v] of names) {
          if (typeof v !== "string" || v.length > 30 || /[\n#{]/.test(v) || k.length > 40) continue;
          const list = koIndex.get(v);
          if (!list) koIndex.set(v, [k]);
          else if (list.length < 6) list.push(k);
        }
      }
      return koIndex.get(ko) || [];
    }
    const lookupExact = (text) => (text ? names.get(norm(text)) || null : null);
    return { koCandidates, lookupExact, lookupValues, koNames, buildName, lookup, lookupText, noun, translateValue, translateLine, transformData, misses, size: names.size };
  }

  root.LEKR = { VALUE, HANGUL, SLOT_RE, norm, createEngine, DATA_FIELDS };
})(typeof globalThis !== "undefined" ? globalThis : this);

// MAIN world, document_start.
// 맥스롤 플래너가 받는 게임 데이터(data.json)를 가로채 화면 표시용 문자열을 한글로 바꿔서 넘김.
// 원본 응답을 받은 뒤 그 위에 덮어쓰므로 맥스롤 데이터 버전이 바뀌어도 깨지지 않고,
// 사전에 없는 문자열은 영어 그대로 남음.
(function () {
  const TARGET = /\/leplanner\/game\/data\.json/;
  const html = document.documentElement;
  const origFetch = window.fetch;

  // bridge.js가 설정을 넘겨줄 때까지 대기 (최대 6초, 넘으면 원본 통과)
  const ready = new Promise((resolve) => {
    if (html.dataset.lekrReady === "1") return resolve();
    const mo = new MutationObserver(() => {
      if (html.dataset.lekrReady === "1") {
        mo.disconnect();
        resolve();
      }
    });
    mo.observe(html, { attributes: true, attributeFilter: ["data-lekr-ready"] });
    setTimeout(() => {
      mo.disconnect();
      resolve();
    }, 6000);
  });

  let enginePromise = null;
  function getEngine() {
    if (!enginePromise) {
      enginePromise = Promise.all([
        origFetch(html.dataset.lekrDict).then((r) => r.json()),
        origFetch(html.dataset.lekrRules).then((r) => r.json())
      ]).then(([dict, rules]) => globalThis.LEKR.createEngine(dict, rules));
    }
    return enginePromise;
  }

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    if (!url || !TARGET.test(url)) return origFetch.apply(this, arguments);

    const res = await origFetch.apply(this, arguments);
    try {
      await ready;
      if (html.dataset.lekrData !== "1" || !res.ok) return res;
      const [data, engine] = await Promise.all([res.clone().json(), getEngine()]);
      const stats = engine.transformData(data);
      const { titles, reverse, ...counts } = stats;
      window.postMessage({ type: "lekr-data-stats", stats: counts }, "*");
      window.postMessage({ type: "lekr-titles", titles, reverse }, "*");
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(JSON.stringify(data), { status: res.status, statusText: res.statusText, headers });
    } catch (err) {
      console.warn("[LE 한글] 데이터 치환 실패, 원본 사용:", err);
      return res;
    }
  };
})();
