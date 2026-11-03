// Games page redesign (/charts). A decluttered layout: Top Experiences,
// a genre-rotating "Trending in X" carousel, and "Canardev's picks" — those
// three take the left ~2/3, fade out, then a friend "what they're playing"
// sidebar on the right. Gated behind features.gamesRedesign (off until ready).
//
// Data: Roblox's explore-api (get-sort-content) + search-api (genre lists) +
// presence for friends. Thumbnails via CER.getGameThumbs.

(function () {
  if (typeof CER === "undefined") return;

  let cerGamesTeardown = null; // set while our page is mounted

  async function runGamesRedesign() {
  if (!location.pathname.startsWith("/charts")) return;
  const settings = await CER.get();
  if (!settings.features.gamesRedesign) return;
  if (document.querySelector(".cer-games")) return;

  // the user id only seeds the explore sessionId; the shell doesn't wait on it
  const meP = CER.me();
  const sid = async () => "cer-" + ((await meP)?.id ?? "guest");
  const EXPLORE = "https://apis.roblox.com/explore-api/v1";
  const GENRES = ["Roleplay", "Obby", "Simulator", "Tower Defense", "Survival", "Fighting", "Horror", "Tycoon", "Sports", "Adventure"];

  // Canardev's picks — place IDs (see project-cer-charts-redesign memory)
  const PICK_PLACES = [
    "78515283254292", "17625359962", "97598239454123", "142823291", "82958998841721",
    "3260590327", "606849621", "537413528", "6872265039", "14564651437",
  ];

  // ---- data ----
  async function fetchSort(sortId) {
    try {
      const r = await fetch(`${EXPLORE}/get-sort-content?sessionId=${await sid()}&sortId=${sortId}&device=computer&country=all`, { credentials: "include" });
      if (!r.ok) return [];
      return (await r.json()).games ?? [];
    } catch {
      return [];
    }
  }
  async function searchGenre(genre) {
    try {
      const r = await fetch(
        `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(genre)}&sessionId=${await sid()}&pageType=Games`,
        { credentials: "include" }
      );
      if (!r.ok) return [];
      const j = await r.json();
      const out = [];
      for (const group of j.searchResults ?? []) {
        for (const g of group.contents ?? []) {
          if (g.universeId) out.push({ name: g.name, universeId: g.universeId, rootPlaceId: g.rootPlaceId, playerCount: g.playerCount });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  // deterministic per-browser daily seed for the picks
  function mulberry32(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
  }
  function localDateKey() {
    const d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function msToMidnight() {
    const now = new Date();
    const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return mid - now;
  }

  async function pickSalt() {
    const { picksSalt } = await CER.ext.storage.local.get("picksSalt");
    if (picksSalt) return picksSalt;
    const salt = String(Math.floor(performance.now() * 1000) % 1e9);
    await CER.ext.storage.local.set({ picksSalt: salt });
    return salt;
  }

  // ---- thumbnails ----
  async function thumbsForUniverses(universeIds) {
    return CER.getGameThumbs([...new Set(universeIds.filter(Boolean).map(String))]);
  }

  function gameCard(g, thumbUrl, m) {
    const card = CER.el("a", "cer-g-card");
    card.href = "https://www.roblox.com/games/" + (g.rootPlaceId || "") + "/";
    const thumb = CER.el("div", "cer-g-thumb");
    if (thumbUrl) thumb.style.backgroundImage = `url(${thumbUrl})`;

    // 3-dots menu, top-right of the thumbnail
    const dots = CER.el("button", "cer-g-dots", "⋯");
    dots.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.querySelector(".cer-g-cardmenu")?.remove();
      const menu = CER.el("div", "cer-g-cardmenu");
      const opts = [
        ["Open game", () => (location.href = card.href)],
        ["Copy link", () => navigator.clipboard?.writeText(card.href).catch(() => {})],
      ];
      for (const [label, fn] of opts) {
        const it = CER.el("button", "cer-g-cardmenu-opt", label);
        it.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          menu.remove();
          fn();
        });
        menu.appendChild(it);
      }
      const r = dots.getBoundingClientRect();
      menu.style.left = Math.min(r.left, window.innerWidth - 170) + "px";
      menu.style.top = r.bottom + 4 + "px";
      document.body.appendChild(menu);
      setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
    });
    thumb.appendChild(dots);
    card.appendChild(thumb);
    card.appendChild(CER.el("div", "cer-g-name", CER.cleanTitle ? CER.cleanTitle(g.name || "", settings.features) : g.name || ""));
    // same meta row as the home cards: like % + players, each with an icon
    const meta = CER.el("div", "cer-g-meta");
    const pct = m?.votesPct;
    if (pct != null) {
      const v = CER.el("span", "cer-g-meta-item");
      v.appendChild(CER.svg("like", 14));
      v.appendChild(CER.el("span", "", pct + "%"));
      meta.appendChild(v);
    }
    const playing = m?.playing ?? g.playerCount;
    if (playing != null) {
      const p = CER.el("span", "cer-g-meta-item");
      p.appendChild(CER.svg("people", 14));
      p.appendChild(CER.el("span", "", Number(playing).toLocaleString()));
      meta.appendChild(p);
    }
    card.appendChild(meta);
    return card;
  }

  // thumbs + votes/players for a row's games (including wildcard picks) so
  // they match the home tiles instead of showing just a raw player count
  async function rowData(games, limit) {
    const list = games.slice(0, limit);
    const uni = list.map((g) => g.universeId);
    const [thumbs, meta] = await Promise.all([
      thumbsForUniverses(uni).catch(() => ({})),
      CER.getGameMeta(uni.filter(Boolean)).catch(() => ({})),
    ]);
    return { list, thumbs, meta };
  }
  function paintRow(container, data) {
    container.textContent = "";
    for (const g of data.list) container.appendChild(gameCard(g, data.thumbs[g.universeId], data.meta[g.universeId]));
  }
  // `isCurrent` is checked after the fetch: a row that was superseded (newer
  // genre) or left behind (SPA exit) must not be painted
  async function renderRow(container, games, limit, isCurrent = alive) {
    const data = await rowData(games, limit);
    if (isCurrent()) paintRow(container, data);
  }

  // ---- build the page ----
  const host = await CER.waitFor(() => document.querySelector("#content, .content"), 15000).catch(() => null);
  if (!host || !location.pathname.startsWith("/charts") || document.querySelector(".cer-games")) {
    if (!document.querySelector(".cer-games")) CER.dismissSkeleton?.(); // show the stock page, never a blank one
    return;
  }

  const root = CER.el("div", "cer-games");
  // still on /charts with our root mounted — every timer and late fetch checks this
  function alive() {
    return root.isConnected && location.pathname.startsWith("/charts");
  }
  const hiddenKids = [];
  for (const c of host.children) {
    hiddenKids.push([c, c.style.display]);
    c.style.display = "none";
  }
  host.appendChild(root);

  // the native charts are killed only once our root exists — if anything
  // above bails, the stock page stays visible
  const kill = document.createElement("style");
  kill.id = "cer-games-kill";
  kill.textContent = `#charts, .charts-page, .games-list-container, .home-header { display:none !important; }`;
  document.documentElement.appendChild(kill);

  // Roblox renders the native charts INTO #content AFTER we've built ours (that's
  // the "clicked Games, got the old page" race) — keep everything but our root
  // hidden on every re-render.
  const hostObs = new MutationObserver(() => {
    if (!location.pathname.startsWith("/charts")) return teardown(); // don't touch other pages
    for (const c of host.children) {
      if (c !== root && c.style.display !== "none") c.style.display = "none";
    }
    if (!root.isConnected) host.appendChild(root);
  });
  hostObs.observe(host, { childList: true });

  const main = CER.el("div", "cer-games-main");
  const side = CER.el("aside", "cer-games-side");
  root.appendChild(main);
  root.appendChild(side);

  // leaving /charts in-app: stop every timer and give the page back (the kill
  // style would otherwise keep hiding .home-header etc. on the next page)
  let tornDown = false;
  let picksTimer = null;
  function teardown() {
    if (tornDown) return;
    tornDown = true;
    hostObs.disconnect();
    stopCarousel();
    clearInterval(picksTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    kill.remove();
    root.remove();
    for (const [c, display] of hiddenKids) if (c.isConnected) c.style.display = display;
    if (cerGamesTeardown === teardown) cerGamesTeardown = null;
  }
  cerGamesTeardown = teardown;

  // --- Top Experiences ---
  main.appendChild(CER.el("h2", "cer-g-h2", "Top Games"));
  const topRow = CER.el("div", "cer-g-grid");
  main.appendChild(topRow);
  topRow.appendChild(CER.skelGrid(6, 140, 250));
  fetchSort("top-playing-now").then((games) => renderRow(topRow, games, 12));

  // --- Trending in X (genre carousel) ---
  const trendHead = CER.el("div", "cer-g-trendhead");
  const trendTitle = CER.el("h2", "cer-g-h2", "Trending in ");
  const genrePill = CER.el("button", "cer-g-genre");
  const genreLabel = CER.el("span", "cer-g-genre-label");
  genrePill.appendChild(genreLabel);
  trendTitle.appendChild(genrePill);
  trendHead.appendChild(trendTitle);
  main.appendChild(trendHead);
  const trendRow = CER.el("div", "cer-g-grid");
  main.appendChild(trendRow);

  let genreIdx = 0;
  let genreSeq = 0;
  let carouselTimer = null;
  let stopped = false;
  const cover = CER.el("span", "cer-g-genre-cover");
  genrePill.appendChild(cover);

  // each genre's row data is fetched once per visit and reused on every lap
  // of the carousel (it used to refetch 3 APIs every 15 s, forever)
  const genreCache = new Map();
  function loadGenre(genre) {
    if (!genreCache.has(genre)) {
      const p = searchGenre(genre).then((games) => rowData(games, 12));
      p.then((d) => { if (!d.list.length) genreCache.delete(genre); }); // don't cache an empty/failed answer
      genreCache.set(genre, p);
    }
    return genreCache.get(genre);
  }

  async function showGenre(i) {
    // the carousel timer fires this without awaiting, so a slow genre fetch can
    // still be in flight when the next tick starts. Tag each call and bail if a
    // newer one has since started, so overlapping fetches can't clobber the row.
    const seq = ++genreSeq;
    genreIdx = ((i % GENRES.length) + GENRES.length) % GENRES.length;
    const genre = GENRES[genreIdx];
    genreLabel.textContent = genre + " ▾"; // the pill shows what it's sorting
    const pending = loadGenre(genre);
    // only flash the skeleton when the data isn't already here
    const ready = await Promise.race([pending.then(() => true), new Promise((r) => setTimeout(() => r(false), 30))]);
    if (!ready && seq === genreSeq) {
      trendRow.textContent = "";
      trendRow.appendChild(CER.skelGrid(6, 140, 250));
    }
    const data = await pending;
    if (seq !== genreSeq || !alive()) return; // superseded, or we left /charts
    paintRow(trendRow, data);
  }

  function startCarousel() {
    stopCarousel();
    if (stopped || !alive()) return;
    let elapsed = 0;
    const STEP = 100;
    const TOTAL = 15000;
    carouselTimer = setInterval(() => {
      if (!alive()) return stopCarousel(); // stop after leaving /charts (onNavigate tears down)
      if (document.hidden) return; // paused in background tabs
      elapsed += STEP;
      cover.style.width = ((1 - elapsed / TOTAL) * 100).toFixed(1) + "%";
      // warm the next genre a few seconds early so the swap is instant
      if (elapsed === TOTAL - 3000) loadGenre(GENRES[(genreIdx + 1) % GENRES.length]);
      if (elapsed >= TOTAL) {
        elapsed = 0;
        showGenre(genreIdx + 1);
      }
    }, STEP);
  }
  function stopCarousel() {
    if (carouselTimer) clearInterval(carouselTimer);
    carouselTimer = null;
  }
  // a hidden tab doesn't need the timer ticking at all
  function onVisibility() {
    if (document.hidden) stopCarousel();
    else if (!stopped && alive() && !carouselTimer) startCarousel();
  }
  document.addEventListener("visibilitychange", onVisibility);

  // dropdown to pick a genre (stops the carousel)
  genrePill.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelector(".cer-g-genremenu")?.remove();
    const menu = CER.el("div", "cer-g-genremenu");
    GENRES.forEach((gname, i) => {
      const it = CER.el("button", "cer-g-genreopt", gname);
      it.addEventListener("click", () => {
        stopped = true;
        stopCarousel();
        cover.style.width = "0%";
        menu.remove();
        showGenre(i);
      });
      menu.appendChild(it);
    });
    const r = genrePill.getBoundingClientRect();
    menu.style.left = r.left + "px";
    menu.style.top = r.bottom + 4 + "px";
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
  });

  trendRow.appendChild(CER.skelGrid(6, 140, 250));
  showGenre(0).then(() => {
    if (!document.hidden) startCarousel();
  });

  // --- Canardev's picks ---
  // title + countdown share one line (timer sits right after the heading)
  const picksHead = CER.el("div", "cer-g-trendhead cer-g-pickshead");
  const picksTitle = CER.el("h2", "cer-g-h2 cer-g-picks-h", "Canardev's picks");
  const picksSub = CER.el("span", "cer-g-pickssub");
  picksTitle.appendChild(picksSub); // timer is part of the title line, not a flex sibling
  picksHead.appendChild(picksTitle);
  main.appendChild(picksHead);
  const picksRow = CER.el("div", "cer-g-grid");
  main.appendChild(picksRow);

  picksRow.appendChild(CER.skelGrid(3, 140, 250));

  (async () => {
    // Everything that doesn't depend on today's draw starts at once: the
    // salt, the front-page list (for wildcards) and all list picks' universe
    // ids (cached in storage after the first visit). It used to be 5 serial steps.
    const [salt, trending, uni] = await Promise.all([
      pickSalt(),
      fetchSort("top-trending"),
      CER.getUniverseIds(PICK_PLACES).catch(() => ({})),
    ]);
    if (!alive()) return;
    const rng = mulberry32(salt + localDateKey());
    // shuffle the list deterministically, take 3
    const pool = [...PICK_PLACES];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let chosenPlaces = pool.slice(0, 3);
    // wildcard: chance to swap 1–2 for a current front-page game not in the list
    const wilds = rng() < 0.6 ? (rng() < 0.5 ? 1 : 2) : 0;
    const frontGames = wilds ? trending.filter((g) => !PICK_PLACES.includes(String(g.rootPlaceId))) : [];
    for (let w = 0; w < wilds && frontGames.length; w++) {
      const pick = frontGames[Math.floor(rng() * frontGames.length)];
      chosenPlaces[w] = "wild:" + pick.rootPlaceId + ":" + pick.universeId + ":" + pick.name;
    }

    const games = chosenPlaces.map((p) => {
      if (p.startsWith("wild:")) {
        const [, place, universe, ...name] = p.split(":");
        return { rootPlaceId: place, universeId: universe, name: name.join(":") };
      }
      return { rootPlaceId: p, universeId: uni[p], name: "" };
    });
    // names for list picks come from the game details — fetched alongside the
    // row's thumbs + meta instead of before them
    const namesP = (async () => {
      const ids = games.filter((g) => !g.name).map((g) => g.universeId).filter(Boolean);
      if (!ids.length) return;
      const r = await fetch("https://games.roblox.com/v1/games?universeIds=" + ids.join(","), { credentials: "include" });
      if (!r.ok) return;
      const byId = {};
      for (const d of (await r.json()).data ?? []) byId[d.id] = d;
      for (const g of games) if (!g.name && byId[g.universeId]) { g.name = byId[g.universeId].name; g.playerCount = byId[g.universeId].playing; }
    })().catch(() => {});
    const [data] = await Promise.all([rowData(games, 3), namesP]);
    if (!alive()) return;
    paintRow(picksRow, data);

    // countdown to local midnight — HH:MM:SS so it doesn't read like minutes
    function tick() {
      const ms = msToMidnight();
      const h = Math.floor(ms / 3.6e6);
      const m = Math.floor((ms % 3.6e6) / 6e4);
      const s = Math.floor((ms % 6e4) / 1000);
      const p = (n) => String(n).padStart(2, "0");
      picksSub.textContent = "Changes in " + p(h) + ":" + p(m) + ":" + p(s);
    }
    tick();
    picksTimer = setInterval(() => {
      if (!alive()) return clearInterval(picksTimer); // stop after leaving /charts
      tick();
    }, 1000);
  })();

  // --- friend sidebar: what your friends are playing ---
  side.appendChild(CER.el("h2", "cer-g-sideh", "Friends' games"));
  const sideList = CER.el("div", "cer-g-sidelist");
  side.appendChild(sideList);
  sideList.appendChild(CER.el("p", "cer-hint", "Loading…"));

  // the shell (headings + skeleton rows) is up — lift the page veil now,
  // the rows fill in on their own
  CER.skelDone?.("games");

  (async () => {
    const me = await meP;
    if (!alive()) return;
    if (!me?.id) { sideList.textContent = ""; sideList.appendChild(CER.el("p", "cer-hint", "No friends online right now.")); return; }
    try {
      const fr = await fetch(`https://friends.roblox.com/v1/users/${me.id}/friends`, { credentials: "include" });
      if (!fr.ok) throw new Error("friends " + fr.status);
      const friends = (await fr.json()).data ?? [];
      const ids = friends.map((f) => f.id);
      const pres = ids.length ? (await CER.bgFetch("https://presence.roblox.com/v1/presence/users", "POST", { userIds: ids })).data?.userPresences ?? [] : [];
      const inGame = pres.filter((p) => p.userPresenceType === 2 && p.universeId && p.placeId);
      if (!alive()) return;
      if (!inGame.length) { sideList.textContent = ""; sideList.appendChild(CER.el("p", "cer-hint", "No friends online right now.")); return; }
      // names, game thumbs and headshots don't depend on each other
      const nameById = {};
      const heads = {};
      const [thumbs] = await Promise.all([
        thumbsForUniverses(inGame.map((p) => p.universeId)).catch(() => ({})),
        (async () => {
          const nr = await CER.robloxWrite("https://users.roblox.com/v1/users", "POST", { userIds: inGame.map((p) => p.userId), excludeBannedUsers: false });
          if (!nr?.ok) return;
          for (const u of (await nr.json()).data ?? []) nameById[u.id] = u.displayName || u.name;
        })().catch(() => {}),
        (async () => {
          const hr = await fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + inGame.map((p) => p.userId).join(",") + "&size=48x48&format=Png&isCircular=true", { credentials: "include" });
          if (!hr.ok) return;
          for (const d of (await hr.json()).data ?? []) heads[d.targetId] = d.imageUrl;
        })().catch(() => {}),
      ]);
      if (!alive()) return;
      sideList.textContent = "";
      for (const p of inGame) {
        const item = CER.el("a", "cer-g-friendgame");
        item.href = "https://www.roblox.com/games/" + p.placeId + "/";
        item.appendChild(CER.el("div", "cer-g-friendlabel", (nameById[p.userId] || "A friend") + " is playing:"));
        const t = CER.el("div", "cer-g-friendthumb");
        if (thumbs[p.universeId]) t.style.backgroundImage = `url(${thumbs[p.universeId]})`;
        const head = CER.el("img", "cer-g-friendhead");
        head.src = heads[p.userId] ?? "";
        t.appendChild(head);
        item.appendChild(t);
        item.appendChild(CER.el("div", "cer-g-friendname", p.lastLocation || ""));
        sideList.appendChild(item);
      }
    } catch {
      if (!alive()) return;
      sideList.textContent = "";
      sideList.appendChild(CER.el("p", "cer-hint", "Couldn't load friends."));
    }
  })();
  }

  // content scripts only run once per full load; on SPA navigation to /charts
  // the initial run already bailed (wrong path), so re-run on every nav — the
  // internal guards make it a no-op when it's already built or off-charts.
  runGamesRedesign();
  CER.onNavigate?.(() => {
    if (location.pathname.startsWith("/charts")) runGamesRedesign();
    else cerGamesTeardown?.(); // left /charts in-app: stop timers, restore the page
  });
})();
