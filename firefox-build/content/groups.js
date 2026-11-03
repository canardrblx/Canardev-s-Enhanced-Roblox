// Group/profile page tweaks + the charts filter row.
// - SAFETY: leave-group / transfer-owner controls are HIDDEN on every page
//   (CSS shield + a rAF-batched observer that sees menus before they paint)
// - banner "un-blacker": class-agnostic repaint of black banner fades
// - group games: rebuilt from the API as a wide row (native tiles suppressed
//   every sweep — React keeps re-inserting them)
// - pill tabs (About / Games / Forums / Events...): About = description +
//   announcements only; Games = the row alone; section headings like
//   "Games"/"Events" are dropped since the tabs already say it

(async function () {
  if (typeof CER === "undefined") return;
  let settings = await CER.get();

  // A group VIEW page (/communities/123/Name). Configure / create pages share
  // the /communities/ prefix but must never get the tab redesign.
  const groupIdFromPath = () => location.pathname.match(/^\/(?:communities|groups)\/(\d+)(?:\/|$)/)?.[1] ?? null;
  const onGroups = () =>
    !!groupIdFromPath() && !/^\/(?:communities|groups)\/\d+\/(?:configure|create)(?:\/|$)/i.test(location.pathname);
  const onProfile = () => /^\/users\/\d+\/profile/.test(location.pathname);
  const themed = () => {
    const preset = CER.THEMES.find((t) => t.id === settings.theme.preset);
    return preset && !preset.native && preset.id !== "" && settings.features.theme ? preset : null;
  };

  // ---- SAFETY: hide (never touch) leave-group / transfer-ownership ----
  // Pure display:none — this code never clicks, submits, or interacts with
  // anything. Runs on EVERY page: the transfer/change-owner control also lives
  // in group Configure, and the ⋯ menus only render when opened.

  const DANGER =
    /^\s*(leave (group|community)|delete (group|community)|(change|make) (group |community )?owner(ship)?|transfer (group |community )?owner(ship)?)\s*$/i;
  const DANGER_HINT = /leave|delete|owner/i;
  // the thing that actually does the action
  const CLICKABLE = "button, a, [role='menuitem'], [role='button'], [role='option'], .dropdown-item, .menu-item, li";

  // Stable attribute hooks, hidden by CSS before any JS runs on a new menu.
  // Harmless when nothing matches. (:has() rules kept separate so an old
  // browser that rejects :has doesn't drop the whole list.)
  const SHIELD_CSS =
    "[ng-click*='leaveGroup' i], [ng-click*='leaveCommunity' i], [ng-click*='deleteGroup' i]," +
    " [ng-click*='changeOwner' i], [ng-click*='transferOwnership' i]," +
    " [data-testid*='leave-group' i], [data-testid*='leave-community' i]," +
    " [aria-label='Leave Community' i], [aria-label='Leave Group' i] { display: none !important; }\n" +
    "li:has(> [ng-click*='leaveGroup' i]), li:has(> [ng-click*='leaveCommunity' i])," +
    " li:has(> [data-testid*='leave-group' i]), li:has(> [data-testid*='leave-community' i]) { display: none !important; }";

  function applyShield() {
    let style = document.getElementById("cer-protect-style");
    if (settings.features.protectGroups && !style) {
      style = document.createElement("style");
      style.id = "cer-protect-style";
      style.textContent = SHIELD_CSS;
      document.documentElement.appendChild(style);
    } else if (!settings.features.protectGroups && style) {
      style.remove();
    }
  }

  // hide the clickable row, not just the label: an empty <button> left behind
  // would still do the action
  function hideDanger(el) {
    const label = el.textContent.trim();
    let target = el.closest(CLICKABLE) ?? el;
    // climb through wrappers that hold nothing but this label (the <li>
    // around a <button>, or a React <div onClick> row with no button at all)
    for (let i = 0; i < 6; i++) {
      const p = target.parentElement;
      if (!p || p === document.body || p.textContent.trim() !== label) break;
      target = p;
    }
    target.style.setProperty("display", "none", "important");
    target.dataset.cerProtected = "1";
  }

  function protectIn(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) root = root.parentElement;
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    if (!DANGER_HINT.test(root.textContent)) return; // one cheap check per added subtree
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (DANGER_HINT.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const hits = [];
    let n;
    while ((n = tw.nextNode())) {
      // the label may be split ("Leave " + <b>Community</b>): check 2 levels up
      let el = n.parentElement;
      for (let i = 0; el && i < 3; i++, el = el.parentElement) {
        if (DANGER.test(el.textContent)) {
          hits.push(el);
          break;
        }
      }
    }
    for (const el of hits) if (!el.closest("[data-cer-protected]")) hideDanger(el);
  }

  const protectQueue = new Set();
  let protectQueued = false;
  function flushProtect() {
    protectQueued = false;
    for (const node of protectQueue) if (node.isConnected) protectIn(node);
    protectQueue.clear();
  }
  function queueProtect(node) {
    protectQueue.add(node);
    if (protectQueued) return;
    protectQueued = true;
    // rAF = before the menu paints; background tabs don't run rAF
    if (document.hidden) setTimeout(flushProtect, 100);
    else requestAnimationFrame(flushProtect);
  }

  // ---- charts: remove the device/region filter pills ----

  function chartsStyle() {
    const on = location.pathname.startsWith("/charts");
    let style = document.getElementById("cer-charts-style");
    if (on && !style) {
      style = document.createElement("style");
      style.id = "cer-charts-style";
      style.textContent =
        ".filter-items-container { display: none !important; }" +
        // center the game name + rating/CCU under each chart tile. text-align alone
        // fails when the name sits in a flex row/column — so ALSO make the card
        // link/container a centered flex column and full-width the name block.
        ".game-card-container, .game-card-link, [class*='game-card-container']," +
        " [class*='game-tile-container'] {" +
        "  display: flex !important; flex-direction: column !important;" +
        "  align-items: center !important; text-align: center !important; }" +
        ".game-card-name, .game-name-title, .game-card-info, .base-metadata," +
        " .wide-game-tile-metadata, .info-metadata-container," +
        " [class*='game-card'] [class*='name'], [class*='game-tile'] [class*='name'] {" +
        "  text-align: center !important; justify-content: center !important;" +
        "  width: 100% !important; align-self: stretch !important; }";
      document.documentElement.appendChild(style);
    } else if (!on && style) {
      style.remove();
    }
  }

  // ---- banner un-blacker (groups + profiles), theme tints only ----
  // Geometry + computed style on every div is expensive, so these only run
  // for a few passes after a page load/navigation (bannerUntil), and each
  // element that got a full style check is tagged so it's never read twice.

  let bannerUntil = Date.now() + 8000;
  let bannerPasses = 0;
  const BLACK = /rgba?\(0, 0, 0(?:, *(0\.[3-9]\d*|1))?\)|color\(srgb 0 0 0( \/ [\d.]+)?\)/;

  function unblackBanners(preset) {
    const flat = preset.flat ?? preset.bg;
    const writes = [];
    // read phase (no writes in between, so layout is computed once)
    for (const el of document.querySelectorAll("div, section, span")) {
      if (el.dataset.cerUb) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 250 || rect.height < 30 || rect.height > 700 || rect.top > 700) continue;
      const cs = getComputedStyle(el);
      const w = { el, bg: null, img: null };
      if (BLACK.test(cs.backgroundColor)) w.bg = flat;
      if (cs.backgroundImage.includes("gradient") && BLACK.test(cs.backgroundImage)) {
        w.img = cs.backgroundImage
          .replace(/rgba?\(0, 0, 0(, [\d.]+)?\)/g, flat)
          .replace(/color\(srgb 0 0 0( \/ [\d.]+)?\)/g, flat);
      }
      writes.push(w);
    }
    // write phase
    for (const { el, bg, img } of writes) {
      el.dataset.cerUb = bg || img ? "1" : "0";
      if (bg) el.style.setProperty("background-color", bg, "important");
      if (img) el.style.setProperty("background-image", img, "important");
    }
  }

  // Class-agnostic banner fade: find the banner-sized element that paints an
  // image, mask it to TRANSPARENT at the bottom (page shows through — works on
  // any theme), and kill any color/blur fade overlay sitting over it. This is
  // the "transparency gradient, not color gradient" the user asked for.
  function maskBanners() {
    const found = [];
    const checked = [];
    for (const el of document.querySelectorAll("div, span, img, section")) {
      if (el.dataset.cerMk) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 600 || r.height < 150 || r.top > 500) continue;
      checked.push(el);
      if (el.tagName === "IMG" || getComputedStyle(el).backgroundImage.includes("url(")) found.push(el);
    }
    // hide sibling color/blur fade overlays that would re-darken it
    const overlays = [];
    for (const el of found) {
      for (const sib of el.parentElement?.children ?? []) {
        if (sib === el) continue;
        if (getComputedStyle(sib).backgroundImage.includes("gradient") || /overlay|gradient|fade/i.test(sib.className)) {
          overlays.push(sib);
        }
      }
    }
    for (const el of checked) el.dataset.cerMk = "0";
    for (const el of found) {
      el.style.setProperty("-webkit-mask-image", "linear-gradient(180deg, #000 62%, transparent 100%)", "important");
      el.style.setProperty("mask-image", "linear-gradient(180deg, #000 62%, transparent 100%)", "important");
      el.dataset.cerMk = "1";
    }
    for (const sib of overlays) sib.style.setProperty("display", "none", "important");
  }

  // ---- group games (one fetch per group, shared by the tabs + the row) ----

  let gamesCache = { gid: null, p: null };
  function groupGames(gid) {
    if (gamesCache.gid !== gid) {
      gamesCache = {
        gid,
        p: fetch(`https://games.roblox.com/v2/groups/${gid}/games?accessFilter=2&limit=50&sortOrder=Desc`, {
          credentials: "include",
        })
          .then((r) => r.json())
          .then((d) =>
            (d.data ?? [])
              .map((g) => ({ universeId: String(g.id), placeId: String(g.rootPlace?.id ?? ""), name: g.name ?? "Untitled" }))
              .filter((g) => g.placeId)
          )
          .catch(() => []),
      };
    }
    return gamesCache.p;
  }

  let gamesBuildingFor = null; // in-flight guard: sweeps overlap the awaits
  async function rebuildGroupGames(gid) {
    if (!settings.features.wideTiles || gamesBuildingFor === gid) return;
    if (document.querySelector("[data-cer-groupgames]")) return;

    const heading = [...document.querySelectorAll("h1, h2, h3")].find((e) =>
      /^(games|experiences)$/i.test(e.textContent.trim())
    );
    if (!heading) return;

    gamesBuildingFor = gid;
    try {
      const games = await groupGames(gid);
      const grid = CER.el("div", "cer-grid cer-grid-wide");
      grid.dataset.cerGroupgames = gid;
      grid.style.display = "none"; // hidden until the Games tab is active (no About leak)
      if (games.length === 0) {
        grid.appendChild(CER.el("p", "cer-hint", "This group has no games."));
      } else {
        const universeIds = games.map((g) => g.universeId);
        const [thumbs, meta] = await Promise.all([CER.getGameThumbs(universeIds), CER.getGameMeta(universeIds)]);
        for (const game of games) {
          grid.appendChild(
            CER.buildGameCard(game, {
              wide: true,
              art: thumbs[game.universeId],
              meta: meta[game.universeId],
              features: settings.features,
            })
          );
        }
      }
      // navigated away / React dropped the heading / another build won
      if (groupIdFromPath() !== gid || !heading.isConnected || document.querySelector("[data-cer-groupgames]")) return;

      // header row ("Games" + Page controls) is redundant — the tab says it
      const headerRow = heading.parentElement;
      headerRow.dataset.cerGamesHeader = "1";
      headerRow.insertAdjacentElement("afterend", grid);
      suppressNativeGames();
      applyGroupMode();
    } finally {
      if (gamesBuildingFor === gid) gamesBuildingFor = null;
    }
  }

  // React re-inserts native tiles and the header — keep them down, every sweep
  function suppressNativeGames() {
    const grid = document.querySelector("[data-cer-groupgames]");
    if (!grid) return;
    document.querySelector("[data-cer-games-header]")?.style.setProperty("display", "none");
    for (const child of grid.parentElement.children) {
      if (child === grid || child.dataset.cerGamesHeader) continue;
      if (child.querySelector?.('a[href*="/games/"]') && child.style.display !== "none") {
        child.style.display = "none";
      }
    }
  }

  // ---- empty announcements ----

  const contentRoot = () => document.querySelector("#container-main, .content-main, main") ?? document.body;

  // first text node under `root` matching `re` (a text walk, not a
  // textContent read on every div — that was quadratic)
  function findText(root, re) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    return tw.nextNode();
  }

  function hideEmptyAnnouncements() {
    if (document.querySelector("[data-cer-empty]")) return; // already handled this render
    const t = findText(contentRoot(), /no announcements yet/i);
    if (!t?.parentElement) return;
    let box = t.parentElement.closest(".group-announcements, group-announcements");
    if (!box) {
      box = t.parentElement;
      while (
        box.parentElement &&
        box.parentElement !== document.body &&
        box.parentElement.children.length <= 2 &&
        /^no announcements yet/i.test(box.parentElement.textContent.trim())
      )
        box = box.parentElement;
    }
    box.style.setProperty("display", "none", "important");
    box.dataset.cerEmpty = "1";
    const heading = [...document.querySelectorAll("h1, h2, h3")].find((e) => /^announcements$/i.test(e.textContent.trim()));
    heading?.style.setProperty("display", "none");
  }

  // ---- pill tabs ----

  let groupMode = "About";
  let infoBlock = null;
  let infoHost = null;
  let hiddenStrip = null; // the native tab strip we hid (restored on group→group nav)
  let nativeTabs = {};
  const LABELS = ["About", "Forums", "Events", "Store", "Affiliates", "Enemies"];

  function commonAncestor(a, b) {
    let el = a;
    while (el && !el.contains(b)) el = el.parentElement;
    return el;
  }

  // React can swap the native tab nodes; re-find by label inside the strip
  function nativeTab(label) {
    if (nativeTabs[label]?.isConnected) return nativeTabs[label];
    if (!hiddenStrip?.isConnected) return null;
    for (const el of hiddenStrip.querySelectorAll('[role="tab"], a, button')) {
      if (el.textContent.trim() === label) return (nativeTabs[label] = el);
    }
    return null;
  }

  // SPA group→group navigation can keep the native strip mounted with our bar
  // still in it — drop the old group's bar/grid so the new one gets built
  let lastGid = null;
  function teardownStale(gid) {
    if (gid === lastGid) return;
    lastGid = gid;
    const bar = document.querySelector(".cer-group-tabs");
    if (bar && bar.dataset.cerGroupId !== gid) {
      bar.remove();
      infoBlock?.remove();
      infoBlock = infoHost = null;
      document.querySelector(".cer-forum-skel")?.remove();
      if (hiddenStrip?.isConnected) hiddenStrip.style.display = "";
      hiddenStrip = null;
      nativeTabs = {};
    }
    const grid = document.querySelector("[data-cer-groupgames]");
    if (grid && grid.dataset.cerGroupgames !== gid) grid.remove();
    // React may reuse these nodes for the new group: un-hide our one-off hides
    for (const el of document.querySelectorAll("[data-cer-empty], [data-cer-promo]")) {
      el.style.removeProperty("display");
      delete el.dataset.cerEmpty;
      delete el.dataset.cerPromo;
    }
  }

  function redesignGroupTabs(gid) {
    if (document.querySelector(".cer-group-tabs")) return;

    const native = {};
    for (const el of document.querySelectorAll('[role="tab"], a, button')) {
      const t = el.textContent.trim();
      if (LABELS.includes(t) && !native[t] && el.offsetParent && !el.closest(".cer-group-tabs")) native[t] = el;
    }
    // proceed as long as About + at least one other tab exist (Forums, Events,
    // Store, Affiliates...) — store-only / game-less groups have no Forums
    const other = native.Forums ?? native.Events ?? native.Store ?? native.Affiliates ?? native.Enemies;
    if (!native.About || !other) return; // truly old page variant

    const strip = commonAncestor(native.About, other);
    if (!strip || strip.tagName === "BODY") return;

    // landing straight on e.g. the Forums tab: start in that mode
    const isActive = (el) =>
      el.getAttribute("aria-selected") === "true" ||
      el.classList.contains("active") ||
      el.parentElement?.classList.contains("active");
    groupMode = LABELS.find((l) => native[l] && isActive(native[l])) ?? "About";

    strip.style.display = "none";
    hiddenStrip = strip;
    nativeTabs = native;

    const bar = CER.el("div", "cer-gp-tabs cer-group-tabs");
    bar.dataset.cerGroupId = gid;
    strip.insertAdjacentElement("beforebegin", bar);
    // infoBlock lives right after OUR bar (a spot React never touches), so it
    // can't be wiped by re-renders — we just toggle its display by mode
    infoHost = bar;

    infoBlock = CER.el("div", "cer-group-info");
    infoBlock.appendChild(CER.el("h2", "cer-group-title", "Info"));
    const desc = CER.el("p", "cer-group-desc", ""); // filled when the fetch lands
    infoBlock.appendChild(desc);

    // give the native Announcements section a proper title if it lacks one
    const annH = [...document.querySelectorAll("h1, h2, h3")].find((e) => /^announcements$/i.test(e.textContent.trim()));
    if (annH) annH.classList.add("cer-group-title");

    // header bio ("No bio yet" + more) moves into About
    const moreLink = [...document.querySelectorAll("a, button, span")].find(
      (e) => e.children.length === 0 && /^more$/i.test(e.textContent.trim()) && e.getBoundingClientRect().top < 700
    );
    moreLink?.parentElement?.style.setProperty("display", "none");

    // pills go in right away (About + every native tab); Games is added and an
    // empty Store removed once the lookups below land
    const pills = {};
    let activePill = null;
    const makePill = (label) => {
      const pill = CER.el("button", "cer-tab", label);
      pill.addEventListener("click", () => {
        activePill?.classList.remove("cer-tab-active");
        activePill = pill;
        pill.classList.add("cer-tab-active");
        groupMode = label;
        if (label === "Games" || label === "About") nativeTab("About")?.click();
        else nativeTab(label)?.click();
        if (label === "Forums") showForumSkeleton(bar);
        setTimeout(applyGroupMode, 350);
      });
      if (label === groupMode) {
        activePill = pill;
        pill.classList.add("cer-tab-active");
      }
      pills[label] = pill;
      return pill;
    };
    for (const label of LABELS.filter((l) => l === "About" || native[l])) bar.appendChild(makePill(label));

    const descP = fetch("https://groups.roblox.com/v1/groups/" + gid, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => d.description ?? "")
      .catch(() => ""); // About just shows announcements
    // only offer the Store tab if the group actually sells something (default to
    // showing it if the lookup fails, so a working store never gets hidden)
    const storeP = fetch(`https://catalog.roblox.com/v1/search/items?creatorTargetId=${gid}&creatorType=2&limit=10`, {
      credentials: "include",
    })
      .then(async (r) => {
        const d = await r.json();
        return r.ok && Array.isArray(d.data) ? d.data.length > 0 : true;
      })
      .catch(() => true);

    Promise.all([descP, groupGames(gid), storeP]).then(([description, games, hasStore]) => {
      if (!bar.isConnected) return;
      desc.textContent = description.trim() || "No bio yet.";
      desc.classList.toggle("cer-profile-desc-empty", !description.trim());
      // only offer the Games tab if the group actually has games (and the row is on)
      if (games.length > 0 && settings.features.wideTiles && !pills.Games) {
        pills.About.insertAdjacentElement("afterend", makePill("Games"));
      }
      if (!hasStore && pills.Store && groupMode !== "Store") {
        pills.Store.remove();
        delete pills.Store;
      }
    });
  }

  // forums take a moment to load — show a skeleton right under our tab bar until
  // the first forum post/category renders
  function showForumSkeleton(bar) {
    document.querySelector(".cer-forum-skel")?.remove();
    const skel = CER.el("div", "cer-forum-skel");
    for (let i = 0; i < 5; i++) {
      const row = CER.el("div", "cer-skel-tile");
      row.style.height = "64px";
      row.style.width = "100%";
      row.style.marginBottom = "10px";
      skel.appendChild(row);
    }
    bar.insertAdjacentElement("afterend", skel);
    CER.waitFor(() => document.querySelector("[class*='forum-post'], [class*='forum-thread'], .group-forums-category-pill"), 8000)
      .then(() => setTimeout(() => skel.remove(), 200))
      .catch(() => skel.remove());
  }

  // The native "About" tab dumps games + announcements + top-posts together.
  // We re-slice it: reference-based so load-order races can't leak games in.
  function announcementsSection() {
    const h = [...document.querySelectorAll("h1, h2, h3")].find((e) => /^announcements$/i.test(e.textContent.trim()));
    return h ? h.closest("section, div[class*='section']") ?? h.parentElement : null;
  }

  function applyGroupMode() {
    if (!document.querySelector(".cer-group-tabs")) return;
    const grid = document.querySelector("[data-cer-groupgames]");

    // ALWAYS hide native game containers + games header + top posts + the
    // redundant "Events"/"Games" section headings (our tabs already label them)
    for (const el of document.querySelectorAll(".group-games, [data-cer-games-header], .container-header")) {
      el.style.setProperty("display", "none", "important");
    }
    // native game tiles only live in the About content; on Events/Store/etc a
    // card that links to a game (an event's experience) must stay visible
    if (groupMode === "About" || groupMode === "Games") {
      for (const link of document.querySelectorAll('a[href*="/games/"]')) {
        const tile = link.closest("li, [class*='game-card'], [class*='grid-item']");
        if (tile && !grid?.contains(link) && !tile.closest("[class*='event' i]")) {
          tile.style.setProperty("display", "none", "important");
        }
      }
    }
    const tp = [...document.querySelectorAll("h1, h2, h3")].find((e) => /top (community|group) posts/i.test(e.textContent));
    (tp?.closest("section") ?? tp?.parentElement?.parentElement)?.style.setProperty("display", "none");
    for (const h of document.querySelectorAll("h1, h2, h3")) {
      if (/^(events|games)$/i.test(h.textContent.trim())) h.style.setProperty("display", "none");
    }

    // keep the info block attached to our own bar (React-proof), just toggle it
    if (infoBlock && infoHost && !infoHost.nextElementSibling?.classList?.contains("cer-group-info")) {
      infoHost.insertAdjacentElement("afterend", infoBlock);
    }

    const ann = announcementsSection();
    if (groupMode === "Games") {
      grid?.style.setProperty("display", "flex", "important");
      ann?.style.setProperty("display", "none", "important");
      if (infoBlock) infoBlock.style.display = "none";
    } else if (groupMode === "About") {
      grid?.style.setProperty("display", "none", "important");
      if (ann && !ann.dataset.cerEmpty) ann.style.removeProperty("display"); // keep "no announcements" hidden
      if (infoBlock) infoBlock.style.display = "";
    } else {
      grid?.style.setProperty("display", "none", "important");
      if (infoBlock) infoBlock.style.display = "none";
    }
  }

  // Forum category pills: my CSS chip rule out-specifies any override I write,
  // so set the active pill's colour INLINE (inline !important beats the whole
  // cascade — the only thing that reliably wins here). Verified live.
  function themeForumPills(preset) {
    if (!preset) return;
    for (const pill of document.querySelectorAll(".group-forums-category-pill")) {
      if (pill.classList.contains("active")) {
        pill.style.setProperty("background-color", preset.accent, "important");
        pill.style.setProperty("color", "#fff", "important");
      } else {
        pill.style.removeProperty("background-color");
        pill.style.removeProperty("color");
      }
    }
  }

  // hide the "communities can create and sell official shirts/pants…" promo box
  // Roblox shows in an empty group store. Store tab only, and only a small box
  // that is just the promo — never a description, post, or the item grid.
  const PROMO = /create and sell (official )?(shirts|pants|t-shirts|clothing|items)|(communit|group)[^.]{0,40}ability to crea/i;
  function hideStorePromo() {
    if (groupMode !== "Store" && !/store/i.test(location.pathname + location.hash)) return;
    if (document.querySelector("[data-cer-promo]")) return;
    const t = findText(contentRoot(), PROMO);
    const el = t?.parentElement;
    if (!el || el.closest(".cer-group-info, .cer-group-tabs, [class*='description' i], [class*='announcement' i], [class*='forum' i], [class*='post' i]")) return;
    let box = el.closest("[class*='container'], section, .stack");
    if (
      !box ||
      box.textContent.trim().length > 400 ||
      box.querySelector("a[href*='/catalog/'], a[href*='/games/'], .cer-group-tabs, .cer-group-info, [data-cer-groupgames]")
    )
      box = el;
    box.style.setProperty("display", "none", "important");
    box.dataset.cerPromo = "1";
  }

  // hide the "automatic payouts" list Roblox drops under groups you own — ugly.
  // Group view page only (Configure has the real payout settings). Only ever
  // hide the payout widget itself (a .*payout* container), NEVER climb to a
  // generic <section> — that was blanking the whole group page.
  function hideGroupPayouts() {
    for (const el of document.querySelectorAll("[class*='payout']:not([data-cer-payout]), [class*='Payout']:not([data-cer-payout])")) {
      const box = el.closest("[class*='payout'], [class*='Payout']") ?? el;
      // stay narrow: bail if this "box" wraps big chunks of the page
      if (box.querySelectorAll("a[href*='/games/'], .container-header").length > 1) continue;
      box.style.setProperty("display", "none", "important");
      box.dataset.cerPayout = "1";
    }
  }

  // hide the forum category PAGE title (e.g. a big "Bug Reports" heading) —
  // our pills already label it, and it was picking up an odd background
  function hideForumTitle() {
    const active = document.querySelector(".group-forums-category-pill.active");
    if (!active) return;
    const label = active.textContent.trim();
    for (const h of document.querySelectorAll("h1, h2")) {
      if (h.textContent.trim() === label && !h.closest(".cer-group-tabs")) {
        h.style.setProperty("display", "none", "important");
      }
    }
  }

  // Group/profile work only. Sync: the async builders run on their own and
  // re-apply the mode when they land, so the tab bar never waits on fetches.
  function sweep() {
    chartsStyle();
    const group = onGroups();
    document.body.classList.toggle("cer-group-page", group);
    if (group) {
      const gid = groupIdFromPath();
      teardownStale(gid);
      redesignGroupTabs(gid);
      rebuildGroupGames(gid).catch(() => {});
      suppressNativeGames();
      applyGroupMode();
      themeForumPills(themed());
      hideForumTitle();
      hideEmptyAnnouncements();
      hideStorePromo();
      hideGroupPayouts();
    }
    const preset = themed();
    if ((group || onProfile()) && preset && Date.now() < bannerUntil && bannerPasses < 12) {
      bannerPasses++;
      unblackBanners(preset);
      maskBanners();
    }
  }

  // throttled (not reset by every mutation): a busy page still gets swept
  let sweepTimer = null;
  function scheduleSweep(delay = 300) {
    if (sweepTimer) return;
    sweepTimer = setTimeout(() => {
      sweepTimer = null;
      sweep();
    }, delay);
  }
  const wantsSweep = () => onGroups() || (onProfile() && Date.now() < bannerUntil);

  // one observer: protection sees every added node (before paint); group and
  // profile pages also get a sweep
  new MutationObserver((muts) => {
    if (settings.features.protectGroups) {
      for (const m of muts) {
        if (m.type === "characterData") queueProtect(m.target);
        else for (const n of m.addedNodes) queueProtect(n);
      }
    }
    if (wantsSweep()) scheduleSweep();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  CER.onNavigate(() => {
    bannerUntil = Date.now() + 8000;
    bannerPasses = 0;
    sweep();
  });
  CER.onSettingsChanged(async () => {
    settings = await CER.get();
    applyShield();
    if (settings.features.protectGroups) queueProtect(document.body);
  });

  applyShield();
  if (settings.features.protectGroups) protectIn(document.body);
  sweep();
})();
