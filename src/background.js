// 서비스 워커: 번역 사전을 깃허브 공개 저장소에서 받아 chrome.storage에 보관.
// 사전은 코드가 아닌 데이터(JSON)라 확장 업데이트 없이 저장소에 올리기만 하면 반영됨.
const REMOTE = "https://raw.githubusercontent.com/fnrkp089/le-kr-dict/main/";
const FILES = { letrans: "le_ko_letrans.json", official: "le_ko_official.json", rules: "rules.json" };
const CHECK_EVERY = 6 * 60 * 60 * 1000; // 6시간

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let running = null;
async function sync(force) {
  const now = Date.now();
  const { dictMeta = {} } = await chrome.storage.local.get("dictMeta");
  const have = await chrome.storage.local.get(Object.keys(FILES).map((k) => "dict_" + k));
  const complete = Object.keys(FILES).every((k) => have["dict_" + k]);
  if (!force && complete && dictMeta.checkedAt && now - dictMeta.checkedAt < CHECK_EVERY) return dictMeta;

  let index;
  try {
    const res = await fetch(`${REMOTE}version.json?t=${now}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`version.json ${res.status}`);
    index = await res.json();
  } catch (err) {
    return { ...dictMeta, error: String(err) };
  }
  if (!force && complete && index.version === dictMeta.version) {
    const meta = { ...dictMeta, checkedAt: now, error: null };
    await chrome.storage.local.set({ dictMeta: meta });
    return meta;
  }

  const out = {};
  for (const [key, file] of Object.entries(FILES)) {
    try {
      const res = await fetch(`${REMOTE}${file}?v=${encodeURIComponent(index.version)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${file} ${res.status}`);
      const text = await res.text();
      const want = index.files && index.files[file] && index.files[file].sha256;
      if (want && (await sha256(text)) !== want) throw new Error(`${file} 해시 불일치`);
      JSON.parse(text); // 깨진 파일은 저장하지 않음
      out["dict_" + key] = text;
    } catch (err) {
      return { ...dictMeta, error: String(err) }; // 하나라도 실패하면 기존 사전 유지
    }
  }
  const meta = { version: index.version, checkedAt: now, updatedAt: now, error: null };
  await chrome.storage.local.set({ ...out, dictMeta: meta });
  return meta;
}

function syncOnce(force) {
  if (!running) running = sync(force).finally(() => (running = null));
  return running;
}

chrome.runtime.onInstalled.addListener(() => syncOnce(true));
chrome.runtime.onStartup.addListener(() => syncOnce(false));
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.type !== "lekr-sync") return;
  syncOnce(!!msg.force).then(reply, (err) => reply({ error: String(err) }));
  return true;
});
