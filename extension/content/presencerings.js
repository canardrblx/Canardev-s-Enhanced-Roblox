// Global presence rings. Roblox marks a user's status with a `.avatar-status`
// node holding an `.online` / `.game` / `.studio` icon span. Everywhere an
// avatar shows a status (home friends, profile friends, group members, search,
// the chat list…) we hide that little icon and ring the whole avatar instead —
// green = in game, blue = online, yellow = in Studio. Re-scans on re-render.

(async function () {
  if (typeof CER === "undefined") return;
  const settings = await CER.get();
  if (settings.features.presenceRings === false) return;

  const RING = { game: "cer-ring-game", online: "cer-ring-online", studio: "cer-ring-studio", offline: "cer-ring-offline" };
  const ALL = ["cer-ring-online", "cer-ring-game", "cer-ring-studio", "cer-ring-offline"];

  // an .avatar-status node exists on every user avatar; the icon inside tells
  // the state. No online/game/studio icon => offline (grey ring).
  function stateOf(status) {
    const span = status.querySelector("span, [class*='icon-']") || status;
    const c = span.className || "";
    if (/\bgame\b|icon-game/.test(c)) return "game";
    if (/\bonline\b|icon-online/.test(c)) return "online";
    if (/\bstudio\b|icon-studio/.test(c)) return "studio";
    return "offline";
  }

  // per-node cache: the status icon's class + whether the ring is still on,
  // so a re-scan skips nodes that didn't change (no getComputedStyle again)
  const seen = new WeakMap();
  const CER_OWNED = "#cer-app, .cer-ui, #cer-panel-overlay";

  function apply(status) {
    const sig = (status.querySelector("span, [class*='icon-']") || status).className + "";
    const prev = seen.get(status);
    if (prev && prev.sig === sig && (prev.framed || prev.target.classList.contains(prev.ring))) return;
    const state = stateOf(status);
    const avatar = status.closest(".avatar, [class*='avatar-card'], .friends-carousel-tile") || status.parentElement;
    if (!avatar) return;
    // ring the circular thumbnail container (so the ring follows its shape),
    // falling back to the raw image
    const target = avatar.querySelector(".avatar-card-image, .thumbnail-2d-container, img") || avatar;
    // Roblox Plus profile frames (2026) paint the frame as a radial-gradient
    // background on this box and square it off (loading placeholders are round), so a ring there comes out as a square
    // around the frame. Leave framed avatars alone with Roblox's own dot.
    const tcs = getComputedStyle(target);
    if (tcs.borderRadius === "0px" && tcs.backgroundImage.includes("gradient")) {
      for (const cls of ALL) target.classList.remove(cls);
      status.classList.remove("cer-status-hidden");
      seen.set(status, { sig, framed: true, target });
      return;
    }
    seen.set(status, { sig, framed: false, target, ring: RING[state] });
    if (target.classList.contains(RING[state]) && status.classList.contains("cer-status-hidden")) return;
    for (const cls of ALL) target.classList.remove(cls);
    target.classList.add(RING[state]);
    status.classList.add("cer-status-hidden");
  }

  // swap the friend hover-card's dated sprite icons for crisp modern SVGs
  function modernizeHoverIcons() {
    for (const btn of document.querySelectorAll(".friend-tile-dropdown-button:not([data-cer-icon])")) {
      if (btn.dataset.cerIcon) continue;
      btn.dataset.cerIcon = "1";
      const old = btn.querySelector("[class*='icon-'], img, svg");
      const t = btn.textContent.trim().toLowerCase();
      const svg = CER.svg(/chat|message/.test(t) ? "chat" : "person", 18);
      svg.classList.add("cer-hovercard-icon");
      if (old) old.replaceWith(svg);
      else btn.insertBefore(svg, btn.firstChild);
    }
  }

  // at most one scan per 250 ms, however busy the page is
  let timer = null;
  function scan() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      requestAnimationFrame(() => {
        for (const s of document.querySelectorAll(".avatar-status")) if (!s.closest(CER_OWNED)) apply(s);
        modernizeHoverIcons();
      });
    }, 250);
  }
  // changes inside CER's own UI (sidebar, chat, settings, CER pages) never
  // need a re-scan
  function onMutate(records) {
    for (const r of records) {
      const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!t || t.closest(CER_OWNED)) continue;
      const nodes = [...r.addedNodes, ...r.removedNodes];
      if (nodes.length && nodes.every((n) => n.nodeType === 1 && n.matches(CER_OWNED))) continue; // CER panel added/removed
      return scan();
    }
  }
  // CER-owned pages (html.cer-takeover) draw their own rings from presence
  // data, so there is nothing to scan there: no page-wide observer at all.
  // The observer only runs while Roblox's own page is showing, and starts or
  // stops when the takeover class flips (release, SPA navigation).
  const html = document.documentElement;
  let mo = null;
  function sync() {
    if (html.classList.contains("cer-takeover")) {
      mo?.disconnect();
      mo = null;
      return;
    }
    if (!mo) {
      mo = new MutationObserver(onMutate);
      mo.observe(html, { childList: true, subtree: true });
    }
    scan();
  }
  sync();
  let owned = html.classList.contains("cer-takeover");
  new MutationObserver(() => {
    const now = html.classList.contains("cer-takeover");
    if (now !== owned) {
      owned = now;
      sync();
    }
  }).observe(html, { attributes: true, attributeFilter: ["class"] });
  CER.onNavigate?.(sync);
})();
