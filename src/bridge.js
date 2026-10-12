// ISOLATED world, document_start.
// MAIN world의 hook.js는 chrome.* API를 못 쓰므로, 사전 위치와 설정을 <html> 속성으로 넘겨줌.
(function () {
  const html = document.documentElement;
  const defaults = { enabled: true, dataLayer: true, source: "letrans" };

  chrome.storage.local.get(defaults, async (cfg) => {
    // 사전은 chrome.storage에 문자열로 있음. MAIN world의 hook.js가 읽을 수 있게 페이지 쪽 blob 주소로 넘김
    let dictText = null;
    let rulesText = null;
    if (cfg.enabled && cfg.dataLayer) {
      try {
        ({ dictText, rulesText } = await globalThis.LEKR_STORE.load(cfg.source));
      } catch (_) {}
    }
    const blobUrl = (t) => URL.createObjectURL(new Blob([t], { type: "application/json" }));
    if (dictText && rulesText) {
      html.dataset.lekrDict = blobUrl(dictText);
      html.dataset.lekrRules = blobUrl(rulesText);
      html.dataset.lekrData = "1";
    } else {
      html.dataset.lekrData = "0";
    }
    html.dataset.lekrReady = "1";
  });

  // 아이템 이름에서 떼어낼 접사 칭호 목록 (dom.js가 씀)
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.type !== "lekr-titles") return;
    globalThis.__lekrTitles = new Set(e.data.titles || []);
    // 데이터 계층이 바꾼 짧은 한글 → 영어 (맥스롤이 영어 문장에 끼워 넣은 조각을 되돌려 문장째 번역하려고)
    globalThis.__lekrReverse = new Map(e.data.reverse || []);
    window.dispatchEvent(new Event("lekr-titles"));
  });

  // hook.js가 데이터 치환 결과를 알려주면 팝업에서 볼 수 있게 저장
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.type !== "lekr-data-stats") return;
    chrome.storage.local.set({ lastDataStats: { ...e.data.stats, at: Date.now() } });
  });
})();
