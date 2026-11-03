// CER design system. Every redesigned page is built from these pieces, so the
// whole extension has one look that never depends on Roblox's own markup.
// Roblox is only a DATA source (its web APIs) and an ACTION source (launching
// games, its own purchase/confirm modals). Its page DOM is hidden, not reused.
//
//   CER.PAGES / CER.pageFor   route table: which pages we take over
//   CER.ui.mount(tag)         our page root, Roblox's #content hidden
//   CER.ui.h(...)             element builder (hyperscript)
//   CER.ui.*                  components (button, chip, hero, gameCard, ...)
//   CER.api.*                 cached + batched Roblox API reads
//   CER.fmt.*                 number / time formatting
//
// Loaded at document_start right after shared.js. Nothing here touches the
// DOM until a page calls it.

(function () {
  if (typeof CER === "undefined") return;

  // ---------------------------------------------------------------- routes
  // A page is "taken over" when its route matches and its feature is on.
  // theme.js reads this at document_start and adds html.cer-takeover so
  // Roblox's version never paints. Features default ON (undefined !== false).
  CER.PAGES = [
    { tag: "home", feat: "homeRedesign", test: (p) => /^\/(home\/?)?$/i.test(p) },
    { tag: "discover", feat: "gamesRedesign", test: (p, q) => /^\/charts(\/|$)/i.test(p) || (/^\/discover\/?$/i.test(p) && !/keyword=/i.test(q)) },
    { tag: "search", feat: "searchPage", test: (p, q) => /^\/search(\/|$)/i.test(p) || (/^\/discover\/?$/i.test(p) && /keyword=/i.test(q)) },
    { tag: "game", feat: "gamePageRedesign", test: (p) => /^\/games\/\d+/i.test(p) },
    { tag: "profile", feat: "profileRedesign", test: (p) => /^\/users\/\d+\/profile/i.test(p) },
    { tag: "friends", feat: "friendsPage", test: (p) => /^\/users\/(\d+\/)?friends/i.test(p) },
    { tag: "groups", feat: "groupsPage", test: (p) => /^\/(communities|groups)(\/\d+(\/[^/]*)?\/?|\/?)$/i.test(p) && !/configure/i.test(p) },
    { tag: "catalog", feat: "catalogClean", test: (p) => /^\/(catalog|bundles)(\/|$)/i.test(p) },
    { tag: "messages", feat: "messagesPage", test: (p) => /^\/my\/messages/i.test(p) },
    { tag: "settings", feat: "settingsPage", test: (p) => /^\/my\/account/i.test(p) },
    { tag: "transactions", feat: "transactionsPage", test: (p) => /^\/transactions/i.test(p) },
  ];
  CER.pageFor = function (path = location.pathname, query = location.search, feats = {}) {
    if (/[?&]cer=native\b/.test(query)) return null; // escape hatch: Roblox's own page
    for (const pg of CER.PAGES) if (pg.test(path, query) && feats[pg.feat] !== false) return pg;
    return null;
  };

  // Resolves to the tag of the page we take over here, or null. Old per-page
  // scripts await this and stand down when their page is ours now.
  CER.takeover = (async () => {
    try {
      const { features = {} } = await CER.ext.storage.local.get("features");
      return CER.pageFor(location.pathname, location.search, features)?.tag ?? null;
    } catch {
      return null;
    }
  })();

  const ui = (CER.ui = {});
  // Same URL but showing Roblox's own page (for flows only Roblox should run:
  // purchases, security settings, captcha joins). ui.nativeUrl("/catalog/123")
  ui.nativeUrl = function (url = location.href) {
    const u = new URL(url, location.origin);
    u.searchParams.set("cer", "native");
    return u.toString();
  };
  const api = (CER.api = {});
  const fmt = (CER.fmt = {});

  // ---------------------------------------------------------------- builder
  // h("div", { class: "x", onClick: fn, style: { color: "red" } }, child, [kids], "text")
  // null / false / undefined children and props are skipped.
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
      kids.unshift(props);
      props = null;
    }
    if (props)
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "style" && typeof v === "object") {
          for (const s in v) s.startsWith("--") ? el.style.setProperty(s, v[s]) : (el.style[s] = v[s]);
        } else if (k === "dataset") Object.assign(el.dataset, v);
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "value" || k === "checked") el[k] = v;
        else el.setAttribute(k, v === true ? "" : v);
      }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false || c === true) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }
  ui.h = h;
  ui.add = add;
  ui.clear = (el, ...kids) => (el.replaceChildren(), add(el, kids));

  // ---------------------------------------------------------------- icons
  // Stroke icons (24 grid, currentColor). Drawn for CER, not taken from Roblox.
  const I = {
    play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
    star: '<path d="m12 2.5 2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95Z"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    like: '<path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
    dislike: '<path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    crown: '<path d="m2.5 6 4 10h11l4-10-5.5 4L12 4l-4 6Z"/><path d="M6 20h12"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3.5 2"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0Z"/>',
    sparkle: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2Z"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>',
    globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5a14.5 14.5 0 0 1 0 19 14.5 14.5 0 0 1 0-19"/>',
    lock: '<rect x="3.5" y="11" width="17" height="10.5" rx="2"/><path d="M7.5 11V7a4.5 4.5 0 0 1 9 0v4"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    gamepad: '<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6.5 12h4M8.5 10v4M15 11h.01M18 13h.01"/>',
    shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m22 7-10 6L2 7"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5H15V15H9v6.5H4.5A1.5 1.5 0 0 1 3 20Z"/>',
    compass: '<circle cx="12" cy="12" r="9.5"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3Z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    server: '<rect x="2.5" y="3" width="19" height="7.5" rx="2"/><rect x="2.5" y="13.5" width="19" height="7.5" rx="2"/><path d="M6.5 6.75h.01M6.5 17.25h.01"/>',
    robux: '<path d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7Z"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
    medal: '<circle cx="12" cy="8.5" r="6"/><path d="M15.48 13.4 17 22l-5-3-5 3 1.52-8.6"/>',
    ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 11v2M13 17v2"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54Z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    pin: '<path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
    info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4.5M12 8h.01"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3Z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    verified: '<path d="M12 2.5 14.4 4.6l3.1-.4.9 3 2.8 1.5-1 3 1 3-2.8 1.5-.9 3-3.1-.4L12 21.5l-2.4-2.1-3.1.4-.9-3-2.8-1.5 1-3-1-3 2.8-1.5.9-3 3.1.4Z" fill="currentColor" stroke="none"/><path d="m8.5 12 2.5 2.5 4.5-5" style="stroke:var(--cer-bg,#111216)"/>',
  };
  ui.ICONS = I;
  // ui.icon("play", 18) → <svg>. Unknown names render an empty box, never throw.
  ui.icon = function (name, size = 20, cls = "") {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("width", size);
    s.setAttribute("height", size);
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("class", "cer-icon " + cls);
    s.innerHTML = I[name] ?? ""; // static strings from the table above only
    return s;
  };

  // ---------------------------------------------------------------- format
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  fmt.num = (n) => (n == null || isNaN(n) ? "–" : Number(n) < 1000 ? String(Math.round(Number(n))) : compact.format(Number(n)));
  fmt.full = (n) => (n == null || isNaN(n) ? "–" : Number(n).toLocaleString("en"));
  fmt.pct = (up, down) => {
    const t = (up ?? 0) + (down ?? 0);
    return t > 0 ? Math.round((up / t) * 100) : null;
  };
  fmt.ago = (date) => {
    const t = new Date(date).getTime();
    if (!t) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now";
    const steps = [[60, "min"], [3600, "hour"], [86400, "day"], [604800, "week"], [2629800, "month"], [31557600, "year"]];
    let label = "min", div = 60;
    for (const [d, l] of steps) if (s >= d) (div = d), (label = l);
    const v = Math.floor(s / div);
    return `${v} ${label}${v === 1 ? "" : "s"} ago`;
  };
  fmt.date = (date) => {
    const d = new Date(date);
    return isNaN(d) ? "" : d.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
  };

  // ---------------------------------------------------------------- page shell
  // Our page root goes INSIDE Roblox's <main id="container-main">, next to its
  // #content (which CSS hides under html.cer-takeover). Alerts, prompts and
  // modals Roblox puts elsewhere keep working; nothing of #content shows.
  ui.mount = function (tag) {
    let root = document.getElementById("cer-app");
    if (root && root.dataset.page === tag) return root;
    root?.remove();
    root = h("div", { id: "cer-app", class: "cer-ui cer-app", "data-page": tag });
    const host = document.getElementById("container-main");
    const content = document.getElementById("content");
    if (host && content && content.parentElement === host) host.insertBefore(root, content);
    else if (host) host.appendChild(root);
    else {
      root.classList.add("cer-app-floating");
      document.body.appendChild(root);
    }
    const html = document.documentElement;
    html.classList.add("cer-takeover");
    html.dataset.cerPage = tag;
    CER.skelDone?.(tag);
    CER.dismissSkeleton?.();
    return root;
  };
  // Give the page back to Roblox (feature off, logged out, unsupported view).
  ui.release = function () {
    // theme.js removed Roblox's own app for this page, so it has to be
    // reloaded natively to come back
    if (document.documentElement.dataset.cerGutted) {
      location.replace(ui.nativeUrl());
      return;
    }
    document.getElementById("cer-app")?.remove();
    document.documentElement.classList.remove("cer-takeover");
    delete document.documentElement.dataset.cerPage;
    CER.dismissSkeleton?.();
  };
  // A standard page frame: { root, page } where page is the centered column.
  ui.page = function (tag, cls = "") {
    const root = ui.mount(tag);
    root.replaceChildren();
    const page = h("div", { class: "cer-view " + cls });
    root.appendChild(page);
    return { root, page };
  };
  // Runs `start` now if this route is ours, again on SPA navigation, and
  // releases the takeover when the route stops matching. Pages call this
  // instead of wiring their own navigation checks.
  ui.route = function (tag, start) {
    const pg = CER.PAGES.find((x) => x.tag === tag);
    if (!pg) return;
    let lastKey = null;
    const run = async () => {
      const feats = (await CER.get()).features;
      const match = CER.pageFor(location.pathname, location.search, feats)?.tag === tag;
      if (!match) {
        if (document.getElementById("cer-app")?.dataset.page === tag) ui.release();
        lastKey = null;
        return;
      }
      const key = location.pathname + location.search;
      if (key === lastKey) return;
      lastKey = key;
      try {
        await start();
      } catch (e) {
        console.warn("[CER] " + tag + " page failed, showing Roblox's page", e);
        ui.release();
      }
    };
    run();
    CER.onNavigate(run);
  };

  // ---------------------------------------------------------------- data
  // GET (or write) JSON. Returns parsed JSON or null; never throws.
  // opts: { method, body, ttl (ms, GET cache), bg (use background fetch) }
  const memo = new Map();
  api.json = async function (url, opts = {}) {
    const method = opts.method ?? "GET";
    const key = method === "GET" ? url : null;
    if (key && opts.ttl) {
      const hit = memo.get(key);
      if (hit && Date.now() - hit.t < opts.ttl) return hit.v;
      try {
        const ss = sessionStorage.getItem("cer:" + key);
        if (ss) {
          const o = JSON.parse(ss);
          if (Date.now() - o.t < opts.ttl) {
            memo.set(key, o);
            return o.v;
          }
        }
      } catch {
        /* storage off */
      }
    }
    let v = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (opts.bg) {
          const r = await CER.bgFetch(url, method, opts.body);
          if (r.status === 429) {
            await sleep(600 * (attempt + 1));
            continue;
          }
          v = r.ok ? r.data ?? null : null;
        } else {
          const res = method === "GET" ? await fetch(url, { credentials: "include" }) : await CER.robloxWrite(url, method, opts.body ?? {});
          if (res?.status === 429) {
            await sleep(600 * (attempt + 1));
            continue;
          }
          v = res?.ok ? await res.json().catch(() => null) : null;
        }
      } catch {
        v = null;
      }
      break;
    }
    if (key && opts.ttl && v != null) {
      const o = { t: Date.now(), v };
      memo.set(key, o);
      try {
        const s = JSON.stringify(o);
        if (s.length < 200000) sessionStorage.setItem("cer:" + key, s);
      } catch {
        /* quota: memory cache still works */
      }
    }
    return v;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  api.sleep = sleep;

  // Collects single-id requests made in the same tick into one batched call.
  // load(ids) must resolve to a Map/obj of id → value.
  // keep:false → only coalesces calls in flight, never serves old values
  // (for live data like presence).
  function batcher(load, max = 100, wait = 12, keep = true) {
    const cache = new Map();
    let queue = [];
    let timer = null;
    const flush = () => {
      timer = null;
      const ids = queue;
      queue = [];
      for (let i = 0; i < ids.length; i += max) {
        const chunk = ids.slice(i, i + max);
        load(chunk.map((x) => x.id))
          .catch(() => ({}))
          .then((res) => {
            for (const x of chunk) {
              const val = res instanceof Map ? res.get(String(x.id)) : res?.[x.id];
              x.resolve(val ?? null);
              if (val == null || !keep) cache.delete(String(x.id)); // let a later call refetch
            }
          });
      }
    };
    const one = (id) => {
      id = String(id);
      if (!cache.has(id)) {
        cache.set(id, new Promise((resolve) => queue.push({ id, resolve })));
        if (!timer) timer = setTimeout(flush, wait);
      }
      return cache.get(id);
    };
    one.many = async (ids) => {
      const vals = await Promise.all(ids.map(one));
      const out = new Map();
      ids.forEach((id, i) => vals[i] != null && out.set(String(id), vals[i]));
      return out;
    };
    return one;
  }
  api.batcher = batcher;

  // Thumbnails. api.thumb("headshot", userId) → Promise<url|null>
  const THUMBS = {
    headshot: ["users/avatar-headshot", "userIds", "150x150"],
    headshotLg: ["users/avatar-headshot", "userIds", "420x420"],
    bust: ["users/avatar-bust", "userIds", "150x150"],
    avatar: ["users/avatar", "userIds", "420x420"],
    avatarLg: ["users/avatar", "userIds", "720x720"],
    gameIcon: ["games/icons", "universeIds", "256x256"],
    gameThumb: ["games/multiget/thumbnails", "universeIds", "768x432", "&countPerUniverse=1"],
    groupIcon: ["groups/icons", "groupIds", "150x150"],
    groupIconLg: ["groups/icons", "groupIds", "420x420"],
    asset: ["assets", "assetIds", "420x420"],
    bundle: ["bundles/thumbnails", "bundleIds", "420x420"],
    badge: ["badges/icons", "badgeIds", "150x150"],
    pass: ["game-passes", "gamePassIds", "150x150"],
    outfit: ["users/outfits", "userOutfitIds", "150x150"],
  };
  const thumbBatchers = {};
  for (const [kind, [path, param, size, extra = ""]] of Object.entries(THUMBS)) {
    const multi = kind === "gameThumb";
    thumbBatchers[kind] = batcher(
      async (ids) => {
        const out = new Map();
        let todo = ids;
        for (let attempt = 0; attempt < 3 && todo.length; attempt++) {
          if (attempt) await sleep(1100);
          const j = await api.json(`https://thumbnails.roblox.com/v1/${path}?${param}=${todo.join(",")}&size=${size}&format=Webp&isCircular=false${extra}`);
          const pending = [];
          for (const it of j?.data ?? []) {
            const t = multi ? it.thumbnails?.[0] : it;
            const id = String(multi ? it.universeId : it.targetId);
            if (t?.imageUrl && t.state === "Completed") out.set(id, t.imageUrl);
            else if (t?.state === "Pending") pending.push(id);
          }
          todo = pending;
        }
        return out;
      },
      multi ? 50 : 100
    );
  }
  api.thumb = (kind, id) => (thumbBatchers[kind] && id ? thumbBatchers[kind](id) : Promise.resolve(null));
  api.thumbs = (kind, ids) => (thumbBatchers[kind] ? thumbBatchers[kind].many(ids) : Promise.resolve(new Map()));

  // Users: { id, name, displayName, hasVerifiedBadge }
  api.user = batcher(async (ids) => {
    const j = await api.json("https://users.roblox.com/v1/users", { method: "POST", body: { userIds: ids.map(Number), excludeBannedUsers: false } });
    return new Map((j?.data ?? []).map((u) => [String(u.id), u]));
  });
  api.users = (ids) => api.user.many(ids);

  // Presence: { userPresenceType: 0 offline | 1 online | 2 in game | 3 studio, placeId, rootPlaceId, universeId, lastLocation }
  // From the PAGE: the background worker's request comes back all offline
  // (verified live: 0 of 73 vs 9 online). Background only if the page fails.
  api.presenceOne = batcher(async (ids) => {
    const url = "https://presence.roblox.com/v1/presence/users";
    const body = { userIds: ids.map(Number) };
    const j = (await api.json(url, { method: "POST", body })) ?? (await api.json(url, { method: "POST", body, bg: true }));
    return new Map((j?.userPresences ?? []).map((p) => [String(p.userId), p]));
  }, 100, 12, false);
  api.presence = (ids) => api.presenceOne.many(ids);
  // CSS state name for a presence object
  api.presenceState = (p) => ["offline", "online", "ingame", "studio", "offline"][p?.userPresenceType ?? 0] ?? "offline";

  // Games by universe id: games/v1 info merged with votes.
  // { id, rootPlaceId, name, description, creator, playing, visits, maxPlayers, created, updated, genre, favoritedCount, up, down, rating }
  api.game = batcher(async (ids) => {
    const [info, votes] = await Promise.all([
      api.json("https://games.roblox.com/v1/games?universeIds=" + ids.join(",")),
      api.json("https://games.roblox.com/v1/games/votes?universeIds=" + ids.join(",")),
    ]);
    const out = new Map();
    for (const g of info?.data ?? []) out.set(String(g.id), { ...g });
    for (const v of votes?.data ?? []) {
      const g = out.get(String(v.id));
      if (g) Object.assign(g, { up: v.upVotes, down: v.downVotes, rating: fmt.pct(v.upVotes, v.downVotes) });
    }
    return out;
  }, 50);
  api.games = (ids) => api.game.many(ids);

  // placeId → universeId (cached in storage by shared.js)
  api.universeOf = async (placeId) => (await CER.getUniverseIds([String(placeId)]))[String(placeId)] ?? null;

  // The signed-in user (null when logged out). Shared promise.
  api.me = () => CER.me();

  // All friends of a user: [{ id, name, displayName }] (names filled in).
  api.friends = async function (userId, { ttl = 60000 } = {}) {
    const j = await api.json(`https://friends.roblox.com/v1/users/${userId}/friends`, { ttl });
    const list = (j?.data ?? []).map((f) => ({ id: f.id, name: f.name, displayName: f.displayName }));
    const missing = list.filter((f) => !f.name).map((f) => f.id);
    if (missing.length) {
      const names = await api.users(missing);
      for (const f of list) {
        const u = names.get(String(f.id));
        if (u) Object.assign(f, { name: u.name, displayName: u.displayName, hasVerifiedBadge: u.hasVerifiedBadge });
      }
    }
    return list;
  };

  // ---------------------------------------------------------------- media
  // <img> that fills in when its thumbnail resolves; shimmer until then.
  // ui.thumb("gameThumb", universeId, { class, alt })
  ui.thumb = function (kind, id, opts = {}) {
    const img = h("img", { class: "cer-img " + (opts.class ?? ""), alt: opts.alt ?? "", loading: "lazy", decoding: "async", draggable: "false" });
    const done = (url) => {
      if (url) {
        img.addEventListener("load", () => img.classList.add("cer-img-in"), { once: true });
        img.src = url;
      } else img.classList.add("cer-img-none");
    };
    if (opts.src) done(opts.src);
    else api.thumb(kind, id).then(done);
    return img;
  };
  ui.img = function (src, opts = {}) {
    return ui.thumb(null, null, { ...opts, src });
  };

  // Round avatar with a presence ring. size in px. presence: api presence obj or state string.
  ui.avatar = function (userId, opts = {}) {
    const size = opts.size ?? 48;
    const state = typeof opts.presence === "string" ? opts.presence : opts.presence ? api.presenceState(opts.presence) : null;
    const wrap = h("span", { class: "cer-avatar" + (state ? " is-" + state : ""), style: { "--sz": size + "px" } }, ui.thumb(size > 150 ? "headshotLg" : "headshot", userId, { alt: opts.alt ?? "" }));
    wrap.setPresence = (p) => {
      wrap.className = "cer-avatar" + (p ? " is-" + (typeof p === "string" ? p : api.presenceState(p)) : "");
    };
    return wrap;
  };

  // ---------------------------------------------------------------- controls
  // ui.button("Play", { icon: "play", variant: "primary"|"light"|"soft"|"ghost"|"danger", size: "sm"|"lg", href, onClick, title })
  ui.button = function (label, opts = {}) {
    const tag = opts.href ? "a" : "button";
    const b = h(
      tag,
      {
        class: `cer-btn cer-btn-${opts.variant ?? "soft"}${opts.size ? " cer-btn-" + opts.size : ""}${label ? "" : " cer-btn-icon"} ${opts.class ?? ""}`,
        href: opts.href,
        type: tag === "button" ? "button" : null,
        title: opts.title ?? (label ? null : opts.icon),
        "aria-label": label ? null : opts.title ?? opts.icon,
        disabled: opts.disabled,
        onClick: opts.onClick,
      },
      opts.icon && ui.icon(opts.icon, opts.size === "lg" ? 20 : opts.size === "sm" ? 15 : 18),
      label && h("span", { text: label })
    );
    // busy state for async clicks: b.busy(true)
    b.busy = (on) => {
      b.classList.toggle("is-busy", on);
      b.disabled = on;
    };
    return b;
  };

  // Pill chip. ui.chip("Obby", { active, onClick, icon, count })
  ui.chip = function (label, opts = {}) {
    return h(
      "button",
      { type: "button", class: "cer-chip" + (opts.active ? " is-active" : ""), onClick: opts.onClick, "aria-pressed": opts.active ? "true" : "false" },
      opts.icon && ui.icon(opts.icon, 15),
      h("span", { text: label }),
      opts.count != null && h("span", { class: "cer-chip-count", text: fmt.num(opts.count) })
    );
  };
  // A row of chips where one is active. items: [{ id, label, icon?, count? }]
  // Returns the row; row.set(id) changes the active chip without firing onChange.
  ui.chips = function (items, active, onChange, opts = {}) {
    const row = h("div", { class: "cer-chips" + (opts.wrap ? " is-wrap" : ""), role: "tablist" });
    const render = () => {
      row.replaceChildren(
        ...items.map((it) =>
          ui.chip(it.label, {
            icon: it.icon,
            count: it.count,
            active: it.id === active,
            onClick: () => {
              if (it.id === active) return;
              active = it.id;
              render();
              onChange?.(it.id);
            },
          })
        )
      );
    };
    row.set = (id) => {
      active = id;
      render();
    };
    render();
    return row;
  };
  // Segmented tabs (same API as chips, different look: one joined control)
  ui.tabs = function (items, active, onChange) {
    const row = ui.chips(items, active, onChange);
    row.className = "cer-seg";
    return row;
  };

  // Search / text field. ui.search("Find a game", { onInput, onSubmit, value })
  ui.search = function (placeholder, opts = {}) {
    const input = h("input", { class: "cer-input-el", type: "search", placeholder, value: opts.value ?? "", spellcheck: "false", autocomplete: "off" });
    let t = null;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => opts.onInput?.(input.value.trim()), opts.delay ?? 150);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") opts.onSubmit?.(input.value.trim());
    });
    const wrap = h("label", { class: "cer-input " + (opts.class ?? "") }, ui.icon("search", 17), input);
    wrap.input = input;
    return wrap;
  };

  // Simple dropdown select. ui.select([{ id, label }], current, onChange)
  ui.select = function (items, current, onChange) {
    const sel = h("select", { class: "cer-dropdown" }, items.map((it) => h("option", { value: it.id, text: it.label })));
    sel.value = current;
    sel.addEventListener("change", () => onChange?.(sel.value));
    return h("span", { class: "cer-dropdown-wrap" }, sel, ui.icon("down", 15));
  };

  // On/off switch. ui.toggle(checked, onChange)
  ui.toggle = function (checked, onChange) {
    const input = h("input", { type: "checkbox", class: "cer-switch", checked: !!checked });
    input.addEventListener("change", () => onChange?.(input.checked));
    return input;
  };

  // ---------------------------------------------------------------- layout
  // Section with a title row. ui.section("Top games", { icon, action: { label, href|onClick }, sub })
  // Returns the section element; append content to section.body.
  ui.section = function (title, opts = {}) {
    const body = h("div", { class: "cer-block-body" });
    const head = h(
      "div",
      { class: "cer-block-head" },
      h("h2", { class: "cer-block-title" }, opts.icon && ui.icon(opts.icon, 20), h("span", { text: title }), opts.count != null && h("span", { class: "cer-block-count", text: fmt.num(opts.count) })),
      opts.sub && h("div", { class: "cer-block-sub", text: opts.sub }),
      h("div", { class: "cer-block-tools" }, opts.tools, opts.action && ui.link(opts.action.label ?? "See all", opts.action))
    );
    const s = h("section", { class: "cer-block " + (opts.class ?? "") }, title && head, body);
    s.body = body;
    s.head = head;
    return s;
  };
  // Text link with an arrow. ui.link("See all", { href | onClick })
  ui.link = (label, opts = {}) =>
    h(opts.href ? "a" : "button", { class: "cer-link", href: opts.href, type: opts.href ? null : "button", onClick: opts.onClick }, h("span", { text: label }), ui.icon("right", 15));

  // Responsive grid. ui.grid(children, { min: 200, gap })
  ui.grid = (kids, opts = {}) => h("div", { class: "cer-autogrid " + (opts.class ?? ""), style: { "--min": (opts.min ?? 200) + "px", "--gap": (opts.gap ?? 16) + "px" } }, kids);

  // Horizontal rail with arrow buttons. ui.rail(children, { item: 260 })
  ui.rail = function (kids, opts = {}) {
    const track = h("div", { class: "cer-rail-track", style: { "--item": (opts.item ?? 260) + "px" } }, kids);
    const prev = ui.button("", { icon: "left", variant: "soft", size: "sm", class: "cer-rail-prev", title: "Back" });
    const next = ui.button("", { icon: "right", variant: "soft", size: "sm", class: "cer-rail-next", title: "More" });
    const step = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: "smooth" });
    prev.addEventListener("click", () => step(-1));
    next.addEventListener("click", () => step(1));
    const wrap = h("div", { class: "cer-rail" }, track, prev, next);
    const sync = () => {
      wrap.classList.toggle("at-start", track.scrollLeft < 4);
      wrap.classList.toggle("at-end", track.scrollLeft + track.clientWidth >= track.scrollWidth - 4);
    };
    track.addEventListener("scroll", sync, { passive: true });
    new ResizeObserver(sync).observe(track);
    wrap.track = track;
    return wrap;
  };

  // Main column + side column (stacks on narrow screens).
  ui.cols = (main, side, opts = {}) => h("div", { class: "cer-cols" + (opts.sideLeft ? " side-left" : ""), style: { "--side": (opts.side ?? 340) + "px" } }, h("div", { class: "cer-col-main" }, main), h("aside", { class: "cer-col-side" }, side));

  // Plain card surface. ui.card(children, { class, pad })
  ui.card = (kids, opts = {}) => h(opts.href ? "a" : "div", { class: "cer-card-box" + (opts.pad === false ? " no-pad" : "") + " " + (opts.class ?? ""), href: opts.href }, kids);

  // Page heading. ui.header({ title, sub, icon, actions: [nodes] })
  ui.header = (o) =>
    h(
      "header",
      { class: "cer-view-head" },
      h("div", { class: "cer-view-head-text" }, h("h1", { class: "cer-view-title" }, o.icon && ui.icon(o.icon, 28), h("span", { text: o.title })), o.sub && h("p", { class: "cer-view-sub", text: o.sub })),
      o.actions && h("div", { class: "cer-view-actions" }, o.actions)
    );

  // Big hero banner with a blurred backdrop of `image`.
  // ui.hero({ image, art, eyebrow, title, sub, stats: [{ icon, label }], actions: [nodes], children })
  // `image` may be a URL or a Promise<URL>.
  ui.hero = function (o) {
    const bg = h("div", { class: "cer-hero-bg" });
    const art = o.art ? h("div", { class: "cer-hero-art" }, o.art) : null;
    const hero = h(
      "div",
      { class: "cer-hero " + (o.class ?? "") },
      bg,
      h("div", { class: "cer-hero-shade" }),
      h(
        "div",
        { class: "cer-hero-body" },
        o.eyebrow && h("span", { class: "cer-hero-eyebrow" }, o.eyebrowIcon && ui.icon(o.eyebrowIcon, 14), o.eyebrow),
        h("h1", { class: "cer-hero-title", text: o.title ?? "" }),
        o.sub && h("p", { class: "cer-hero-sub", text: o.sub }),
        o.stats?.length && h("div", { class: "cer-hero-stats" }, o.stats.map((s) => s && h("span", { class: "cer-hero-stat" }, s.icon && ui.icon(s.icon, 16), h("span", { text: s.label })))),
        o.actions?.length && h("div", { class: "cer-hero-actions" }, o.actions),
        o.children
      ),
      art
    );
    hero.setImage = (url) => {
      if (url) bg.style.backgroundImage = `url("${String(url).replace(/"/g, "")}")`;
      hero.classList.toggle("has-image", !!url);
    };
    Promise.resolve(o.image).then(hero.setImage);
    return hero;
  };

  // Small labelled number. ui.stat("1.2M", "Visits", { icon })
  ui.stat = (value, label, opts = {}) =>
    h("div", { class: "cer-stat" }, opts.icon && ui.icon(opts.icon, 18), h("div", { class: "cer-stat-value", text: value }), h("div", { class: "cer-stat-label", text: label }));

  // Tag / badge. ui.badge("Owner", "accent"|"good"|"warn"|"bad"|"plain")
  ui.badge = (text, tone = "plain", icon) => h("span", { class: "cer-badge is-" + tone }, icon && ui.icon(icon, 13), h("span", { text }));

  // Empty / error state. ui.empty("Nothing here yet", { icon, action: node })
  ui.empty = (text, opts = {}) => h("div", { class: "cer-empty" }, h("span", { class: "cer-empty-icon" }, ui.icon(opts.icon ?? "sparkle", 26)), h("p", { text }), opts.action);

  // Loading placeholders. ui.skeleton("card"|"tile"|"row"|"line"|"hero", n)
  ui.skeleton = function (kind = "card", n = 1) {
    const one = () => h("div", { class: "cer-sk cer-sk-" + kind }, kind === "card" && [h("div", { class: "cer-sk-media" }), h("div", { class: "cer-sk-line" }), h("div", { class: "cer-sk-line short" })]);
    return n === 1 ? one() : Array.from({ length: n }, one);
  };

  // ---------------------------------------------------------------- tiles
  // Game card. game: { placeId, universeId, name, playing, rating, image? }
  // opts: { rank, size: "md"|"lg"|"icon", sub, showPlay (default true), features }
  ui.gameCard = function (game, opts = {}) {
    const kind = opts.size === "icon" ? "gameIcon" : "gameThumb";
    const name = CER.cleanTitle(game.name ?? "", opts.features ?? CER._featsCache ?? {});
    const media = h("div", { class: "cer-gc-media" }, ui.thumb(kind, game.universeId, { src: game.image, alt: "" }));
    if (opts.rank) media.appendChild(h("span", { class: "cer-gc-rank", text: "#" + opts.rank }));
    if (opts.showPlay !== false && game.placeId) {
      const play = h("button", { type: "button", class: "cer-gc-play", title: "Play", "aria-label": "Play " + name }, ui.icon("play", 18));
      play.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ui.play(game.placeId);
      });
      media.appendChild(play);
    }
    const meta = h(
      "div",
      { class: "cer-gc-meta" },
      game.rating != null && h("span", {}, ui.icon("like", 13), h("span", { text: game.rating + "%" })),
      game.playing != null && h("span", {}, ui.icon("users", 13), h("span", { text: fmt.num(game.playing) })),
      opts.sub && h("span", { class: "cer-gc-sub", text: opts.sub })
    );
    return h(
      "a",
      { class: `cer-gc cer-gc-${opts.size ?? "md"}`, href: game.placeId ? `https://www.roblox.com/games/${game.placeId}` : null, title: game.name },
      media,
      h("div", { class: "cer-gc-name", text: name }),
      meta
    );
  };
  // Fill game objects that only have ids (placeId and/or universeId) with
  // name / playing / rating. Mutates and returns the array.
  ui.hydrateGames = async function (games) {
    const needU = games.filter((g) => !g.universeId && g.placeId).map((g) => String(g.placeId));
    if (needU.length) {
      const map = await CER.getUniverseIds(needU);
      for (const g of games) if (!g.universeId && g.placeId) g.universeId = map[String(g.placeId)];
    }
    const info = await api.games(games.map((g) => g.universeId).filter(Boolean));
    for (const g of games) {
      const i = info.get(String(g.universeId));
      if (!i) continue;
      g.name ??= i.name;
      g.placeId ??= i.rootPlaceId;
      g.playing ??= i.playing;
      g.rating ??= i.rating;
      g.info = i;
    }
    return games;
  };

  // Person tile: avatar + display name + one line under it.
  // user: { id, displayName, name }, opts: { presence, sub, size, href, action: node }
  ui.userTile = function (user, opts = {}) {
    const p = opts.presence;
    const state = p ? api.presenceState(p) : null;
    const sub = opts.sub ?? (p && state === "ingame" && p.lastLocation ? p.lastLocation : user.name ? "@" + user.name : "");
    return h(
      "a",
      { class: "cer-user" + (opts.row ? " is-row" : ""), href: opts.href ?? `https://www.roblox.com/users/${user.id}/profile`, title: user.displayName ?? user.name },
      ui.avatar(user.id, { size: opts.size ?? (opts.row ? 44 : 84), presence: p }),
      h("span", { class: "cer-user-text" }, h("span", { class: "cer-user-name", text: user.displayName ?? user.name ?? "" }), sub && h("span", { class: "cer-user-sub is-" + (state ?? "none"), text: sub })),
      opts.action
    );
  };

  // ---------------------------------------------------------------- actions
  // Launch a game through Roblox's own launcher (bridge.js). Same as the
  // existing cards, so the launch prompt and install flow are Roblox's.
  ui.play = (placeId, jobId) =>
    jobId
      ? CER.launch({ cer: "join-instance", placeId, jobId }, `roblox://experiences/start?placeId=${placeId}&gameInstanceId=${jobId}`)
      : CER.launch({ cer: "join-multiplayer", placeId }, `roblox://experiences/start?placeId=${placeId}`);

  // Modal dialog. ui.modal({ title, body: node, actions: [{ label, variant, onClick(close) }] })
  // Returns { el, close }. Esc and the backdrop close it.
  ui.modal = function (o) {
    const close = () => {
      overlay.classList.remove("is-in");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => overlay.remove(), 160);
      o.onClose?.();
    };
    const onKey = (e) => e.key === "Escape" && close();
    const actions = (o.actions ?? []).map((a) => ui.button(a.label, { variant: a.variant ?? "soft", icon: a.icon, onClick: () => (a.onClick ? a.onClick(close) : close()) }));
    const box = h(
      "div",
      { class: "cer-modal " + (o.class ?? ""), role: "dialog", "aria-modal": "true" },
      h("div", { class: "cer-modal-head" }, h("h3", { text: o.title ?? "" }), ui.button("", { icon: "x", variant: "ghost", size: "sm", title: "Close", onClick: close })),
      h("div", { class: "cer-modal-body" }, o.body),
      actions.length && h("div", { class: "cer-modal-actions" }, actions)
    );
    const overlay = h("div", { class: "cer-ui cer-modal-overlay", onClick: (e) => e.target === overlay && close() }, box);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => overlay.classList.add("is-in"));
    return { el: box, close };
  };

  // Copy text, with a toast.
  ui.copy = async (text, msg = "Copied!") => {
    try {
      await navigator.clipboard.writeText(text);
      CER.toast?.(msg);
    } catch {
      CER.toast?.("Could not copy", "error");
    }
  };

  // Show more text: clamps long text to `lines`, with a toggle.
  ui.clamp = function (text, lines = 4) {
    const p = h("p", { class: "cer-clamp", style: { "--lines": lines }, text: text ?? "" });
    const more = h("button", { type: "button", class: "cer-clamp-more", text: "Show more" });
    more.addEventListener("click", () => {
      const open = p.classList.toggle("is-open");
      more.textContent = open ? "Show less" : "Show more";
    });
    const wrap = h("div", { class: "cer-clamp-wrap" }, p, more);
    requestAnimationFrame(() => more.classList.toggle("is-hidden", p.scrollHeight <= p.clientHeight + 2));
    return wrap;
  };

  // Lazy section: runs `load()` when `el` scrolls near view (once).
  ui.whenVisible = function (el, load) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          load();
        }
      },
      { rootMargin: "600px" }
    );
    io.observe(el);
  };

  // keep a synchronous copy of features for cleanTitle in cards
  CER.get?.().then((s) => (CER._featsCache = s.features)).catch(() => {});
})();
