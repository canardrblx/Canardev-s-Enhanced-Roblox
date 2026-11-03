// CER discover page (/charts, /discover). Built on CER.ui (content/ui.js).
//
//   genre chips → FEATURED hero (rotates every 8 s) → ranked "Top games",
//   Canardev's picks, more explore-api rails | right column: friends' games.
//
// Data: explore-api get-sorts (one call gives five 100-game lists, each game
// with players, votes and its genre) + get-sort-content for single lists.
// Genres with an explore genre filter the lists we already have (instant) and
// add that genre's "Trending in" list; keyword genres (Tower Defense, Horror..)
// use omni-search. Roblox is only a data source here; nothing reads its DOM.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;

  const EX = "https://apis.roblox.com/explore-api/v1";
  const TTL = 3 * 60 * 1000;
  const SID = (() => {
    try {
      let s = localStorage.getItem("cer:exploreSid");
      if (!s) localStorage.setItem("cer:exploreSid", (s = "cer-" + Math.random().toString(36).slice(2, 12)));
      return s;
    } catch {
      return "cer-discover";
    }
  })();

  // l1 = explore-api genreL1 (filter the lists we have) + its trending sort.
  // q = keyword genre (omni-search) + a name test for the lists we have.
  const GENRES = [
    { id: "all", label: "All" },
    { id: "roleplay", label: "Roleplay", l1: "Roleplay & Avatar Sim", sort: "trending-in-roleplay-and-avatar-sim" },
    { id: "obby", label: "Obby", l1: "Obby & Platformer", sort: "trending-in-obby-and-platformer" },
    { id: "simulator", label: "Simulator", l1: "Simulation", sort: "trending-in-simulation" },
    { id: "td", label: "Tower Defense", q: "tower defense", match: /tower\s*defen[cs]e|\bTD\b/i },
    { id: "survival", label: "Survival", l1: "Survival", sort: "trending-in-survival" },
    { id: "fighting", label: "Fighting", q: "fighting", match: /fight|battle|combat|boxing|brawl|punch/i },
    { id: "horror", label: "Horror", q: "horror", match: /horror|scary|doors|piggy|backrooms|nightmare|survive the killer/i },
    { id: "tycoon", label: "Tycoon", q: "tycoon", match: /tycoon/i },
    { id: "sports", label: "Sports", l1: "Sports & Racing", sort: "trending-in-sports-and-racing" },
    { id: "adventure", label: "Adventure", l1: "Adventure", sort: "trending-in-adventure" },
    { id: "rpg", label: "RPG", l1: "RPG", sort: "trending-in-rpg" },
    { id: "shooter", label: "Shooter", l1: "Shooter", sort: "trending-in-shooter" },
    { id: "action", label: "Action", l1: "Action", sort: "trending-in-action" },
    { id: "strategy", label: "Strategy", l1: "Strategy", sort: "trending-in-strategy" },
    { id: "puzzle", label: "Puzzle", l1: "Puzzle", sort: "trending-in-puzzle" },
    { id: "party", label: "Party", l1: "Party & Casual", sort: "trending-in-party-and-casual" },
    { id: "shopping", label: "Shopping", l1: "Shopping", sort: "trending-in-shopping" },
  ];

  // Canardev's picks: place ids, 3 a day (seeded per browser + date), with a
  // chance of a trending wildcard. Same list + seed as the old /charts page.
  const PICK_PLACES = ["78515283254292", "17625359962", "97598239454123", "142823291", "82958998841721", "3260590327", "606849621", "537413528", "6872265039", "14564651437"];

  // ------------------------------------------------------------ data
  const norm = (x) =>
    x && x.universeId && x.rootPlaceId && !x.isSponsored
      ? {
          universeId: x.universeId,
          placeId: x.rootPlaceId,
          name: x.name ?? "",
          playing: x.playerCount ?? null,
          rating: fmt.pct(x.totalUpVotes, x.totalDownVotes),
          votes: (x.totalUpVotes ?? 0) + (x.totalDownVotes ?? 0),
          genre: x.genreL1 || null,
        }
      : null;
  const normList = (arr) => (arr ?? []).map(norm).filter(Boolean);

  // our own compact cache (raw explore answers are too big for sessionStorage)
  function cacheGet(k) {
    try {
      const o = JSON.parse(sessionStorage.getItem("cer:dc:" + k));
      return o && Date.now() - o.t < TTL ? o.v : null;
    } catch {
      return null;
    }
  }
  function cacheSet(k, v) {
    try {
      sessionStorage.setItem("cer:dc:" + k, JSON.stringify({ t: Date.now(), v }));
    } catch {
      /* quota: fine */
    }
  }
  const inflight = new Map();
  function once(k, fn) {
    if (!inflight.has(k)) {
      const p = fn().then((v) => {
        if (v == null) inflight.delete(k); // let a retry refetch
        return v;
      });
      inflight.set(k, p);
    }
    return inflight.get(k);
  }

  // first get-sorts page: { sortId: games[] } (top-trending, up-and-coming,
  // top-playing-now, fun-with-friends, top-revisited)
  const loadFront = () =>
    once("front", async () => {
      const hit = cacheGet("front");
      if (hit) return hit;
      const j = await api.json(`${EX}/get-sorts?sessionId=${SID}&device=computer&country=all`);
      if (!j?.sorts) return null;
      const out = {};
      for (const s of j.sorts) if (s.contentType === "Games" && s.games?.length) out[s.sortId] = normList(s.games);
      if (!Object.keys(out).length) return null;
      cacheSet("front", out);
      return out;
    });
  const loadSort = (id) =>
    once("sort:" + id, async () => {
      const hit = cacheGet("sort:" + id);
      if (hit) return hit;
      const j = await api.json(`${EX}/get-sort-content?sessionId=${SID}&sortId=${id}&device=computer&country=all`);
      if (!j?.games) return null;
      const out = normList(j.games);
      cacheSet("sort:" + id, out);
      return out;
    });
  const loadSearch = (q) =>
    once("q:" + q, async () => {
      const hit = cacheGet("q:" + q);
      if (hit) return hit;
      const j = await api.json(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&sessionId=${SID}&pageType=Games`);
      if (!j?.searchResults) return null;
      const out = normList(j.searchResults.flatMap((r) => (r.contentGroupType === "Game" ? r.contents ?? [] : [])));
      cacheSet("q:" + q, out);
      return out;
    });

  const dedupe = (lists) => {
    const seen = new Map();
    for (const g of lists.flat()) if (g && !seen.has(g.universeId)) seen.set(g.universeId, g);
    return [...seen.values()];
  };
  const byPlaying = (a, b) => (b.playing ?? 0) - (a.playing ?? 0);
  // ------------------------------------------------------------ state
  const S = { root: null, genre: "all", seq: 0 };
  const alive = (root) => root && root.isConnected && document.getElementById("cer-app") === root;
  const savedGenre = () => {
    try {
      const g = sessionStorage.getItem("cer:dc:genre");
      return GENRES.some((x) => x.id === g) ? g : "all";
    } catch {
      return "all";
    }
  };

  ui.route("discover", async () => {
    // Roblox's own (hidden) charts app rewrites the query string after load;
    // that re-runs us, but the page we built is still the right one.
    if (alive(S.root)) return;
    const { root, page } = ui.page("discover");
    S.root = root;
    S.genre = savedGenre();
    // works logged out too: only the friends column needs an account
    build(root, page);
  });

  // ------------------------------------------------------------ page
  function build(root, page) {
    const chipRow = ui.chips(
      GENRES.map((g) => ({ id: g.id, label: g.label })),
      S.genre,
      (id) => selectGenre(id)
    );
    chipRow.classList.add("dc-chip-row");
    const chipWrap = h("div", { class: "dc-chips" }, chipRow);
    // vertical wheel scrolls the chip row sideways; edge fades follow scroll
    chipRow.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && chipRow.scrollWidth > chipRow.clientWidth) {
          chipRow.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false }
    );
    const syncFade = () => {
      chipWrap.classList.toggle("fade-l", chipRow.scrollLeft > 4);
      chipWrap.classList.toggle("fade-r", chipRow.scrollLeft + chipRow.clientWidth < chipRow.scrollWidth - 4);
    };
    chipRow.addEventListener("scroll", syncFade, { passive: true });
    // a remembered genre far right in the row: bring its chip into view
    requestAnimationFrame(() => {
      const on = chipRow.querySelector(".is-active");
      if (on && on.offsetLeft + on.offsetWidth > chipRow.clientWidth) chipRow.scrollLeft = on.offsetLeft - chipRow.clientWidth / 2;
    });
    new ResizeObserver(syncFade).observe(chipRow);

    const heroSlot = h("div", { class: "dc-hero-slot" }, ui.skeleton("hero"));
    const rails = h("div", { class: "dc-rails" }, skeletonSections(3));
    const allView = h("div", { class: "dc-all", hidden: true });
    const main = [heroSlot, rails, allView];
    const side = friendsColumn(root);
    page.append(
      chipWrap,
      ui.cols(main, side, { side: 300 })
    );
    // the hero spans the main column; on wide screens it sits beside friends
    S.heroSlot = heroSlot;
    S.rails = rails;
    S.allView = allView;
    S.chipRow = chipRow;
    S.hero = null;
    render(root);
  }

  function selectGenre(id) {
    S.genre = id;
    try {
      sessionStorage.setItem("cer:dc:genre", id);
    } catch {
      /* fine */
    }
    closeAll();
    render(S.root);
  }

  function skeletonSections(n) {
    return Array.from({ length: n }, () => {
      const s = ui.section(" ", { class: "dc-sk-section" });
      s.head.replaceChildren(h("div", { class: "cer-sk cer-sk-line dc-sk-title" }));
      s.body.append(ui.rail(ui.skeleton("card", 6), { item: 250 }));
      return s;
    });
  }

  // Build the hero + rails for the current genre. Every await re-checks seq so
  // a quick second chip click wins.
  async function render(root) {
    const seq = ++S.seq;
    const genre = GENRES.find((g) => g.id === S.genre) ?? GENRES[0];
    const ok = () => seq === S.seq && alive(root);

    const front = loadFront();
    // instant when the lists are cached; otherwise show skeletons first
    const quick = await Promise.race([front, api.sleep(40).then(() => undefined)]);
    if (!ok()) return;
    if (quick === undefined) {
      ui.clear(S.rails, skeletonSections(3));
      if (S.hero) S.hero.loading(true);
    }
    const lists = await front;
    if (!ok()) return;

    if (genre.id === "all") {
      if (!lists) return failed(root);
      const top = lists["top-playing-now"] ?? [];
      const trending = lists["top-trending"] ?? [];
      showHero(trending.length ? trending : top);
      ui.clear(S.rails, 
        railSection("Top games", top, { rank: true, item: 280 }),
        picksSection(root, trending),
        railSection("Trending", trending),
        railSection("Up and coming", lists["up-and-coming"]),
        railSection("Fun with friends", lists["fun-with-friends"])
      );
      return;
    }

    const pool = lists ? dedupe(Object.values(lists)) : [];
    const name = genre.label;
    if (genre.l1) {
      const inGenre = (list) => (list ?? []).filter((g) => g.genre === genre.l1);
      const trendP = loadSort(genre.sort);
      let fromPool = inGenre(pool).sort(byPlaying);
      let trendSlot = null;
      if (fromPool.length < 4) {
        // too little in the lists we have: wait for the genre's own list
        ui.clear(S.rails, skeletonSections(3));
        if (S.hero) S.hero.loading(true);
        const trend = await trendP;
        if (!ok()) return;
        fromPool = dedupe([fromPool, trend ?? []]).sort(byPlaying);
        if (!fromPool.length) return trend ? noGames(name) : failed(root);
        trendSlot = railSection("Trending", trend);
      } else trendSlot = h("div", { class: "dc-lazy" }, skeletonSections(1));
      showHero(fromPool);
      ui.clear(
        S.rails,
        railSection(`Top ${name} games`, fromPool.slice(0, 30), { rank: true, item: 280 }),
        trendSlot,
        railSection("Up and coming", inGenre(lists?.["up-and-coming"]))
      );
      if (trendSlot?.classList.contains("dc-lazy")) {
        const trend = await trendP;
        if (!ok()) return;
        const s = railSection("Trending", trend);
        if (s) trendSlot.replaceWith(s);
        else trendSlot.remove();
      }
      return;
    }

    // keyword genre: omni-search + games from the lists whose name matches
    const fromPool = pool.filter((g) => genre.match.test(g.name));
    if (fromPool.length < 4) {
      ui.clear(S.rails, skeletonSections(3));
      if (S.hero) S.hero.loading(true);
    }
    const found = await loadSearch(genre.q);
    if (!ok()) return;
    if (!found && !fromPool.length) return failed(root);
    const all = dedupe([fromPool, found ?? []]).sort(byPlaying);
    if (!all.length) return noGames(name);
    const top = all.slice(0, 30);
    const topIds = new Set(top.slice(0, 20).map((g) => g.universeId));
    showHero(all);
    ui.clear(S.rails, 
      railSection(`Top ${name} games`, top, { rank: true, item: 280 }),
      railSection("More to try", (found ?? []).filter((g) => !topIds.has(g.universeId)))
    );
  }

  function failed(root) {
    if (S.hero) S.hero.loading(false);
    S.heroSlot.hidden = true;
    ui.clear(S.rails, 
      ui.empty("Games did not load.", {
        icon: "refresh",
        action: ui.button("Try again", {
          onClick: () => {
            S.heroSlot.hidden = false;
            render(root);
          },
        }),
      })
    );
  }
  function noGames(name) {
    if (S.hero) S.hero.loading(false);
    S.heroSlot.hidden = true;
    ui.clear(S.rails, ui.empty(`No ${name} games right now.`, { icon: "gamepad" }));
  }

  // ------------------------------------------------------------ rails
  function railSection(title, list, opts = {}) {
    const full = list ?? [];
    const games = full.slice(0, opts.max ?? 24);
    if (games.length < 3) return null;
    const s = ui.section(title, {
      class: "dc-section",
      action: full.length > 4 && { label: "See all", onClick: () => openAll(title, full, opts) },
    });
    const rail = ui.rail(ui.skeleton("card", 6), { item: opts.item ?? 250 });
    s.body.append(rail);
    // cards (and their thumbnail fetches) only when the rail nears the screen
    ui.whenVisible(s, () => rail.track.replaceChildren(...games.map((g, i) => ui.gameCard(g, { rank: opts.rank ? i + 1 : null }))));
    return s;
  }
  // "See all": the whole list as a grid, in place (Back returns to the rails)
  function openAll(title, games, opts) {
    S.allView.replaceChildren(
      h(
        "div",
        { class: "dc-all-head" },
        ui.button("", { icon: "arrowLeft", variant: "soft", title: "Back", onClick: closeAll }),
        h("h2", { class: "cer-block-title", text: title })
      ),
      ui.grid(
        games.map((g, i) => ui.gameCard(g, { rank: opts.rank ? i + 1 : null })),
        { min: 230, gap: 20 }
      )
    );
    S.heroSlot.classList.add("is-away");
    S.rails.hidden = true;
    S.allView.hidden = false;
    window.scrollTo({ top: 0 });
  }
  function closeAll() {
    if (!S.allView || S.allView.hidden) return;
    S.allView.hidden = true;
    S.allView.replaceChildren();
    S.heroSlot.classList.remove("is-away");
    S.rails.hidden = false;
  }

  // ------------------------------------------------------------ hero
  // One hero element, reused across genres: content swaps with a short fade
  // and the backdrop cross-fades. The active dot's fill bar is the timer: its
  // animation runs 8 s (paused on hover via CSS) and its end advances.
  function showHero(games) {
    const list = games.filter((g) => g.placeId).slice(0, 5);
    S.heroSlot.hidden = !list.length;
    if (!list.length) return;
    if (!S.hero) {
      S.hero = makeHero();
      S.heroSlot.replaceChildren(S.hero.el);
    }
    S.hero.set(list);
  }

  function makeHero() {
    const players = h("span", { text: "" });
    const rating = h("span", { text: "" });
    const ratingWrap = h("span", { class: "cer-hero-stat" }, ui.icon("like", 16), rating);
    const stats = h("div", { class: "cer-hero-stats" }, h("span", { class: "cer-hero-stat" }, ui.icon("users", 16), players), ratingWrap);
    let current = null;
    const play = ui.button("Play", { icon: "play", variant: "light", size: "lg", onClick: () => current && ui.play(current.placeId) });
    const dots = h("div", { class: "dc-dots", role: "tablist" });
    const artImg = h("img", { class: "dc-art-img", alt: "", draggable: "false", decoding: "async" });
    const artLink = h("a", { class: "dc-art-link", href: "#", tabindex: "-1", "aria-hidden": "true" }, artImg);
    const hero = ui.hero({
      class: "dc-hero",
      title: "",
      art: artLink,
      children: [stats, h("div", { class: "cer-hero-actions" }, play), dots],
    });
    // the title is the way to the game page (no extra "info" button)
    const titleH = hero.querySelector(".cer-hero-title");
    const title = h("a", { class: "dc-hero-link", href: "#" });
    titleH.append(title);
    const body = hero.querySelector(".cer-hero-body");

    let list = [];
    let lastSig = "";
    let idx = 0;
    let token = 0;
    const urls = new Map();
    const urlOf = (g) => {
      if (!urls.has(g.universeId)) urls.set(g.universeId, api.thumb("gameThumb", g.universeId));
      return urls.get(g.universeId);
    };
    const preload = (url) =>
      url
        ? new Promise((res) => {
            const im = new Image();
            im.onload = im.onerror = () => res();
            im.src = url;
            setTimeout(res, 1500);
          })
        : Promise.resolve();

    const paintDots = () => {
      dots.replaceChildren(
        ...list.map((g, i) => {
          const d = h(
            "button",
            {
              type: "button",
              class: "dc-dot" + (i === idx ? " is-on" : ""),
              title: CER.cleanTitle(g.name, CER._featsCache ?? {}),
              "aria-label": "Show game " + (i + 1),
              onClick: () => i !== idx && go(i),
            },
            h("span", { class: "dc-dot-fill" })
          );
          if (i === idx && list.length > 1) d.firstChild.addEventListener("animationend", () => go((idx + 1) % list.length), { once: true });
          return d;
        })
      );
    };

    async function go(i, first) {
      const my = ++token;
      idx = i;
      const g = list[i];
      paintDots();
      const url = await urlOf(g);
      if (!first) {
        body.classList.add("is-swapping");
        await Promise.all([preload(url), api.sleep(170)]);
      } else await preload(url);
      if (my !== token) return;
      current = g;
      const name = CER.cleanTitle(g.name, CER._featsCache ?? {});
      title.textContent = name;
      title.title = g.name;
      titleH.title = g.name;
      players.textContent = g.playing != null ? fmt.num(g.playing) : "–";
      rating.textContent = g.rating != null ? g.rating + "%" : "";
      ratingWrap.hidden = g.rating == null;
      const href = "https://www.roblox.com/games/" + g.placeId;
      title.href = href;
      artLink.href = href;
      play.setAttribute("aria-label", "Play " + name);
      hero.setImage(url);
      if (url) artImg.src = url;
      artImg.classList.toggle("is-none", !url);
      hero.classList.remove("is-loading");
      body.classList.remove("is-swapping");
    }

    // pause the timer while the pointer is on the hero or the tab is hidden
    hero.addEventListener("mouseenter", () => hero.classList.add("is-paused"));
    hero.addEventListener("mouseleave", () => hero.classList.remove("is-paused"));
    hero.addEventListener("focusin", () => hero.classList.add("is-paused"));
    hero.addEventListener("focusout", () => hero.classList.remove("is-paused"));

    return {
      el: hero,
      set(games) {
        const sig = games.map((g) => g.universeId).join();
        if (sig === lastSig) return hero.classList.remove("is-loading");
        lastSig = sig;
        list = games;
        hero.classList.toggle("is-single", list.length < 2);
        for (const g of list.slice(1)) urlOf(g); // warm the next thumbnails
        go(0, !current);
      },
      loading(on) {
        hero.classList.toggle("is-loading", on);
      },
    };
  }

  // ------------------------------------------------------------ picks
  function mulberry32(seedStr) {
    let hh = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
      hh = Math.imul(hh ^ seedStr.charCodeAt(i), 3432918353);
      hh = (hh << 13) | (hh >>> 19);
    }
    return function () {
      hh = Math.imul(hh ^ (hh >>> 16), 2246822507);
      hh = Math.imul(hh ^ (hh >>> 13), 3266489909);
      return ((hh ^= hh >>> 16) >>> 0) / 4294967296;
    };
  }
  async function pickSalt() {
    try {
      const { picksSalt } = await CER.ext.storage.local.get("picksSalt");
      if (picksSalt) return picksSalt;
      const salt = String(Math.floor(performance.now() * 1000) % 1e9);
      await CER.ext.storage.local.set({ picksSalt: salt });
      return salt;
    } catch {
      return "0";
    }
  }
  const dateKey = () => {
    const d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  };

  function picksSection(root, trending) {
    const s = ui.section("Canardev's picks", { class: "dc-section dc-picks" });
    const rail = ui.rail(ui.skeleton("card", 3), { item: 320 });
    const grid = rail.track;
    s.body.append(rail);
    (async () => {
      const [salt, uni] = await Promise.all([pickSalt(), CER.getUniverseIds(PICK_PLACES).catch(() => ({}))]);
      const rng = mulberry32(salt + dateKey());
      const pool = [...PICK_PLACES];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const games = pool.slice(0, 3).map((p) => ({ placeId: Number(p), universeId: uni[p] }));
      // wildcard: sometimes swap 1 or 2 for a trending game not on the list
      const wilds = rng() < 0.6 ? (rng() < 0.5 ? 1 : 2) : 0;
      const front = wilds ? trending.filter((g) => !PICK_PLACES.includes(String(g.placeId))) : [];
      for (let w = 0; w < wilds && front.length; w++) games[w] = { ...front[Math.floor(rng() * front.length)] };
      await ui.hydrateGames(games);
      if (!s.isConnected) return;
      const ready = games.filter((g) => g.universeId && g.name);
      if (!ready.length) return s.remove();
      else grid.replaceChildren(...ready.map((g) => ui.gameCard(g, { size: "lg" })));
    })();
    return s;
  }

  // ------------------------------------------------------------ friends
  function friendsColumn(root) {
    const list = h("div", { class: "dc-fg-list" }, ui.skeleton("row", 4));
    const box = h("div", { class: "dc-fg" }, h("h2", { class: "cer-block-title dc-fg-title", text: "Friends' games" }), list);
    const note = (text) => list.replaceChildren(h("p", { class: "dc-fg-note", text }));
    let friends = null;
    const load = async () => {
      if (!alive(root)) return;
      const me = await api.me();
      if (!me) return note("Log in to see what friends play.");
      if (!friends) friends = await api.friends(me.id);
      if (!alive(root)) return;
      if (!friends?.length) {
        note("Add friends to see what they play.");
        return;
      }
      const pres = await api.presence(friends.map((f) => f.id));
      if (!alive(root)) return;
      if (!pres.size) {
        note("Friends did not load.");
        return;
      }
      // group friends by the game they are in
      const games = new Map();
      for (const f of friends) {
        const p = pres.get(String(f.id));
        if (p?.userPresenceType !== 2 || !p.placeId) continue;
        const key = String(p.universeId ?? p.rootPlaceId ?? p.placeId);
        if (!games.has(key)) games.set(key, { universeId: p.universeId, placeId: p.rootPlaceId ?? p.placeId, name: p.lastLocation, people: [] });
        games.get(key).people.push({ ...f, gameId: p.gameId, placeId: p.placeId });
      }
      const rows = [...games.values()].sort((a, b) => b.people.length - a.people.length);
      if (!rows.length) {
        note("No friends are playing right now.");
        return;
      }
      // presence hides some universe ids: look them up so icons still show
      await Promise.all(rows.filter((r) => !r.universeId).map(async (r) => (r.universeId = await api.universeOf(r.placeId))));
      if (!alive(root)) return;
      list.replaceChildren(...rows.map(friendGameRow));
    };
    load();
    const t = setInterval(() => {
      if (!alive(root)) return clearInterval(t);
      if (!document.hidden) load();
    }, 60000);
    return box;
  }

  function friendGameRow(g) {
    const href = "https://www.roblox.com/games/" + g.placeId;
    const name = CER.cleanTitle(g.name || "A game", CER._featsCache ?? {});
    const shown = g.people.slice(0, 4);
    const names = g.people.map((p) => p.displayName || p.name).filter(Boolean);
    const who = names.length <= 2 ? names.join(" and ") : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
    const joinable = g.people.find((p) => p.gameId);
    return h(
      "div",
      { class: "dc-fg-row" },
      h("a", { class: "dc-fg-icon", href, title: g.name }, ui.thumb("gameIcon", g.universeId, { alt: "" })),
      h(
        "div",
        { class: "dc-fg-main" },
        h("a", { class: "dc-fg-name", href, text: name, title: g.name }),
        h(
          "div",
          { class: "dc-fg-people" },
          h(
            "span",
            { class: "dc-stack" },
            shown.map((p) => h("a", { href: `https://www.roblox.com/users/${p.id}/profile`, title: p.displayName || p.name }, ui.avatar(p.id, { size: 26 }))),
            g.people.length > shown.length && h("span", { class: "dc-stack-more", text: "+" + (g.people.length - shown.length) })
          ),
          h("span", { class: "dc-fg-who", text: who, title: names.join(", ") })
        )
      ),
      ui.button("Join", {
        variant: "soft",
        size: "sm",
        class: "dc-fg-join",
        title: joinable ? "Join " + (joinable.displayName || joinable.name) : "Play " + name,
        onClick: () => (joinable ? ui.play(joinable.placeId ?? g.placeId, joinable.gameId) : ui.play(g.placeId)),
      })
    );
  }
})();
