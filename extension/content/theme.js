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

  // ---- document_start: decide what never paints ----
  // Classes on <html> gate CSS in styles.css, so Roblox's nav/top bar and the
  // native parts we replace are hidden BEFORE the first paint (no JS race).
  try {
    const sQuick = await CER.ext.storage.local.get("features");
    const feats = sQuick.features ?? {};
    const root = document.documentElement;
    if (feats.customSidebar !== false) {
      root.classList.add("cer-cnav");
      // failsafe: if our sidebar never mounts (script error, logged out),
      // give Roblox's own nav back instead of leaving no nav at all
      setTimeout(() => {
        if (!document.querySelector(".cer-custom-nav")) root.classList.remove("cer-cnav");
      }, 5000);
    }

    // ---- content veil ----
    // Covers ONLY the page column (never the nav) while a redesigned page
    // builds its UI, so the stock version doesn't flash first. It lifts the
    // moment the redesign's root element exists. Pages with no full redesign
    // get no veil at all — they render natively and our tweaks land on top.
    // Old version: full-screen, waited for the sidebar + a 300 ms settle, and
    // only gave up after 16 s, which is why pages felt so slow.
    const p = location.pathname;
    // the redesign reports CER.skelDone(tag) once its UI is usable
    const pageTag = /\/users\/\d+\/profile/.test(p) && feats.profileRedesign !== false
      ? "profile"
      : p.startsWith("/users/friends") && feats.friendsPage !== false
      ? "friends"
      : p.startsWith("/my/avatar") && feats.avatarEditor !== false
      ? "avatar"
      : p.startsWith("/charts") && feats.gamesRedesign !== false
      ? "games"
      : p.startsWith("/home") && feats.wideTiles !== false
      ? "continue"
      : null;
    if (pageTag && feats.loadingSkeleton !== false) {
      const block = (h, w) => `<div class="cer-skel-block" style="height:${h}px;max-width:${w}px"></div>`;
      const row = (n, h, w) => `<div class="cer-skel-row">${Array.from({ length: n }, () => `<div class="cer-skel-tile" style="height:${h}px;width:${w}px"></div>`).join("")}</div>`;
      let mainHtml;
      if (p.startsWith("/home")) {
        mainHtml = block(140, 1000) + block(22, 180) + row(8, 90, 90) + block(22, 140) + row(6, 150, 220);
      } else if (/\/users\/\d+\/profile/.test(p)) {
        mainHtml = block(200, 1100) + `<div class="cer-skel-row">${Array.from({ length: 6 }, () => `<div class="cer-skel-tile" style="height:34px;width:90px;border-radius:999px"></div>`).join("")}</div>` + row(5, 120, 120);
      } else if (p.startsWith("/charts")) {
        mainHtml = block(22, 150) + row(6, 150, 220) + block(22, 200) + row(6, 150, 220);
      } else if (p.startsWith("/my/avatar")) {
        mainHtml = `<div class="cer-skel-row"><div class="cer-skel-tile" style="height:420px;width:360px"></div><div style="flex:1;display:flex;flex-direction:column;gap:16px">${block(40, 600)}${row(8, 110, 110)}</div></div>`;
      } else {
        mainHtml = block(60, 900) + row(8, 150, 150);
      }
      const sk = document.createElement("div");
      sk.id = "cer-skeleton";
      sk.innerHTML = `<div class="cer-skel-main">${mainHtml}</div>`;
      root.appendChild(sk);

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        sk.classList.add("cer-skeleton-fade");
        setTimeout(() => sk.remove(), 220);
      };
      CER.dismissSkeleton = finish;
      CER.skelDone = (tag) => {
        if (tag === pageTag) requestAnimationFrame(finish);
      };
      // never hold the page hostage: a redesign that hasn't reported after
      // 3.5 s shows whatever is there
      setTimeout(finish, 3500);
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

  let bodyWant = null; // { dark, stripAppTheme } or null = hands off
  let bodyWatch = null;
  const APP_THEME = /^theme-(?!roblox$)/; // theme-roblox is the base, keep it
  const strippedAppThemes = new Set(); // put back when the user returns to Default
  function enforceBody() {
    const b = document.body;
    if (!b) return;
    if (!bodyWant) {
      for (const c of strippedAppThemes) b.classList.add(c);
      strippedAppThemes.clear();
      return;
    }
    const want = bodyWant;
    // only touch what's wrong, so our own writes don't re-trigger forever
    const fix = (cls, on) => b.classList.contains(cls) !== on && b.classList.toggle(cls, on);
    fix("dark-theme", want.dark);
    fix("light-theme", !want.dark);
    fix("color-mode-dark", want.dark);
    fix("color-mode-light", !want.dark);
    if (want.stripAppTheme)
      for (const c of [...b.classList])
        if (APP_THEME.test(c)) {
          strippedAppThemes.add(c);
          b.classList.remove(c);
        }
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
    else {
      // Default: match whatever Roblox (or its app theme) is painting. The
      // veil sits outside <body>, so it can't inherit body's tokens itself.
      const own = document.body && getComputedStyle(document.body).getPropertyValue("--color-surface-0").trim();
      skelBg = own || (document.body?.classList.contains("light-theme") ? "#f2f4f5" : "#0f1116");
    }
    rules.push(`:root { --cer-skel-bg: ${skelBg}; }`);

    // Body classes decide Roblox's own colours: dark-theme / light-theme pick
    // the mode, and (since mid 2026) a theme-<name> class adds a Roblox Plus
    // app theme (e.g. theme-halloween-2026) that rewrites ~140 colour tokens.
    //  - Default: leave all of it alone (the user's app theme shows).
    //  - Roblox Light / Dark: plain Roblox, so the app theme class comes off.
    //  - Tints: ride on native dark/light with the app theme off, or its
    //    colours leak into every token we don't set ourselves.
    // Roblox re-renders its CACHED mode after a reload and can re-add classes
    // on re-render, so a class-only observer on <body> keeps ours in place.
    // (Verified live 2026-11-03.)
    if (tint) bodyWant = { dark: !!tint.dark, stripAppTheme: true };
    else if (preset && preset.native) bodyWant = { dark: preset.native === "Dark", stripAppTheme: true };
    else bodyWant = null;
    // the app theme's full-screen art layer (#theme-background) goes too
    document.documentElement.classList.toggle("cer-own-theme", !!bodyWant);
    enforceBody();
    if (document.body && !bodyWatch) {
      bodyWatch = new MutationObserver(enforceBody);
      bodyWatch.observe(document.body, { attributes: true, attributeFilter: ["class"] });
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

    // unchanged rules = no write (a write restyles the whole page)
    const css = rules.join("\n");
    if (style.textContent !== css) style.textContent = css;
  }

  // debounce: any storage change fires this, but apply() rebuilds ~50 CSS rules,
  // so batch rapid changes (e.g. several feature toggles) into one re-theme
  CER.onSettingsChanged((changes) => {
    // only what the theme actually reads — a sidebar/section pref write
    // shouldn't rebuild every CSS rule
    if (changes.theme || changes.features) apply();
  }, 120);
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
