// Custom theme engine, two layers:
//  1. DESIGN TOKENS — Roblox's new UI reads CSS vars (--color-surface-*,
//     --color-content-*, --color-action-*, ...). `* { --var: x !important }`
//     out-cascades every theme scope (verified live), so the avatar page,
//     sidebar selected pill, event buttons etc. all follow automatically.
//  2. LEGACY CLASSES — the older bootstrap-era parts of the site
//     (.rbx-header, .btn-primary-md, game cards, server rows) get direct rules.
// Native presets are handled at click time (settings.js flips Roblox's own
// light/dark setting); dark tints also ride on native dark.

(async function () {
  if (typeof CER === "undefined") return;

  // ---- loading skeleton (runs at document_start, before Roblox paints) ----
  // Hides the old UI so redesigned pages don't flash the stock look for a
  // second. customsidebar.js fades it out once our nav is mounted; a hard
  // timeout removes it no matter what so a broken script can't trap the page.
  try {
    const sQuick = await CER.ext.storage.local.get("features");
    const feats = sQuick.features ?? {};
    if (feats.customSidebar !== false && feats.loadingSkeleton !== false) {
      const p = location.pathname;
      // page-specific skeleton shapes so it resembles what's loading, not a
      // generic grey box everywhere
      let mainHtml;
      const block = (h, w) => `<div class="cer-skel-block" style="height:${h}px;max-width:${w}px"></div>`;
      const row = (n, h, w) => `<div class="cer-skel-row">${Array.from({ length: n }, () => `<div class="cer-skel-tile" style="height:${h}px;width:${w}px"></div>`).join("")}</div>`;
      if (p.startsWith("/home")) {
        mainHtml = block(140, 1000) + `<div class="cer-skel-block" style="height:22px;width:180px;margin-top:26px"></div>` + row(8, 90, 90) + `<div class="cer-skel-block" style="height:22px;width:140px;margin-top:26px"></div>` + row(6, 150, 220);
      } else if (/\/users\/\d+\/profile/.test(p)) {
        mainHtml = block(200, 1100) + `<div class="cer-skel-row" style="margin-top:20px">${Array.from({ length: 6 }, () => `<div class="cer-skel-tile" style="height:34px;width:90px;border-radius:999px"></div>`).join("")}</div>` + row(5, 120, 120);
      } else if (p.startsWith("/charts")) {
        mainHtml = `<div class="cer-skel-block" style="height:22px;width:150px"></div>` + row(6, 150, 220) + `<div class="cer-skel-block" style="height:22px;width:200px;margin-top:26px"></div>` + row(6, 150, 220);
      } else {
        mainHtml = block(120, 900) + block(200, 1100) + block(200, 1100);
      }
      const sk = document.createElement("div");
      sk.id = "cer-skeleton";
      sk.innerHTML = `<div class="cer-skel-nav"></div><div class="cer-skel-main">${mainHtml}</div>`;
      document.documentElement.appendChild(sk);

      CER.dismissSkeleton = () => {
        const el = document.getElementById("cer-skeleton");
        if (!el) return;
        el.classList.add("cer-skeleton-fade");
        setTimeout(() => el.remove(), 300);
      };

      // The veil only lifts when TWO things are true: the custom sidebar has
      // mounted (it reports via skelDone) AND the page's own redesigned root
      // element is actually in the DOM. Gating on the real element — not just a
      // timer — is what stops the old native page (old Games list, old Continue
      // row) from ever flashing: if a redesign is slow or fails to build, the
      // veil simply stays until the new UI is present. Enhance-only pages with
      // no full root just wait on the sidebar + a settle beat.
      // on home, also hold the veil until our Continue row is in place, so the
      // native Continue never flashes in before we swap it out
      CER._skelPending = new Set(p.startsWith("/home") ? ["sidebar", "continue"] : ["sidebar"]);
      CER._skelRoot = p.startsWith("/charts")
        ? ".cer-games"
        : /\/users\/\d+\/profile/.test(p)
        ? ".cer-profile-pills"
        : /^\/(communities|groups)\//.test(p)
        ? ".cer-group-tabs"
        : p.startsWith("/users/friends")
        ? ".cer-page"
        : p.startsWith("/my/avatar")
        ? ".cer-avatar-inline"
        : p.startsWith("/catalog")
        ? "[class*='item-card'], .catalog-item-container, [class*='ItemCard']"
        : p.startsWith("/charts")
        ? ".cer-games"
        : p.startsWith("/home")
        ? ".friends-carousel-container"
        : null;

      let dismissed = false;
      let settleTimer = null;
      const rootReady = () => !CER._skelRoot || !!document.querySelector(CER._skelRoot);
      const finish = () => {
        if (dismissed) return;
        dismissed = true;
        clearTimeout(settleTimer);
        clearInterval(pollTimer);
        CER.dismissSkeleton();
      };
      // schedule the fade exactly once, and only when the new UI is verifiably
      // there. Poll (not just skelDone) because most redesigns build their root
      // without reporting; the poll notices the element the moment it appears.
      const maybeFinish = () => {
        if (dismissed || settleTimer) return;
        if (CER._skelPending && CER._skelPending.size > 0) return; // sidebar not up
        if (!rootReady()) return; // new UI not mounted yet — hold the veil
        settleTimer = setTimeout(finish, 300); // let it paint, then lift
      };
      CER.skelDone = (tag) => {
        CER._skelPending?.delete(tag);
        maybeFinish();
      };
      const pollTimer = setInterval(maybeFinish, 250);
      // soft failsafe: after 9s stop waiting on the sidebar report, but STILL
      // require the page root if there is one
      setTimeout(() => {
        CER._skelPending?.clear();
        maybeFinish();
      }, 9000);
      // hard failsafe: never trap the page, even if a redesign is truly broken
      setTimeout(finish, 16000);
    }
  } catch {
    /* never block the page over a skeleton */
  }

  function tokenBlock(t) {
    const dark = !!t.dark;
    const flat = t.flat ?? t.bg;
    const content = dark
      ? { emphasis: "#f7f7f8", def: "#d5d7dd", muted: "#9fa2ad" }
      : { emphasis: "#202227", def: "#3a3c44", muted: "#6a6f81" };
    const alpha = dark ? "255,255,255" : "0,0,0";
    return `* {
  --color-surface-0: ${flat} !important;
  --color-surface-100: ${t.header} !important;
  --color-surface-200: ${t.card} !important;
  --color-surface-300: ${t.card} !important;
  --color-content-emphasis: ${content.emphasis} !important;
  --color-content-default: ${content.def} !important;
  --color-content-muted: ${content.muted} !important;
  --color-content-link: ${t.accent} !important;
  --color-system-emphasis: ${t.accent} !important;
  --color-action-emphasis-background: ${t.accent} !important;
  --color-shift-100: rgba(${alpha},0.05) !important;
  --color-shift-200: rgba(${alpha},0.09) !important;
  --color-shift-300: rgba(${alpha},0.13) !important;
  --color-shift-400: rgba(${alpha},0.17) !important;
  --color-stroke-default: rgba(${alpha},0.14) !important;
  --color-stroke-muted: rgba(${alpha},0.09) !important;
  --color-stroke-emphasis: rgba(${alpha},0.22) !important;
}`;
  }

  async function apply() {
    const settings = await CER.get();
    let style = document.getElementById("cer-theme");

    if (!settings.features.theme) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = "cer-theme";
      document.documentElement.appendChild(style);
    }

    const rules = [];
    const preset = CER.THEMES.find((t) => t.id === settings.theme.preset);
    const tint = preset && !preset.native && preset.id !== "" ? preset : null;

    // ONE accent for everything (pills, badges, buttons, ratio bar). On tints
    // it's the tint accent; on native themes it tracks Roblox's own action
    // colour instead of each component falling back to its own hard-coded blue.
    rules.push(`:root { --cer-accent: ${tint ? tint.accent : "var(--color-action-emphasis-background, #335fff)"}; }`);

    // skeleton veil background — match the theme even on native light (where we
    // don't tint, so --color-surface-0 isn't set and it would fall back to dark)
    let skelBg;
    if (tint) skelBg = tint.flat ?? tint.bg;
    else if (preset && preset.native === "Light") skelBg = "#f2f4f5";
    else if (preset && preset.native === "Dark") skelBg = "#0f1116";
    else skelBg = document.body && document.body.classList.contains("light-theme") ? "#f2f4f5" : "#0f1116";
    rules.push(`:root { --cer-skel-bg: ${skelBg}; }`);

    // dark tints ride on native dark — re-assert the body class every load in
    // case the server-side flip didn't stick
    if (tint) {
      document.body?.classList.toggle("dark-theme", !!tint.dark);
      document.body?.classList.toggle("light-theme", !tint.dark);
    }

    // feature-driven chrome rules (independent of the color preset)
    if (settings.features.hideFooter) {
      rules.push(`.container-footer { display: none !important; }`);
    }
    // alert/notification bars used to hide behind the top bar — without it
    // they read as floating colored blocks (gray loading, red warning, the
    // green success banner). Hide the shells; nothing we add ever needs them.
    rules.push(
      `.alert.alert-loading, .alert-system-feedback, .sg-system-feedback, #system-feedback, [class*="system-feedback"], .roblox-notification, .notification-container:empty, body.cer-no-topbar .alert { display: none !important; }`
    );

    // theme-matched scrollbars (global, not just for tints)
    rules.push(
      `* { scrollbar-width: thin; scrollbar-color: var(--color-shift-400, rgba(128,128,128,0.4)) transparent; }`
    );
    rules.push(`::-webkit-scrollbar { width: 10px; height: 10px; }`);
    rules.push(`::-webkit-scrollbar-thumb { background: var(--color-shift-400, rgba(128,128,128,0.4)); border-radius: 6px; }`);
    rules.push(`::-webkit-scrollbar-track { background: transparent; }`);

    // BANNER FADE, universally: dissolve the image to TRANSPARENT with a
    // mask so whatever page background sits behind (solid, gradient, starfield)
    // shows through — no color to mismatch. Kills the color/blur overlays.
    rules.push(
      `.cover-gradient-overlay, .cover-blur-overlay { display: none !important; }`
    );
    rules.push(
      `.profile-avatar-gradient, [class*="game-page-thumb"], .cer-gp-banner, [class*="community-banner"], [class*="group-banner"], .group-cover-photo-fullwidth, [class*="cover-photo"] { -webkit-mask-image: linear-gradient(180deg, #000 58%, transparent 100%) !important; mask-image: linear-gradient(180deg, #000 58%, transparent 100%) !important; }`
    );
    if (settings.features.hideChat || settings.features.customChat) {
      rules.push(`#chat-container { display: none !important; }`);
    } else if (settings.features.chatRestyle) {
      // light-touch chat reskin: rounder, cleaner, token-colored
      rules.push(`#chat-container .chat-main { border-radius: 12px 12px 0 0; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.25); border: none; }`);
      rules.push(`#chat-container .chat-header { background: var(--color-surface-100) !important; border: none; padding: 10px 14px; }`);
      rules.push(`#chat-container .chat-search input { border-radius: 999px; }`);
      rules.push(`#chat-container .chat-main, #chat-container .chat-body { background: var(--color-surface-200) !important; color: var(--color-content-emphasis); }`);
    }

    if (settings.theme.font) {
      rules.push(
        `body, body *:not(i):not([class^="icon-"]):not([class*=" icon-"]) { font-family: "${settings.theme.font}", "Builder Sans", sans-serif !important; }`
      );
    }

    // hover: stroke ring + smooth grow, for BOTH tile types (icon tiles had
    // neither; thumbnail tiles jittered because outline shifted layout —
    // box-shadow doesn't)
    const stroke = tint?.dark ? "rgba(255,255,255,0.4)" : "rgba(110,110,110,0.45)";
    rules.push(
      `.game-card-container, .wide-game-tile, .featured-game-container { transition: transform 0.15s ease, box-shadow 0.15s ease; }`
    );
    rules.push(
      `.game-card-container:hover, .wide-game-tile:hover, .featured-game-container:hover { transform: scale(1.03); box-shadow: 0 0 0 2px ${stroke}; border-radius: 10px; }`
    );

    if (tint) {
      rules.push(tokenBlock(tint));
      if (tint.extra) {
        rules.push(tint.extra); // animated overlays (rain/snow/aurora/ember)
        // Keep page content above the fixed z-index:0 weather layer. ONLY the
        // scrolling content area — NEVER .left-nav (it's position:fixed;
        // forcing it relative drops it into flow and shoves the whole page
        // down, which is the "UI appears below where it should" bug).
        rules.push(`#content, .content, main { position: relative; z-index: 1; }`);
      }

      // longhand attachment so EVERY layer of multi-layer backgrounds
      // (starfields etc.) stays fixed while scrolling
      rules.push(`body { background: ${tint.bg} !important; background-attachment: fixed !important; }`);

      // profile/group hero fade (.cover-gradient-overlay masks a gradient
      // that ends in black by default) — fade into the theme instead
      const flat = tint.flat ?? tint.bg;
      rules.push(`.cover-gradient-overlay { background-image: linear-gradient(180deg, transparent 0%, ${flat} 100%) !important; }`);
      rules.push(`.profile-avatar-gradient, .profile-avatar-left { background-color: transparent !important; }`);
      rules.push(`.rbx-header, #header { background: ${tint.header} !important; border-color: transparent !important; }`);
      rules.push(`.left-nav { background: ${tint.header} !important; }`);
      rules.push(`.container-footer { background: ${tint.header} !important; border-color: transparent !important; }`);

      rules.push(
        `.game-card-container, .wide-game-tile, .featured-game-container, .section-content, .rbx-game-server-item, .stack-list > .stack-row { background-color: ${tint.card} !important; border-radius: 10px; }`
      );
      rules.push(`.rbx-tabs-horizontal { background: transparent !important; }`);
      rules.push(`input.form-control, .input-field, select, textarea { background-color: ${tint.card} !important; }`);

      // legacy buttons: primary, growth (all sizes — "Join Event" is
      // btn-growth-xs), play buttons
      rules.push(
        `[class*="btn-primary-"], [class*="btn-growth-"], .btn-common-play-game-lg, .play-button { background-color: ${tint.accent} !important; border-color: ${tint.accent} !important; color: #fff !important; }`
      );
      rules.push(
        `#game-instances .foundation-web-button, .rbx-game-server-item .foundation-web-button, .rbx-private-server-item .foundation-web-button { background: ${tint.accent} !important; color: #fff !important; }`
      );

      // legacy chat window (new-UI parts follow the tokens)
      rules.push(
        `#chat-container .chat-main, #chat-container .chat-header, .chat-container .chat-landing-page { background-color: ${tint.card} !important; }`
      );

      // our own components always follow the tokens
      rules.push(
        `.cer-section, .cer-profile, .cer-recs-notice, .cer-panel, .cer-avatar-panel, .cer-avatar-inline { color: var(--color-content-emphasis) !important; }`
      );
      // tile names need side padding now that tiles have a card background
      rules.push(`.game-card-name, .wide-game-tile .info-container { padding-left: 8px; padding-right: 8px; }`);

      if (tint.dark) {
        // universal legacy-text sweep: anything still using the old text/font
        // classes goes white-ish (new UI is handled by the tokens)
        rules.push(
          `:is(h1, h2, h3, h4, .text-header, [class*="font-header"], [class*="font-caption"], .text-title-large, .game-card-name, .nav-menu-title, .text-name, [class*="textIconRowText"]) { color: #ffffff !important; }`
        );
        rules.push(
          `:is(p, .text-body, [class*="font-body"], .text-label, .text-lead, .text-info, .text-overflow) { color: #d5d8dd; }`
        );
        // header icons: Roblox serves white sprites once the native theme is
        // Dark (which dark tints set) — never force-filter them, that
        // double-inverts. Search suggestions are legacy and need help though:
        rules.push(
          `.navbar-search .dropdown-menu { background: ${tint.card} !important; } .navbar-search .dropdown-menu * { color: #f0f0f2 !important; }`
        );
        // legacy dropdowns everywhere (group ⋯ menu etc.) + pill/chip buttons
        // (forum category chips included)
        rules.push(`ul.dropdown-menu { background: ${tint.card} !important; } ul.dropdown-menu a { color: #f0f0f2 !important; }`);
        rules.push(
          `:is([class*="pill"], [class*="chip"], [class*="Chip"], [class*="category"], [class*="Category"], [class*="channel"], [class*="Channel"], [class*="forum"] button, [class*="Forum"] button, [class*="forum"] a[class]):not([class*="cer-"]) { background-color: ${tint.card} !important; color: #f0f0f2 !important; border-color: transparent !important; }`
        );
        // banner fades (group + profile heroes) fade to black by default —
        // fade into the theme background instead
        rules.push(
          `[class*="banner"] [class*="gradient"], [class*="header"] [class*="gradient"], [class*="carousel-gradient"] { background-image: linear-gradient(180deg, transparent 40%, ${tint.flat ?? tint.bg} 100%) !important; }`
        );
        // selected group in the groups list
        rules.push(`.groups-list-item.active { background: ${tint.card} !important; border-radius: 10px; }`);
        // selected forum category pill → accent. THREE classes (0,3,0) so it
        // out-ranks my own chip rule '[class*="forum"] a[class]' (0,2,1) which
        // was painting the active pill the card colour — the real 20x bug.
        rules.push(
          `.group-forums-category-pill.active.clickable { background-color: ${tint.accent} !important; color: #fff !important; }`
        );
      }
    }

    style.textContent = rules.join("\n");
  }

  // debounce: any storage change fires this, but apply() rebuilds ~50 CSS rules,
  // so batch rapid changes (e.g. several feature toggles) into one re-theme
  let applyT = null;
  CER.ext.storage.onChanged.addListener(() => {
    clearTimeout(applyT);
    applyT = setTimeout(apply, 120);
  });
  // runs at document_start now (kills the default-theme flash); body-class
  // toggles need the body, so re-apply once the DOM exists
  document.addEventListener("DOMContentLoaded", () => apply());

  // veil the home feed until sections.js has applied the hide-prefs, so
  // default-hidden sections don't flash (opacity keeps layout stable)
  if (location.pathname.startsWith("/home")) {
    document.documentElement.classList.add("cer-sections-pending");
    setTimeout(() => document.documentElement.classList.remove("cer-sections-pending"), 6000);
  }

  await apply();
})();
