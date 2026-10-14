// ISOLATED world: 저장된 사전 읽기. 없으면 백그라운드에 받아오라고 요청하고,
// 그래도 없으면(오프라인 첫 실행 등) 패키지에 사전이 들어 있는 개발용 빌드에서만 그걸 씀.
// bridge.js(document_start)와 dom.js(document_idle)는 같은 공간이라 한 번 읽은 것을 같이 씀.
// 사전이 6MB 넘는 문자열이라 저장소에서 두 번 꺼내면 그만큼 느리고 메모리도 두 배로 듦.
// dom.js가 받아 간 뒤에는 놓아 줌(take)
globalThis.LEKR_STORE = {
  pending: {},
  load(source) {
    const src = source === "official" ? "official" : "letrans";
    if (!this.pending[src]) this.pending[src] = this.read(src);
    return this.pending[src];
  },
  take(source) {
    const src = source === "official" ? "official" : "letrans";
    const p = this.load(src);
    delete this.pending[src];
    return p;
  },
  async read(src) {
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
