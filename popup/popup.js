const defaults = { enabled: true, dataLayer: true, showOriginal: true, itemTitles: false, source: "letrans", misses: [], lastDataStats: null };
const $ = (id) => document.getElementById(id);

async function render() {
  const s = await chrome.storage.local.get(defaults);
  for (const k of ["enabled", "dataLayer", "showOriginal", "itemTitles"]) $(k).checked = s[k];
  for (const r of document.querySelectorAll("input[name=source]")) r.checked = r.value === s.source;
  $("missCount").textContent = s.misses.length;
  $("dataStats").textContent = s.lastDataStats
    ? `${s.lastDataStats.replaced} 교체 / ${s.lastDataStats.missed} 남음`
    : "-";
  const { dictMeta } = await chrome.storage.local.get("dictMeta");
  $("dictInfo").textContent = dictMeta && dictMeta.version ? `사전 ${dictMeta.version}` : "사전 받는 중…";
  $("dictError").textContent = dictMeta && dictMeta.error ? `업데이트 실패: ${dictMeta.error}` : "";
}

$("syncDict").addEventListener("click", async () => {
  $("syncDict").disabled = true;
  $("note").textContent = "사전 확인 중…";
  const meta = await chrome.runtime.sendMessage({ type: "lekr-sync", force: true }).catch((e) => ({ error: String(e) }));
  $("syncDict").disabled = false;
  $("note").textContent = meta && meta.error ? "업데이트 실패 (기존 사전 유지)" : "최신 사전이에요. 페이지를 새로고침하면 적용돼요";
  render();
});

for (const k of ["enabled", "dataLayer", "showOriginal", "itemTitles"]) {
  $(k).addEventListener("change", (e) => chrome.storage.local.set({ [k]: e.target.checked }));
}

for (const r of document.querySelectorAll("input[name=source]")) {
  r.addEventListener("change", (e) => {
    chrome.storage.local.set({ source: e.target.value });
    $("note").textContent = "페이지를 새로고침하면 적용돼요";
  });
}
for (const k of ["dataLayer", "enabled"]) $(k).addEventListener("change", () => ($("note").textContent = "페이지를 새로고침하면 적용돼요"));

$("exportMisses").addEventListener("click", async () => {
  const { misses } = await chrome.storage.local.get({ misses: [] });
  const blob = new Blob([JSON.stringify(misses.sort(), null, 1)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "le-kr-misses.json" });
  a.click();
});

$("clearMisses").addEventListener("click", async () => {
  await chrome.storage.local.set({ misses: [] });
  render();
});

chrome.storage.onChanged.addListener(render);
render();
