// CER home page (/home). Built only from CER.ui pieces + Roblox web APIs.
//
//   greeting      avatar bust, "Hi, name", friends online, Robux, quick links
//   jump back in  big hero for the last game + a rail of the rest (Continue)
//   friends       strip: in game first, presence rings, game name, Join
//   pinned        the user's own pinned games (storage key "pinnedGames")
//   playing       games friends are in right now, stacked friend avatars
//   favorites / recommended / more   lazy rails (ui.whenVisible)
//
// Speed: the shell + skeletons mount synchronously; the last Continue list
// (and its hero art URL) is cached in extension storage so a repeat visit
// paints the hero before any request returns. Fresh data then replaces it.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;
  const store = CER.ext.storage.local;

  const OMNI = "https://apis.roblox.com/discovery-api/omni-recommendation";
  const PIN_KEY = "pinnedGames"; // [{ universeId, placeId, name, at }]
  const CACHE_KEY = "cerHomeCache"; // { uid, t, cont: [game], heroImg }
  const MAX_PINS = 40;
  const SECTIONS = [
    { id: "continue", label: "Jump back in" },
    { id: "friends", label: "Friends" },
    { id: "pinned", label: "Pinned games" },
    { id: "playing", label: "Friends are playing" },
    { id: "favorites", label: "Favorites" },
    { id: "recommended", label: "Recommended" },
    { id: "more", label: "More games" },
  ];

  let gen = 0; // bumps on every (re)start; stale async work checks it
  let refreshTimer = null;
  let feats = {};
  let S = null; // refs of the current render

  // ------------------------------------------------------------ helpers
  const gameUrl = (g) => (g.placeId ? `https://www.roblox.com/games/${g.placeId}` : null);
  const clean = (name) => CER.cleanTitle(name ?? "", feats);
  const safe = (p) => Promise.resolve(p).catch(() => null);
  const rank = { ingame: 0, studio: 1, online: 2, offline: 3 };

  function normGame(uid, m = {}) {
    const up = m.totalUpVotes ?? m.upVotes;
    const down = m.totalDownVotes ?? m.downVotes;
    return {
      universeId: Number(uid),
      placeId: m.rootPlaceId ?? m.placeId ?? null,
      name: m.name ?? null,
      playing: m.playerCount ?? m.playing ?? null,
      rating: up != null ? fmt.pct(up, down) : null,
    };
  }
  // keep only what the cache / pins need
  const slim = (g) => ({ universeId: g.universeId, placeId: g.placeId, name: g.name, playing: g.playing, rating: g.rating });

  // omni-recommendation → [{ topic, games }] (game sorts only, no ads)
  function parseOmni(j) {
    const meta = j?.contentMetadata?.Game ?? {};
    const out = [];
    for (const s of j?.sorts ?? []) {
      const games = [];
      const seen = new Set();
      for (const r of s.recommendationList ?? []) {
        if (r.contentType && r.contentType !== "Game") continue;
        const id = r.contentId ?? r.universeId;
        if (!id || seen.has(String(id))) continue;
        const m = meta[id] ?? meta[String(id)] ?? {};
        if (m.isSponsored || m.isShowSponsoredLabel || r.contentMetadata?.IsSponsored === "true") continue;
        seen.add(String(id));
        games.push(normGame(id, m));
      }
      if (games.length) out.push({ topic: String(s.topic ?? ""), games });
    }
    return out;
  }

  // fill missing name / placeId / playing / rating
  async function fill(games) {
    if (games.some((g) => !g.name || !g.placeId || g.playing == null || g.rating == null)) await safe(ui.hydrateGames(games));
    return games.filter((g) => g.placeId && g.name);
  }

  // Presence without the batcher's forever-cache (so the 60 s refresh is fresh).
  async function fetchPresence(ids) {
    const out = new Map();
    const chunks = [];
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    const res = await Promise.all(chunks.map((c) => api.json("https://presence.roblox.com/v1/presence/users", { method: "POST", body: { userIds: c.map(Number) }, bg: true })));
    let any = false;
    for (const j of res) {
      if (!j) continue;
      any = true;
      for (const p of j.userPresences ?? []) out.set(String(p.userId), p);
    }
    return any || !ids.length ? out : null;
  }

  // ------------------------------------------------------------ pins
  const pins = {
    list: [],
    loaded: null,
    load() {
      return (this.loaded ??= store
        .get(PIN_KEY)
        .then((o) => (this.list = Array.isArray(o?.[PIN_KEY]) ? o[PIN_KEY].filter((p) => p?.universeId) : []))
        .catch(() => (this.list = [])));
    },
    has: (uid) => pins.list.some((p) => String(p.universeId) === String(uid)),
    async toggle(g) {
      await this.load();
      const on = !this.has(g.universeId);
      if (on && this.list.length >= MAX_PINS) return CER.toast?.("You have too many pins", "error");
      this.list = on ? [{ universeId: g.universeId, placeId: g.placeId, name: g.name, at: Date.now() }, ...this.list] : this.list.filter((p) => String(p.universeId) !== String(g.universeId));
      try {
        await store.set({ [PIN_KEY]: this.list });
      } catch {
        /* extension reloaded */
      }
      CER.toast?.(on ? "Pinned!" : "Unpinned");
      onPinsChanged();
    },
  };
  try {
    CER.ext.storage.onChanged.addListener((ch, area) => {
      if ((area && area !== "local") || !ch[PIN_KEY]) return;
      const next = Array.isArray(ch[PIN_KEY].newValue) ? ch[PIN_KEY].newValue : [];
      if (JSON.stringify(next) === JSON.stringify(pins.list)) return;
      pins.list = next;
      onPinsChanged();
    });
  } catch {
    /* context invalidated */
  }
  function onPinsChanged() {
    if (!S?.page.isConnected) return;
    for (const b of S.page.querySelectorAll(".home-pin[data-uid]")) setPinState(b, pins.has(b.dataset.uid));
    renderPinned();
  }
  function setPinState(b, on) {
    b.classList.toggle("is-on", on);
    b.title = on ? "Unpin" : "Pin to home";
    b.setAttribute("aria-label", b.title);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function pinButton(g, cls = "") {
    const b = h("button", { type: "button", class: "home-pin " + cls, dataset: { uid: g.universeId } }, ui.icon("pin", 16));
    setPinState(b, pins.has(g.universeId));
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pins.toggle(g);
    });
    return b;
  }

  // game card + pin toggle
  function card(g, opts = {}) {
    const c = ui.gameCard(g, { features: feats, ...opts });
    if (g.universeId) c.querySelector(".cer-gc-media")?.append(pinButton(g));
    return c;
  }

  // ------------------------------------------------------------ layout bits
  function rail(kids, cls = "home-rail") {
    const r = ui.rail(kids);
    r.classList.add(cls);
    return r;
  }
  const cardSkeletons = (n = 6) => rail(ui.skeleton("card", n));
  function section(id, title, opts = {}) {
    const s = ui.section(title, opts);
    s.dataset.sec = id;
    s.classList.add("home-sec");
    s.body.classList.add("home-cq");
    return s;
  }

  // ------------------------------------------------------------ shell
  function buildShell(page) {
    const r = { page };
    // greeting
    r.greetAv = h("a", { class: "home-greet-av", title: "My profile" });
    r.greetName = h("h1", { class: "home-greet-title" }, h("span", { class: "cer-sk home-sk-text" }));
    r.greetUser = h("div", { class: "home-greet-user" });
    r.greetStats = h("div", { class: "home-greet-stats" });
    r.greet = h(
      "header",
      { class: "home-greet" },
      r.greetAv,
      h("div", { class: "home-greet-text" }, r.greetName, r.greetUser, r.greetStats),
      h(
        "nav",
        { class: "home-greet-actions" },
        ui.button("Avatar", { icon: "shirt", href: "https://www.roblox.com/my/avatar" }),
        ui.button("Friends", { icon: "users", href: "https://www.roblox.com/users/friends" }),
        ui.button("Discover", { icon: "compass", href: "https://www.roblox.com/charts" }),
        ui.button("", { icon: "sliders", variant: "ghost", title: "Change home", onClick: openCustomize })
      )
    );

    // jump back in: hero + rail
    r.hero = h("div", { class: "cer-sk home-hero-sk" });
    r.contRail = h("div", { class: "home-cont-rail" }, cardSkeletons(6));
    r.cont = h("section", { class: "home-sec home-jump", dataset: { sec: "continue" } }, r.hero, h("div", { class: "home-cq" }, r.contRail));

    // friends strip
    r.friends = section("friends", "Friends", { icon: "users", action: { label: "See all", href: "https://www.roblox.com/users/friends" } });
    r.friends.body.append(rail(Array.from({ length: 12 }, () => h("div", { class: "home-friend-sk" }, h("span", { class: "cer-sk" }), h("span", { class: "cer-sk cer-sk-line" }))), "home-friend-rail"));

    r.pinned = section("pinned", "Pinned games", { icon: "pin" });
    r.pinned.hidden = true;

    r.playing = section("playing", "Friends are playing", { icon: "gamepad" });
    r.playing.hidden = true;

    r.favorites = section("favorites", "Favorites", { icon: "star" });
    r.favorites.body.append(cardSkeletons(6));

    r.recommended = section("recommended", "Recommended for you", { icon: "sparkle", action: { label: "Discover", href: "https://www.roblox.com/charts" } });
    r.recommended.body.append(cardSkeletons(6));

    r.more = h("div", { class: "home-more", dataset: { sec: "more" } });

    page.append(r.greet, r.cont, r.friends, r.pinned, r.playing, r.favorites, r.recommended, r.more);
    return r;
  }

  async function applyHidden() {
    const hidden = new Set((await CER.get()).uiState?.homeHidden ?? []);
    if (!S) return;
    for (const el of S.page.querySelectorAll("[data-sec]")) el.classList.toggle("is-user-hidden", hidden.has(el.dataset.sec));
  }

  // ------------------------------------------------------------ greeting
  function renderGreeting(me) {
    S.greetAv.href = `https://www.roblox.com/users/${me.id}/profile`;
    S.greetAv.replaceChildren(ui.thumb("bust", me.id, { alt: "" }));
    S.greetName.replaceChildren(h("span", { text: "Hi, " + (me.displayName || me.name) }));
    S.greetUser.textContent = "@" + me.name;
    S.statOnline = h("a", { class: "home-pill", href: "https://www.roblox.com/users/friends" }, h("span", { class: "home-dot" }), h("span", { class: "home-sk-inline cer-sk" }));
    S.statRobux = h("a", { class: "home-pill", href: "https://www.roblox.com/transactions", title: "My Robux" }, ui.icon("robux", 15), h("span", { class: "home-sk-inline cer-sk" }));
    S.greetStats.replaceChildren(S.statOnline, S.statRobux);
  }
  function setOnlineStat(n) {
    if (!S?.statOnline) return;
    S.statOnline.replaceChildren(h("span", { class: "home-dot" + (n ? "" : " is-off") }), h("span", { text: n == null ? "Friends" : n === 1 ? "1 friend online" : `${fmt.num(n)} friends online` }));
  }

  // ------------------------------------------------------------ jump back in
  function renderHero(g, heroImg) {
    const image = heroImg ? Promise.resolve(heroImg) : api.thumb("gameThumb", g.universeId);
    const hero = ui.hero({
      class: "home-hero",
      eyebrow: "Jump back in",
      eyebrowIcon: "clock",
      title: clean(g.name),
      stats: [g.playing != null && { icon: "users", label: fmt.num(g.playing) + " playing" }, g.rating != null && { icon: "like", label: g.rating + "% like it" }].filter(Boolean),
      image,
      art: h("a", { href: gameUrl(g), class: "home-hero-art", "aria-label": clean(g.name) }, ui.thumb("gameThumb", g.universeId, { src: heroImg, alt: "" })),
      actions: [ui.button("Play", { icon: "play", variant: "light", size: "lg", onClick: () => ui.play(g.placeId) }), ui.button("Details", { variant: "glass", size: "lg", href: gameUrl(g) }), pinButton(g, "is-glass")],
    });
    S.hero.replaceWith(hero);
    S.hero = hero;
    S.heroGame = g;
    image.then((url) => url && S.heroGame === g && (S.heroImg = url));
    if (S.groups) heroFriends();
  }
  // "2 friends here" on the hero once presence is in
  function heroFriends() {
    const g = S.heroGame;
    if (!g || !S.hero?.isConnected) return;
    S.hero.querySelector(".home-hero-friends")?.remove();
    const grp = S.groups?.get(String(g.universeId));
    if (!grp) return;
    const n = grp.friends.length;
    S.hero.querySelector(".cer-hero-stats")?.append(h("span", { class: "cer-hero-stat home-hero-friends" }, stack(grp.friends, 4, 24), h("span", { text: n === 1 ? "1 friend here" : n + " friends here" })));
  }
  function renderContinue(games, heroImg) {
    if (!games.length) {
      const empty = h("div", { class: "home-hero-empty" }, ui.empty("Play a game and it shows up here.", { icon: "gamepad", action: ui.button("Find a game", { icon: "compass", variant: "primary", href: "https://www.roblox.com/charts" }) }));
      S.hero.replaceWith(empty);
      S.hero = empty;
      S.heroGame = null;
      S.contRail.replaceChildren();
      return;
    }
    const [first, ...rest] = games;
    if (!S.heroGame || String(S.heroGame.universeId) !== String(first.universeId)) renderHero(first, heroImg);
    const key = rest.map((g) => g.universeId).join(",");
    if (S.contKey === key) return;
    S.contKey = key;
    S.contRail.replaceChildren(rest.length ? rail(rest.map((g) => card(g))) : "");
  }

  // ------------------------------------------------------------ friends
  function stack(friends, max = 3, size = 28) {
    return h(
      "span",
      { class: "home-stack", style: { "--av": size + "px" } },
      friends.slice(0, max).map((f) => h("span", { class: "home-stack-av", title: f.displayName || f.name }, ui.thumb("headshot", f.id, { alt: "" }))),
      friends.length > max && h("span", { class: "home-stack-more", text: "+" + (friends.length - max) })
    );
  }
  function friendTile(f, p) {
    const state = api.presenceState(p);
    const name = f.displayName || f.name || "";
    const sub = state === "ingame" ? p.lastLocation || "Playing" : state === "studio" ? "In Studio" : state === "online" ? "Online" : "";
    const join =
      state === "ingame" &&
      p.placeId &&
      p.gameId &&
      h(
        "button",
        {
          type: "button",
          class: "home-join",
          title: "Join " + name,
          "aria-label": "Join " + name,
          onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            ui.play(p.placeId, p.gameId);
          },
        },
        ui.icon("play", 12),
        h("span", { text: "Join" })
      );
    return h(
      "a",
      { class: "home-friend is-" + state, href: `https://www.roblox.com/users/${f.id}/profile`, title: name + (sub ? ": " + sub : "") },
      h("span", { class: "home-friend-av" }, ui.avatar(f.id, { size: 72, presence: p }), join),
      h("span", { class: "home-friend-name", text: name }),
      h("span", { class: "home-friend-sub is-" + state, text: sub || " " })
    );
  }
  function renderFriends(list, pres) {
    const body = S.friends.body;
    if (!list) return body.replaceChildren(ui.empty("Could not load friends.", { icon: "users" }));
    if (!list.length) return body.replaceChildren(ui.empty("No friends yet. Add some to see them here!", { icon: "userPlus" }));
    const rows = list.map((f, i) => ({ f, p: pres?.get(String(f.id)), i }));
    rows.sort((a, b) => rank[api.presenceState(a.p)] - rank[api.presenceState(b.p)] || a.i - b.i);
    const online = rows.filter((r) => api.presenceState(r.p) !== "offline").length;
    setOnlineStat(pres ? online : null);
    const sub = S.friends.head.querySelector(".cer-block-sub");
    const text = pres ? (online ? `${fmt.num(online)} online` : "Nobody online") : "";
    if (sub) sub.textContent = text;
    else if (text) S.friends.head.insertBefore(h("div", { class: "cer-block-sub", text }), S.friends.head.querySelector(".cer-block-tools"));
    const shown = rows.slice(0, 60);
    const sig = shown.map((r) => r.f.id + ":" + api.presenceState(r.p) + ":" + (r.p?.gameId ?? r.p?.universeId ?? "")).join("|");
    if (S.friendSig === sig) return;
    S.friendSig = sig;
    const old = body.querySelector(".cer-rail-track")?.scrollLeft ?? 0;
    const r = rail(
      shown.map((x) => friendTile(x.f, x.p)),
      "home-friend-rail"
    );
    body.replaceChildren(r);
    if (old) r.track.scrollLeft = old;
  }

  // games friends are in, most friends first
  function groupPlaying(list, pres) {
    const groups = new Map();
    if (!pres) return groups;
    for (const f of list) {
      const p = pres.get(String(f.id));
      if (api.presenceState(p) !== "ingame" || !(p.universeId || p.rootPlaceId)) continue;
      const key = String(p.universeId ?? "p" + p.rootPlaceId);
      if (!groups.has(key)) groups.set(key, { game: { universeId: p.universeId ?? null, placeId: p.rootPlaceId ?? p.placeId ?? null, name: p.lastLocation || null }, friends: [] });
      groups.get(key).friends.push(f);
    }
    return groups;
  }
  async function renderPlaying(groups) {
    const my = gen;
    const sec = S.playing;
    const list = [...groups.values()].sort((a, b) => b.friends.length - a.friends.length).slice(0, 20);
    const sig = list.map((g) => g.game.universeId + ":" + g.friends.map((f) => f.id).join(".")).join("|");
    if (S.playSig === sig) return;
    S.playSig = sig;
    if (!list.length) {
      sec.hidden = true;
      return;
    }
    const games = await fill(list.map((g) => g.game));
    if (my !== gen || S.playSig !== sig) return;
    const byId = new Map(list.map((g) => [String(g.game.universeId), g]));
    const cards = games.map((g) => {
      const grp = byId.get(String(g.universeId));
      const n = grp?.friends.length ?? 0;
      const c = card(g, { sub: n === 1 ? "1 friend" : n + " friends" });
      if (grp) c.querySelector(".cer-gc-media")?.append(h("span", { class: "home-gc-friends" }, stack(grp.friends, 3, 30)));
      return c;
    });
    sec.body.replaceChildren(rail(cards));
    sec.hidden = !cards.length;
  }

  // ------------------------------------------------------------ pinned
  async function renderPinned() {
    if (!S) return;
    const my = gen;
    await pins.load();
    const sec = S.pinned;
    const list = pins.list.map((p) => ({ ...p }));
    sec.hidden = !list.length;
    const sig = list.map((p) => p.universeId).join(",");
    if (S.pinSig === sig) return;
    S.pinSig = sig;
    if (!list.length) return sec.body.replaceChildren();
    sec.body.replaceChildren(rail(list.map((g) => card(g))));
    // live player counts / ratings fill in after
    const games = await fill(list);
    if (my !== gen || S.pinSig !== sig) return;
    sec.body.replaceChildren(rail(games.map((g) => card(g))));
  }

  // ------------------------------------------------------------ lazy rails
  function lazyRail(sec, load, emptyText, emptyOpts = {}) {
    ui.whenVisible(sec, async () => {
      const my = gen;
      const games = await safe(load());
      if (my !== gen) return;
      if (!games) return sec.body.replaceChildren(ui.empty("Could not load this. Try again soon.", { icon: "refresh" }));
      if (!games.length) return sec.body.replaceChildren(ui.empty(emptyText, emptyOpts));
      sec.body.replaceChildren(rail(games.map((g) => card(g))));
    });
  }

  async function loadFavorites(uid) {
    const j = await api.json(`https://games.roblox.com/v2/users/${uid}/favorite/games?limit=50&sortOrder=Desc`, { ttl: 120000 });
    if (!j) return null;
    return fill((j.data ?? []).map((g) => ({ universeId: g.id, placeId: g.rootPlace?.id ?? null, name: g.name })));
  }

  // Continue fallback: CER's own local playtime log (most recent day first)
  async function playtimeRecent() {
    const o = await safe(store.get("playtime"));
    const rows = Object.entries(o?.playtime ?? {}).map(([uid, e]) => ({ uid, last: Object.keys(e.days ?? {}).sort().pop() ?? "", total: e.total ?? 0 }));
    rows.sort((a, b) => (b.last > a.last ? 1 : b.last < a.last ? -1 : b.total - a.total));
    return fill(rows.slice(0, 20).map((r) => ({ universeId: Number(r.uid) })));
  }

  // ------------------------------------------------------------ customize
  async function openCustomize() {
    const hidden = new Set((await CER.get()).uiState?.homeHidden ?? []);
    const rows = SECTIONS.map((s) =>
      h(
        "label",
        { class: "home-cust-row" },
        h("span", { text: s.label }),
        ui.toggle(!hidden.has(s.id), async (on) => {
          on ? hidden.delete(s.id) : hidden.add(s.id);
          const cur = await CER.get();
          await CER.set({ uiState: { ...cur.uiState, homeHidden: [...hidden] } });
          applyHidden();
        })
      )
    );
    ui.modal({
      title: "Change home",
      class: "home-cust",
      body: h("div", {}, h("p", { class: "home-cust-hint", text: "Pick what shows on your home." }), h("div", { class: "home-cust-list" }, rows)),
      actions: [{ label: "Done", variant: "primary" }],
    });
  }

  // ------------------------------------------------------------ cache
  async function readCache() {
    const o = await safe(store.get(CACHE_KEY));
    return o?.[CACHE_KEY] ?? null;
  }
  function writeCache(uid, cont) {
    safe(store.set({ [CACHE_KEY]: { uid, t: Date.now(), cont: cont.slice(0, 20).map(slim), heroImg: S.heroImg ?? null } }));
  }

  // ------------------------------------------------------------ start
  async function start() {
    const my = ++gen;
    clearInterval(refreshTimer);
    const { page } = ui.page("home", "home-view");
    S = buildShell(page);
    const alive = () => my === gen && page.isConnected;

    const settingsP = CER.get();
    const cacheP = readCache();
    const me = await api.me();
    if (!alive()) return;
    if (!me) return ui.release();
    feats = (await settingsP).features ?? {};
    applyHidden();
    renderGreeting(me);

    // everything below runs in parallel
    // null = the call failed (shown as an error), [] = nothing to show
    const omniP = api.json(OMNI, { method: "POST", body: { pageType: "Home", sessionId: crypto.randomUUID() }, bg: true }).then((j) => (j ? parseOmni(j) : null));
    // raw read first so a failed call is told apart from "no friends" (api.friends hides it); same URL + ttl, so no second request
    const friendsP = api.json(`https://friends.roblox.com/v1/users/${me.id}/friends`, { ttl: 60000 }).then((j) => (j ? safe(api.friends(me.id)) : null));
    renderPinned();

    // instant hero from the last visit
    const cache = await cacheP;
    if (alive() && cache?.uid === me.id && Date.now() - cache.t < 7 * 864e5 && cache.cont?.length) renderContinue(cache.cont, cache.heroImg);

    api.json(`https://economy.roblox.com/v1/users/${me.id}/currency`, { ttl: 60000 }).then((j) => {
      if (!alive() || !S.statRobux) return;
      if (j?.robux == null) return S.statRobux.remove();
      S.statRobux.replaceChildren(ui.icon("robux", 15), h("span", { text: fmt.full(j.robux) }));
      S.statRobux.title = fmt.full(j.robux) + " Robux";
    });

    // jump back in
    omniP.then(async (sorts) => {
      if (!alive()) return;
      const cont = sorts?.find((s) => /continue/i.test(s.topic))?.games ?? [];
      let games = await fill(cont.slice(0, 24));
      if (!games.length) games = (await safe(playtimeRecent())) ?? [];
      if (!alive()) return;
      renderContinue(games);
      // cache once the hero art URL is known
      const first = games[0];
      const done = (u) => {
        if (!alive()) return;
        if (u && S.heroGame && String(S.heroGame.universeId) === String(first?.universeId)) S.heroImg = u;
        writeCache(me.id, games);
      };
      if (first) api.thumb("gameThumb", first.universeId).then(done); // a failed load keeps the old cache
    });

    // friends + presence
    let friendList = null;
    const loadPresence = () => (friendList?.length ? fetchPresence(friendList.map((f) => f.id)) : Promise.resolve(null));
    const applyPresence = (pres) => {
      renderFriends(friendList, pres);
      S.groups = groupPlaying(friendList, pres);
      heroFriends();
      renderPlaying(S.groups);
    };
    friendsP.then(async (list) => {
      if (!alive()) return;
      friendList = list;
      if (!list?.length) {
        renderFriends(list, new Map());
        setOnlineStat(list ? 0 : null);
        return;
      }
      // names first (rings fill a beat later) so the strip never waits
      renderFriends(list, null);
      const pres = await loadPresence();
      if (!alive()) return;
      applyPresence(pres);
      // keep presence fresh while the tab is open (60 s, visible tabs only)
      refreshTimer = setInterval(async () => {
        if (!alive()) return clearInterval(refreshTimer);
        if (document.visibilityState !== "visible") return;
        const p = await loadPresence();
        if (p && alive()) applyPresence(p);
      }, 60000);
    });

    // lower rails, only when scrolled near
    const recSort = (sorts) => sorts.find((s) => /recommended/i.test(s.topic)) ?? sorts.find((s) => !/continue|favorit|friend/i.test(s.topic));
    lazyRail(S.favorites, () => loadFavorites(me.id), "Tap the star on a game to add it here.", { icon: "star" });
    lazyRail(
      S.recommended,
      async () => {
        const sorts = await omniP;
        if (!sorts) return null;
        const rec = recSort(sorts);
        return rec ? fill(rec.games.slice(0, 30)) : [];
      },
      "No picks right now. Try Discover!",
      { icon: "compass", action: ui.button("Discover", { icon: "compass", href: "https://www.roblox.com/charts" }) }
    );
    omniP.then((sorts) => {
      if (!alive() || !sorts) return;
      const recTopic = recSort(sorts)?.topic;
      const extra = sorts.filter((s) => s.topic && s.topic !== recTopic && !/continue|favorit|sponsor|friend/i.test(s.topic) && s.games.length >= 4).slice(0, 3);
      for (const s of extra) {
        const sec = section("more", s.topic, { icon: "flame" });
        sec.body.append(cardSkeletons(6));
        S.more.append(sec);
        lazyRail(sec, () => fill(s.games.slice(0, 30)), "Nothing here yet.");
      }
    });
  }

  ui.route("home", start);
  CER.onSettingsChanged?.((ch) => {
    if (ch.uiState && S?.page.isConnected) applyHidden();
  });
})();
