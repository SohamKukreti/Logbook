// In-page limit notices. Injected on every http(s) page; sits idle until
// the background worker sends a "logbook-limit" message for this domain.
// Self-contained on purpose: content scripts are plain scripts, so no
// imports — sharing code with the lib would pull in module chunks.

interface LimitMessage {
  type: "logbook-limit";
  kind: "warn" | "limit";
  domain: string;
  usedMs: number;
  limitMs: number;
}

interface EtaMessage {
  type: "logbook-limit-eta";
  /** ms until this site crosses its next limit threshold. */
  msToGo: number;
}

(() => {
  // The background injects this into open tabs at install, and the
  // manifest injects it on page load — never run twice in one page.
  const w = window as unknown as { __logbookLimitNotice?: boolean };
  if (w.__logbookLimitNotice) return;
  w.__logbookLimitNotice = true;

  const HOST_ID = "logbook-limit-notice";
  const BANNER_MS = 12_000;

  // Same output as src/lib/format.ts formatDuration.
  function fmt(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; }
    .wrap {
      position: fixed;
      z-index: 2147483647;
      font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      color: #2a241b;
    }
    .banner {
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      max-width: min(560px, calc(100vw - 32px));
      background: #fdfbf5;
      border: 1px solid rgba(42, 36, 27, 0.28);
      border-left: 4px solid #b23a2e;
      border-radius: 4px;
      box-shadow: 0 4px 18px rgba(42, 36, 27, 0.18);
      padding: 12px 16px;
      display: flex;
      align-items: baseline;
      gap: 12px;
    }
    .overlay {
      inset: 0;
      background: rgba(42, 36, 27, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #fdfbf5;
      border: 1px solid rgba(42, 36, 27, 0.28);
      border-radius: 4px;
      box-shadow: 0 10px 40px rgba(42, 36, 27, 0.35);
      max-width: 440px;
      padding: 28px 32px;
      text-align: center;
    }
    .stamp {
      display: inline-block;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 12px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #b23a2e;
      border: 1px solid #b23a2e;
      border-radius: 2px;
      padding: 4px 10px;
      transform: rotate(-2deg);
      margin-bottom: 14px;
    }
    .title { font-size: 21px; font-weight: 600; margin-bottom: 8px; }
    .text { font-size: 15px; line-height: 1.5; }
    .text b { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-weight: 400; }
    .muted { color: rgba(42, 36, 27, 0.55); }
    button {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #b23a2e;
      background: transparent;
      border: 1px solid #b23a2e;
      border-radius: 2px;
      padding: 5px 14px;
      cursor: pointer;
    }
    button:hover { background: rgba(178, 58, 46, 0.1); }
    .banner button { border: none; padding: 0 4px; font-size: 15px; line-height: 1; }
    .card button { margin-top: 18px; }
  `;

  let hideTimer: number | undefined;

  function mount(): ShadowRoot {
    document.getElementById(HOST_ID)?.remove();
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    const host = document.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);
    document.documentElement.appendChild(host);
    return root;
  }

  function dismiss(): void {
    document.getElementById(HOST_ID)?.remove();
    if (hideTimer !== undefined) clearTimeout(hideTimer);
  }

  function showBanner(msg: LimitMessage): void {
    const root = mount();
    const wrap = document.createElement("div");
    wrap.className = "wrap banner";
    const text = document.createElement("p");
    text.className = "text";
    const left = Math.max(msg.limitMs - msg.usedMs, 0);
    text.append("Close to your limit on this site: ");
    const b = document.createElement("b");
    b.textContent = fmt(left);
    text.append(b, " left of your ", `${Math.round(msg.limitMs / 60_000)} min for today.`);
    const close = document.createElement("button");
    close.textContent = "\u00D7"; // multiplication-sign close glyph, escaped so the built file stays ASCII
    close.title = "Dismiss";
    close.addEventListener("click", dismiss);
    wrap.append(text, close);
    root.appendChild(wrap);
    hideTimer = window.setTimeout(dismiss, BANNER_MS);
  }

  function showOverlay(msg: LimitMessage): void {
    const root = mount();
    const wrap = document.createElement("div");
    wrap.className = "wrap overlay";
    const card = document.createElement("div");
    card.className = "card";
    const stamp = document.createElement("span");
    stamp.className = "stamp";
    stamp.textContent = "Time's up";
    const title = document.createElement("p");
    title.className = "title";
    title.textContent = msg.domain;
    const text = document.createElement("p");
    text.className = "text muted";
    text.textContent = `You've used your ${Math.round(msg.limitMs / 60_000)} min for today.`;
    const close = document.createElement("button");
    close.textContent = "Dismiss";
    close.addEventListener("click", dismiss);
    card.append(stamp, title, text, close);
    wrap.appendChild(card);
    root.appendChild(wrap);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) dismiss();
    });
  }

  // Countdown to the next threshold. Alarms in the background are clamped
  // to 30s steps; a page timer is exact while the tab is visible, so the
  // background delegates the precise moment to us and we ping it back.
  let etaTimer: number | undefined;

  function armEta(msToGo: number): void {
    if (etaTimer !== undefined) clearTimeout(etaTimer);
    etaTimer = window.setTimeout(() => {
      etaTimer = undefined;
      try {
        void chrome.runtime.sendMessage({ type: "logbook-check" }).catch(() => {});
      } catch {
        // Extension reloaded out from under us; the next injection takes over.
      }
    }, msToGo + 250);
  }

  chrome.runtime.onMessage.addListener((msg: LimitMessage | EtaMessage) => {
    if (!msg) return;
    if (msg.type === "logbook-limit-eta") {
      armEta(msg.msToGo);
    } else if (msg.type === "logbook-limit") {
      if (msg.kind === "limit") showOverlay(msg);
      else showBanner(msg);
    }
  });
})();
