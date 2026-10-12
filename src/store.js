// ISOLATED world: 저장된 사전 읽기. 없으면 백그라운드에 받아오라고 요청하고,
// 그래도 없으면(오프라인 첫 실행 등) 패키지에 사전이 들어 있는 개발용 빌드에서만 그걸 씀.
globalThis.LEKR_STORE = {
  async load(source) {
    const src = source === "official" ? "official" : "letrans";
    const keys = ["dict_" + src, "dict_rules"];
    let s = await chrome.storage.local.get(keys);
    if (!s["dict_" + src]) {
      try {
        await chrome.runtime.sendMessage({ type: "lekr-sync" });
      } catch (_) {}
      s = await chrome.storage.local.get(keys);
    } else {
      chrome.runtime.sendMessage({ type: "lekr-sync" }).catch(() => {}); // 6시간마다 새 버전 확인
    }
    const bundled = async (file) => {
      try {
        const r = await fetch(chrome.runtime.getURL("data/" + file));
        return r.ok ? await r.text() : null;
      } catch (_) {
        return null;
      }
    };
    const dictText = s["dict_" + src] || (await bundled(`le_ko_${src}.json`));
    const rulesText = s.dict_rules || (await bundled("rules.json"));
    return { dictText, rulesText };
  }
};
