// ISOLATED world, document_idle.
// 페이지 오른쪽 아래에 번역 전환 버튼: LETrans / 공식 / 원문.
// 게임 데이터 치환은 페이지를 불러올 때 일어나므로 바꾸면 새로고침함.
(async function () {
  const cfg = await chrome.storage.local.get({ enabled: true, source: "letrans", togglePos: null });
  const current = !cfg.enabled ? "off" : cfg.source === "official" ? "official" : "letrans";

  const host = document.createElement("div");
  host.id = "lekr-toggle";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .bar {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
        display: flex; align-items: center; gap: 2px; padding: 3px;
        background: rgba(22, 19, 27, 0.92); border: 1px solid #3a3145; border-radius: 999px;
        font: 600 12px/1 system-ui, "Malgun Gothic", sans-serif; color: #ece6f3;
        box-shadow: 0 4px 16px rgba(0,0,0,.35); user-select: none;
      }
      .label { padding: 0 8px 0 10px; color: #d9a441; letter-spacing: .02em; }
      button {
        all: unset; cursor: pointer; padding: 6px 10px; border-radius: 999px; color: #b9aec8;
      }
      button:hover { color: #fff; background: rgba(255,255,255,.06); }
      button[aria-pressed="true"] { background: #d9a441; color: #1a1408; }
      button:focus-visible { outline: 2px solid #d9a441; outline-offset: 1px; }
    </style>
    <div class="bar" role="group" aria-label="번역 선택">
      <span class="label">한글</span>
      <button data-v="letrans">LETrans</button>
      <button data-v="official">공식</button>
      <button data-v="off">원문</button>
    </div>`;

  for (const b of shadow.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.v === current));
    b.addEventListener("click", async () => {
      if (b.dataset.v === current) return;
      const next = b.dataset.v === "off" ? { enabled: false } : { enabled: true, source: b.dataset.v };
      await chrome.storage.local.set(next);
      location.reload();
    });
  }
  document.documentElement.appendChild(host);
})();
