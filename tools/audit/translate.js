// 크롬 번역(구글 번역)을 켰을 때 게임 내용이 그대로인지 검사. harness.js 머리말 참고.
//   node tools/audit/translate.js [페이지 경로=build-guides/bear-beastmaster-guide] [툴팁 대상 선택자]
//   플래너: node tools/audit/translate.js planner/kj6jox0q ".lep-item"
// 같은 페이지를 크롬 번역 없이 한 번, 켜고 한 번 열어서 번역 제외 칸(translate="no")과 툴팁 글자를 비교함.
// 크롬 번역은 임시 프로필에 "영어는 항상 한국어로 번역" 설정을 넣어 켬. 새 프로필은 언어 감지 모델을 받는 데
// 20~30초 걸려서 확장 없이 한 번 열어 두고, 그래도 가끔 안 걸려서 안 걸리면 다시 엶.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { launch, audit, sleep } = require("./harness.js");

const SLUG = process.argv[2] || "build-guides/bear-beastmaster-guide";
const SEL = process.argv[3];
const URL = "https://maxroll.gg/last-epoch/" + SLUG;

// 페이지 안에서 도는 함수 (문자열로 넘김)
function pageSnap() {
  const rendered = (el) => {
    if (el.nodeType === 3) return el.nodeValue;
    if (el.nodeType !== 1) return "";
    let s = el.dataset.lekrPre || "";
    for (const c of el.childNodes) s += rendered(c);
    return s + (el.dataset.lekrPost || "");
  };
  return JSON.stringify({
    translated: /translated/.test(document.documentElement.className),
    marked: [...document.querySelectorAll("[translate=no]")].map((e) => rendered(e).replace(/\s+/g, " ").trim()).filter(Boolean),
    fontsInMarked: document.querySelectorAll("[translate=no] font").length,
    fonts: document.querySelectorAll("font").length
  });
}

async function run(translate, port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lekr-tr-"));
  const profile = path.join(tmp, "p");
  fs.mkdirSync(path.join(profile, "Default"), { recursive: true });
  if (translate) fs.writeFileSync(path.join(profile, "Default", "Preferences"), JSON.stringify({
    translate: { enabled: true }, translate_whitelists: { en: "ko" }, translate_allowlists: { en: "ko" },
    translate_recent_target: "ko", intl: { accept_languages: "ko-KR,ko", selected_languages: "ko-KR,ko" } }));
  const b = await launch({ port, profile, headless: false,
    extraArgs: ["--window-position=40,40", "--window-size=1300,900", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion"] });
  try {
    const isTranslated = (p) => p.ev('/translated/.test(document.documentElement.className)');
    if (translate) {
      const w = await b.open(URL, { noExtension: true, wait: 8000 });
      for (let i = 0; i < 30 && !(await isTranslated(w)); i++) await sleep(2000);
      await w.close();
    }
    let p;
    for (let attempt = 0; ; attempt++) {
      p = await b.open(URL, { wait: 12000 });
      if (!translate) break;
      for (let i = 0; i < 16 && !(await isTranslated(p)); i++) await sleep(1500);
      if (await isTranslated(p)) break;
      await p.close();
      if (attempt >= 3) throw new Error("크롬 번역이 걸리지 않음");
    }
    await sleep(4000);
    const rep = await audit(p, SEL ? { sel: SEL, nodedup: 1, max: 40, settle: 2500, hidden: 1 } : { max: 30, settle: 2500, hidden: 1 });
    const tips = JSON.parse(await p.ev("JSON.stringify(window.__auditTexts)")).map((t) => t[1].replace(/\s+/g, " ").trim());
    const snap = JSON.parse(await p.ev("(" + pageSnap + ")()"));
    await p.close();
    return { ...snap, tips, bad: rep.bad };
  } finally {
    await b.close();
    await sleep(2000);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

(async () => {
  const plain = await run(false, 9381);
  const tr = await run(true, 9382);
  const diff = (a, b) => a.map((x, i) => [x, b[i]]).filter(([x, y]) => x !== y);
  const marked = diff(plain.marked, tr.marked);
  const tips = diff(plain.tips, tr.tips);
  console.log(`${SLUG}: 크롬 번역 ${tr.translated ? "걸림" : "안 걸림"} (바뀐 글자 조각 ${tr.fonts})`);
  console.log(`번역 제외 칸 ${plain.marked.length}/${tr.marked.length}개, 달라진 것 ${marked.length}, 안쪽에 크롬이 손댄 흔적 ${tr.fontsInMarked}`);
  console.log(`툴팁 ${plain.tips.length}/${tr.tips.length}개, 달라진 것 ${tips.length}, 검사에 걸린 툴팁 ${tr.bad.length}`);
  for (const [x, y] of marked.concat(tips).slice(0, 10)) console.log("  원래:", String(x).slice(0, 90), "\n  번역:", String(y).slice(0, 90));
  const ok = tr.translated && !marked.length && !tips.length && !tr.fontsInMarked && plain.marked.length === tr.marked.length && plain.tips.length === tr.tips.length;
  console.log(ok ? "통과" : "실패");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
