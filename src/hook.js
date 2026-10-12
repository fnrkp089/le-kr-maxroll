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
