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

  function apply(status) {
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
      return;
    }
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

  let raf = null;
  function scan() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      for (const s of document.querySelectorAll(".avatar-status")) apply(s);
      modernizeHoverIcons();
    });
  }
  scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  CER.onNavigate?.(scan);
})();
