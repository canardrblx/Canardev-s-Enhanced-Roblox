// Profile pill redesign on /users/{id}/profile.
// Replaces the native About/Creations tab bar with a pill bar
//   About · Creations · Favorites · Friends · Collections · Groups · Badges
// (each conditional on having content), showing ONE section at a time. By
// default the heavy About-page carousels are hidden — "About" shows a compact
// info card (join date) plus the Friends row; the description + stat pills
// already live in the profile header. Empty/absent sections get no pill.
//
// The About sections are matched by stable profile-* classes (their inner
// wrappers use hashed emotion classes, so we never target those). React does
// not fight display:none here (verified live), but we re-assert on re-render.

(async function () {
  if (typeof CER === "undefined") return;
  const settings = await CER.get();
  if (settings.features.profileRedesign === false) return CER.dismissSkeleton?.();
  const userId = location.pathname.match(/\/users\/(\d+)\/profile/)?.[1];
  if (!userId) return CER.dismissSkeleton?.();

  // All experiences credited to this user: their own games PLUS games in groups
  // they own (Roblox lists those under Creations too). Shared by the Creations
  // grid and the Place Visits stat. Fetched once, started before we even wait
  // for the pane. Resolves { games, more } — `more` = a list was cut off at the
  // page cap, so the visits total is a floor, not the real number.
  const GAME_PAGES = 4; // 4 x 50 = 200 games per source, plenty for nearly everyone
  async function pagedGames(base) {
    let out = [];
    let cursor = "";
    for (let i = 0; i < GAME_PAGES; i++) {
      const res = await fetch(base + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), { credentials: "include" });
      if (!res.ok) break;
      const d = await res.json();
      out = out.concat(d.data ?? []);
      cursor = d.nextPageCursor;
      if (!cursor) return { data: out, more: false };
    }
    return { data: out, more: !!cursor };
  }
  const creatorGamesP = (async () => {
    let more = false;
    const own = pagedGames(`https://games.roblox.com/v2/users/${userId}/games?limit=50&sortOrder=Desc`).catch(() => ({ data: [], more: false }));
    // owned groups' games, all groups in parallel (was one group at a time)
    const grp = (async () => {
      try {
        const roles = (await (await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`, { credentials: "include" })).json()).data ?? [];
        const owned = roles.filter((r) => r.role?.rank === 255 && r.group?.id); // owner rank only
        return await Promise.all(
          owned.map((r) =>
            pagedGames(`https://games.roblox.com/v2/groups/${r.group.id}/games?limit=50&sortOrder=Desc`).catch(() => ({ data: [], more: false }))
          )
        );
      } catch {
        return []; // not in any owned groups
      }
    })();
    let games = [];
    for (const r of [await own, ...(await grp)]) {
      games = games.concat(r.data);
      if (r.more) more = true;
    }
    // Only PUBLIC experiences belong in Creations (private/unpublished ones
    // shouldn't leak). develop-api returns each universe's privacyType; keep a
    // game unless it's explicitly Private (so a failed lookup never blanks the
    // list — other users' games are already public-filtered server-side).
    try {
      const ids = games.map((g) => g.id).filter(Boolean);
      const chunks = [];
      for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
      const lists = await Promise.all(
        chunks.map(async (c) => {
          const res = await fetch(`https://develop.roblox.com/v1/universes/multiget?${c.map((id) => "ids=" + id).join("&")}`, { credentials: "include" });
          return res.ok ? (await res.json()).data ?? [] : [];
        })
      );
      const privateSet = new Set(lists.flat().filter((u) => u.privacyType && u.privacyType !== "Public").map((u) => u.id));
      if (privateSet.size) games = games.filter((g) => !privateSet.has(g.id));
    } catch {
      /* leave the list as-is on lookup failure */
    }
    games.sort((a, b) => (b.placeVisits || 0) - (a.placeVisits || 0)); // most-visited first
    return { games, more };
  })();

  // About-card data, also started before the pane wait so it races Roblox's
  // own render instead of queueing behind it
  const getJson = (url) =>
    fetch(url, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  const infoP = getJson(`https://users.roblox.com/v1/users/${userId}`);
  const countsP = Promise.all(
    ["friends", "followers", "followings"].map((k) => getJson(`https://friends.roblox.com/v1/users/${userId}/${k}/count`).then((d) => d?.count ?? null))
  );

  // .profile-tab-content = the older tabbed profile; .profile-content = the
  // 2026 single-scroll profile (3D avatar banner, no About/Creations tabs)
  const pane = await CER.waitFor(() => {
    const p = document.querySelector(".profile-tab-content, .profile-content");
    return p && p.children.length ? p : null;
  }, 12000).catch(() => null);
  if (!pane) return CER.dismissSkeleton?.(); // terminated/blocked user, or Roblox changed the page
  if (document.querySelector(".cer-profile-pills")) return; // another run owns the page

  // ---- map the About sections (stable profile-* classes; Friends is classless) ----
  function sectionsOf() {
    const s = {};
    for (const c of pane.children) {
      if (c.classList.contains("cer-profile-aboutview") || c.classList.contains("cer-profile-customview")) continue;
      const head = (c.querySelector(".container-header, h2, h3")?.textContent || "").trim();
      if (c.classList.contains("profile-currently-wearing")) s.wearing = c;
      else if (c.classList.contains("profile-favorite-experiences")) s.favorites = c;
      else if (c.classList.contains("profile-experiences")) s.creations = c; // 2026 layout: Games
      else if (c.classList.contains("react-friends-carousel-container")) s.friends = c;
      else if (c.classList.contains("profile-collections")) s.collections = c;
      else if (c.classList.contains("profile-communities")) s.groups = c;
      else if (c.classList.contains("profile-carousel") && /badge/i.test(head)) s.badges = c;
      else if (/^friends/i.test(head)) s.friends = c;
    }
    return s;
  }
  let secs = sectionsOf();

  // a carousel counts as "has content" if it holds at least one real item
  const hasContent = (el) =>
    !!el &&
    el.querySelectorAll("a[href*='/'], img, [class*='game-card'], [class*='avatar-card'], [class*='list-item']").length >= 1;

  // native tabs: ul.profile-tabs > li > a.profile-tab ("About"/"Creations"),
  // active tab carries .active
  const tabBar = document.querySelector("ul.profile-tabs");
  const tabByName = (name) =>
    [...(tabBar?.querySelectorAll("a.profile-tab") ?? [])].find((t) => t.textContent.trim().toLowerCase() === name);
  const aboutTab = tabByName("about");
  const creationsTab = tabByName("creations");

  // ---- the About view: info card ABOVE the bio (both built from the API, so
  //      we never touch Roblox's fragile Angular bio node) ----
  const aboutView = CER.el("div", "cer-profile-aboutview");
  // undefined = still loading (skeleton cell), null = hide the cell
  const info = { Joined: undefined, "Place Visits": undefined, Friends: undefined, Followers: undefined, Following: undefined };
  const infoGrid = CER.el("div", "cer-profile-info");
  aboutView.appendChild(infoGrid);
  function renderInfo() {
    infoGrid.textContent = "";
    for (const [k, v] of Object.entries(info)) {
      if (v === null) continue;
      const cell = CER.el("div", "cer-profile-infocell" + (v === undefined ? " cer-skel-tile" : ""));
      cell.appendChild(CER.el("div", "cer-profile-infoval", v === undefined ? "\u00a0" : String(v)));
      cell.appendChild(CER.el("div", "cer-profile-infokey", v === undefined ? "\u00a0" : k));
      infoGrid.appendChild(cell);
    }
  }
  renderInfo(); // skeleton cells right away; filled in as each fetch lands

  // join date, bio and counts arrive together (all started above)
  (async () => {
    const [u, [friendsCnt, followers, following]] = await Promise.all([infoP, countsP]);
    info.Joined = u?.created ? new Date(u.created).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : null;
    info.Friends = friendsCnt != null ? friendsCnt.toLocaleString() : null;
    info.Followers = followers != null ? followers.toLocaleString() : null;
    info.Following = following != null ? following.toLocaleString() : null;
    renderInfo();
    const description = u?.description || "";

    // bio BELOW the info card — clamp at 12 lines with a Show more toggle
    if (description.trim()) {
      const bioWrap = CER.el("div", "cer-profile-bio");
      const bioText = CER.el("div", "cer-profile-biotext");
      bioText.textContent = description;
      bioWrap.appendChild(bioText);
      aboutView.appendChild(bioWrap);
      requestAnimationFrame(() => {
        const lh = parseFloat(getComputedStyle(bioText).lineHeight) || 20;
        bioText.style.webkitLineClamp = "unset";
        const lines = Math.round(bioText.scrollHeight / lh);
        bioText.style.webkitLineClamp = "";
        if (lines > 12) {
          let exp = false;
          const t = CER.el("button", "cer-profile-morebtn", "Show more");
          t.addEventListener("click", () => {
            exp = !exp;
            bioWrap.classList.toggle("cer-bio-expanded", exp);
            t.textContent = exp ? "Show less" : "Show more";
          });
          bioWrap.appendChild(t);
        } else {
          bioWrap.classList.add("cer-bio-expanded");
        }
      });
    }
  })();
  // total place visits across the user's games + owned-group games; slower
  // (several round trips), so it fills its own cell when ready. "+" when a
  // list hit the page cap, so the number never claims to be the full total.
  creatorGamesP
    .then(({ games, more }) => {
      const visits = games.reduce((s, g) => s + (g.placeVisits || 0), 0);
      info["Place Visits"] = visits > 0 ? visits.toLocaleString() + (more ? "+" : "") : null;
    })
    .catch(() => {
      info["Place Visits"] = null;
    })
    .then(renderInfo);

  // ---- custom thumbnail grids for Favorites / Creations ----
  // Roblox pins its square icon cards (aspect-ratio overrides are ignored), so
  // these tabs render OUR 16:9 thumbnail grid (same cards as the Games page)
  // from the games API instead of restyling the native carousel.
  const customView = CER.el("div", "cer-profile-customview");
  let favGames = null; // null = still loading
  let myGames = null;
  (async () => {
    try {
      favGames = (await (await fetch(`https://games.roblox.com/v2/users/${userId}/favorite/games?limit=50&sortOrder=Desc`, { credentials: "include" })).json()).data ?? [];
    } catch {
      favGames = [];
    }
    try {
      myGames = (await creatorGamesP).games; // personal + owned-group experiences
    } catch {
      myGames = [];
    }
    rebuildPills();
  })();

  let gridToken = 0; // bumps per render, so a slow thumbnail fetch for a pill
  // the user already left can't overwrite the one they switched to
  async function renderGameGrid(list) {
    const token = ++gridToken;
    customView.textContent = "";
    if (!list.length) {
      customView.appendChild(CER.el("p", "cer-hint", "Nothing here yet."));
      return;
    }
    customView.appendChild(CER.skelGrid(Math.min(list.length, 6), 120, 190)); // skeleton while thumbs load
    // v2 games API: id IS the universeId, place lives in rootPlace.id
    const thumbs = await CER.getGameThumbs(list.map((g) => String(g.id)));
    if (token !== gridToken) return;
    const grid = CER.el("div", "cer-g-grid");
    for (const g of list) {
      const card = CER.el("a", "cer-g-card");
      card.href = "https://www.roblox.com/games/" + (g.rootPlace?.id ?? "") + "/";
      const th = CER.el("div", "cer-g-thumb");
      if (thumbs[g.id]) th.style.backgroundImage = `url(${thumbs[g.id]})`;
      card.appendChild(th);
      card.appendChild(CER.el("div", "cer-g-name", g.name ?? ""));
      if (g.placeVisits != null) card.appendChild(CER.el("div", "cer-g-meta", Number(g.placeVisits).toLocaleString() + " visits"));
      grid.appendChild(card);
    }
    customView.textContent = "";
    customView.appendChild(grid);
  }

  // ---- pill bar ----
  const bar = CER.el("div", "cer-profile-pills");
  const pills = [];

  function ensureAboutTab() {
    if (aboutTab && !aboutTab.classList.contains("active")) aboutTab.click();
  }
  let wantKey = "about"; // last selected view, re-asserted on re-render

  // hide each section's own title/header — the pill already names it. Sections
  // use different markup for the title: legacy .container-header, or the newer
  // React heading row (.text-heading-* inside an inline-flex). Hide whichever
  // exists. Keep titles when a pane genuinely shows >1 section (e.g. Creations
  // with both Games and Clothing).
  // Return the exact title node to hide — STRUCTURAL, never content-dependent
  // (a climb that guessed by "does this hold cards yet" hid the whole Friends
  // section before its avatars loaded). Legacy .container-header holds title +
  // See All, so hide it directly. React sections wrap the title in a small
  // .items-center/inline-flex header row — hide that one level, nothing deeper.
  function sectionTitle(sec) {
    const heading = sec.querySelector(".container-header, [class*='text-heading']");
    if (!heading) return null;
    if (heading.classList.contains("container-header")) return heading;
    const parent = heading.parentElement;
    if (parent && parent !== sec && /items-center|inline-flex/.test(parent.className)) return parent;
    return heading;
  }
  function hideTitles() {
    const visible = [...pane.children].filter((c) => c !== aboutView && c.style.display !== "none");
    const multi = visible.length > 1;
    for (const c of pane.children) {
      if (c === aboutView) continue;
      const t = sectionTitle(c);
      if (t) t.style.display = multi ? "" : "none";
    }
  }

  let customActive = false;

  function apply() {
    secs = sectionsOf();
    if (pane.firstElementChild !== aboutView) pane.insertBefore(aboutView, pane.firstChild);
    if (customView.parentElement !== pane) pane.appendChild(customView);

    const showAbout = wantKey === "about";
    aboutView.style.display = showAbout ? "" : "none";
    customView.style.display = customActive ? "" : "none";
    for (const c of pane.children) {
      if (c === aboutView || c === customView) continue;
      // About shows the info card ONLY — no Friends carousel (per spec)
      c.style.display = !showAbout && !customActive && c === secs[wantKey] ? "" : "none";
    }
    hideTitles();
    // the section title (with its "See All") is hidden, so give Friends a
    // "Show all" link underneath instead
    if (wantKey === "friends" && secs.friends && !secs.friends.querySelector(".cer-show-all")) {
      const link = CER.el("a", "cer-show-all", "Show all friends →");
      // THIS profile's friends, not the viewer's own (/users/friends is "mine")
      link.href = `https://www.roblox.com/users/${userId}/friends`;
      secs.friends.appendChild(link);
    }
  }

  function select(key, pillEl) {
    for (const p of pills) p.el.classList.toggle("cer-profile-pill-active", p.el === pillEl);
    // Favorites / Creations: our own 16:9 thumbnail grids from the games API
    if (key === "favorites" && favGames) {
      wantKey = key;
      customActive = true;
      renderGameGrid(favGames);
      ensureAboutTab();
      setTimeout(apply, 30);
      return;
    }
    if (key === "creations") {
      if (myGames && myGames.length) {
        wantKey = key;
        customActive = true;
        renderGameGrid(myGames);
        ensureAboutTab();
        setTimeout(apply, 30);
        return;
      }
      // clothing-only creators: fall back to Roblox's native Creations tab
      customActive = false;
      aboutView.style.display = "none";
      customView.style.display = "none";
      for (const c of pane.children) if (c !== aboutView && c !== customView) c.style.display = "";
      creationsTab?.click();
      setTimeout(hideTitles, 120);
      return;
    }
    customActive = false;
    wantKey = key;
    ensureAboutTab();
    setTimeout(apply, 30);
  }

  // Section carousels load asynchronously, so a pill's content may not exist at
  // mount. Build pills idempotently and re-run as sections appear — otherwise
  // Favorites/Friends/Collections/Groups never get a pill (the bug where those
  // tabs "showed nothing").
  const PILL_DEFS = [
    ["About", "about", () => true],
    ["Creations", "creations", () => !!creationsTab || (myGames && myGames.length > 0) || hasContent(secs.creations)],
    ["Favorites", "favorites", () => (favGames ? favGames.length > 0 : hasContent(secs.favorites))],
    ["Friends", "friends", () => !!secs.friends],
    ["Collections", "collections", () => hasContent(secs.collections)],
    ["Groups", "groups", () => hasContent(secs.groups)],
    ["Badges", "badges", () => hasContent(secs.badges)],
  ];
  function rebuildPills() {
    secs = sectionsOf();
    for (const [label, key, cond] of PILL_DEFS) {
      if (cond() && !pills.some((p) => p.key === key)) {
        const p = CER.el("button", "cer-profile-pill", label);
        if (key === wantKey) p.classList.add("cer-profile-pill-active");
        p.addEventListener("click", () => select(key, p));
        pills.push({ el: p, key });
      }
    }
    // keep the bar in canonical order regardless of load timing
    bar.textContent = "";
    for (const [, key] of PILL_DEFS) {
      const p = pills.find((x) => x.key === key);
      if (p) bar.appendChild(p.el);
    }
  }

  // mount: hide native tabs, insert pill bar above the pane, About view inside
  if (tabBar) tabBar.style.display = "none";
  document.body.classList.add("cer-profile-managed");
  pane.parentElement.insertBefore(bar, pane);
  pane.insertBefore(aboutView, pane.firstChild);
  rebuildPills();

  const header = document.querySelector(".user-profile-header");
  // hide the native stat pills (Friends / Followers / Following) — redundant
  // with the About info card
  const statBar =
    header &&
    [...header.querySelectorAll(".flex-nowrap.gap-small.flex, div")].find(
      (c) => /Friends/.test(c.textContent) && /Followers/.test(c.textContent) && /Following/.test(c.textContent) && c.textContent.trim().length < 60
    );
  if (statBar) statBar.style.display = "none";

  // hide the React header bio (a <pre>) — our About view renders the bio instead
  function hideHeaderBio() {
    const pre = header?.querySelector("pre.content-default, pre[class*='text-body']");
    if (pre) (pre.parentElement && pre.parentElement !== header ? pre.parentElement : pre).style.display = "none";
  }
  hideHeaderBio();

  // default view
  select("about", pills[0].el);
  // the shell (pill bar + About card with skeleton cells) is in place; the
  // data fills in on its own, so reveal the page now
  CER.skelDone?.("profile");

  // Roblox re-renders the pane (tab switches, lazy loads) — re-assert our view.
  let raf = null;
  const paneObs = new MutationObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      if (tabBar) tabBar.style.display = "none";
      if (statBar) statBar.style.display = "none";
      hideHeaderBio();
      rebuildPills();
      if (!bar.isConnected) pane.parentElement.insertBefore(bar, pane);
      if (customActive || wantKey !== "creations") apply();
      else hideTitles();
    });
  });
  paneObs.observe(pane, { childList: true });

  // the profile ⋯ menu has a redundant "Favorites" entry (we have a Favorites
  // pill) — hide it whenever the menu renders. The menu mounts in a portal, so
  // we watch the body, but only scan the nodes that were just added, once per
  // frame (a full-document [class*=] scan on every mutation was a hot path).
  const MENU_SEL = '[role="menuitem"], .dropdown-menu li, [class*="menu-item"], [class*="MenuItem"]';
  let addedNodes = [];
  let menuRaf = null;
  function hideMenuFavorites() {
    menuRaf = null;
    const roots = addedNodes;
    addedNodes = [];
    for (const root of roots) {
      if (!root.isConnected) continue;
      const items = root.matches(MENU_SEL) ? [root] : root.querySelectorAll(MENU_SEL);
      for (const el of items) {
        if (el.textContent.trim() === "Favorites" && !el.closest(".cer-profile-pills")) {
          el.style.setProperty("display", "none", "important");
        }
      }
    }
  }
  const menuObs = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) addedNodes.push(n);
    if (addedNodes.length && !menuRaf) menuRaf = requestAnimationFrame(hideMenuFavorites);
  });
  menuObs.observe(document.body, { childList: true, subtree: true });

  // Roblox can leave the profile client-side: stop watching once we're gone
  CER.onNavigate(() => {
    if (location.pathname.includes(`/users/${userId}/profile`)) return;
    paneObs.disconnect();
    menuObs.disconnect();
  });
})();
