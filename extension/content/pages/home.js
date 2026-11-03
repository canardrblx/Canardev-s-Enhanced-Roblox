// CER home page (/home). A game launcher, not a website: art first, little text.
//
//   hero      the last game played, big art, one Play button
//   continue  the rest of Continue, as a rail right under the hero
//   friends   online first, presence rings, game name, small Join button
//   pinned    the user's own pinned games (storage key "pinnedGames")
//   playing   games friends are in now, friend faces on the art
//   favorites / recommended   lazy rails (ui.whenVisible)
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
  const MAX_FRIENDS = 40;

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
  const findSort = (sorts, re) => sorts?.find((s) => re.test(s.topic));
  const recSort = (sorts) => findSort(sorts, /recommended/i) ?? sorts?.find((s) => !/continue|favorit|friend|sponsor/i.test(s.topic));

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
    const res = await Promise.all(chunks.map((c) => api.json("https://presence.roblox.com/v1/presence/users", { method: "POST", body: { userIds: c.map(Number) } })));
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
      if (on && this.list.length >= MAX_PINS) return CER.toast?.("Too many pins", "error");
      this.list = on ? [{ universeId: g.universeId, placeId: g.placeId, name: g.name, at: Date.now() }, ...this.list] : this.list.filter((p) => String(p.universeId) !== String(g.universeId));
      try {
        await store.set({ [PIN_KEY]: this.list });
      } catch {
        /* extension reloaded */
      }
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
    b.title = on ? "Unpin" : "Pin";
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

  // game card + pin toggle (shows on hover, stays when pinned)
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
  function section(title, opts = {}) {
    const s = ui.section(title, opts);
    s.classList.add("home-sec");
    s.body.classList.add("home-cq");
    return s;
  }
  // overlapping friend faces
  function faces(friends, max = 3) {
    return h(
      "span",
      { class: "home-faces" },
      friends.slice(0, max).map((f) => h("span", { class: "home-face", title: f.displayName || f.name }, ui.thumb("headshot", f.id, { alt: "" }))),
      friends.length > max && h("span", { class: "home-faces-more", text: "+" + (friends.length - max) })
    );
  }

  // ------------------------------------------------------------ shell
  function buildShell(page) {
    const r = { page };
    r.hero = h("div", { class: "cer-sk home-hero-sk" });
    r.contRail = h("div", { class: "home-cq home-cont" }, cardSkeletons(6));
    r.top = h("section", { class: "home-top" }, r.hero, r.contRail);

    r.friends = section("Friends", { action: { label: "See all", href: "https://www.roblox.com/users/friends" } });
    r.friends.body.append(rail(Array.from({ length: 12 }, () => h("div", { class: "home-friend-sk" }, h("span", { class: "cer-sk" }), h("span", { class: "cer-sk cer-sk-line" }))), "home-friend-rail"));

    r.pinned = section("Pinned");
    r.pinned.hidden = true;

    r.playing = section("Friends are playing");
    r.playing.hidden = true;

    r.favorites = section("Favorites");
    r.favorites.body.append(cardSkeletons(6));

    r.recommended = section("Recommended");
    r.recommended.body.append(cardSkeletons(6));

    page.append(r.top, r.friends, r.pinned, r.playing, r.favorites, r.recommended);
    return r;
  }

  // ------------------------------------------------------------ hero
  // `eyebrow`: "Jump back in" for Continue, "Try this" when we fall back to a pick
  function renderHero(g, heroImg, eyebrow = "Jump back in") {
    const image = heroImg ? Promise.resolve(heroImg) : api.thumb("gameThumb", g.universeId);
    const hero = ui.hero({
      class: "home-hero",
      eyebrow,
      title: clean(g.name),
      stats: [g.playing != null && { icon: "users", label: fmt.num(g.playing) }, g.rating != null && { icon: "like", label: g.rating + "%" }].filter(Boolean),
      image,
      art: h("a", { href: gameUrl(g), class: "home-hero-art", "aria-label": clean(g.name) }, ui.thumb("gameThumb", g.universeId, { src: heroImg, alt: "" })),
      actions: [ui.button("Play", { icon: "play", variant: "light", size: "lg", onClick: () => ui.play(g.placeId) }), pinButton(g, "is-hero")],
    });
    S.hero.replaceWith(hero);
    S.hero = hero;
    S.heroGame = g;
    image.then((url) => url && S.heroGame === g && (S.heroImg = url));
    heroFaces();
  }
  // friends in the hero game: faces only, no words
  function heroFaces() {
    const g = S.heroGame;
    if (!g || !S.hero?.isConnected) return;
    S.hero.querySelector(".home-hero-faces")?.remove();
    const grp = S.groups?.get(String(g.universeId));
    if (grp) S.hero.querySelector(".cer-hero-stats")?.append(h("span", { class: "cer-hero-stat home-hero-faces" }, faces(grp.friends, 4)));
  }
  function renderContinue(games, heroImg) {
    if (!games.length) return;
    const [first, ...rest] = games;
    S.heroPick = false;
    if (!S.heroGame || String(S.heroGame.universeId) !== String(first.universeId)) renderHero(first, heroImg);
    const key = rest.map((g) => g.universeId).join(",");
    if (S.contKey === key) return;
    S.contKey = key;
    S.contRail.replaceChildren(rest.length ? rail(rest.map((g) => card(g))) : "");
  }
  // nothing to continue: lead with a pick instead of an empty box
  async function heroFallback(sorts) {
    const pick = recSort(sorts)?.games?.slice(0, 1) ?? [];
    const g = (await fill(pick))[0];
    if (!S.hero.isConnected) return;
    if (g) {
      renderHero(g, null, "Try this");
      S.heroPick = true;
    }
    else S.hero.replaceWith((S.hero = h("div", { class: "home-hero-none" }, ui.button("Find a game", { icon: "compass", variant: "light", size: "lg", href: "https://www.roblox.com/charts" }))));
    S.contRail.replaceChildren();
  }

  // ------------------------------------------------------------ friends
  function friendTile(f, p) {
    const state = api.presenceState(p);
    const name = f.displayName || f.name || "";
    const game = state === "ingame" ? p.lastLocation || "" : "";
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
        ui.icon("play", 13)
      );
    return h(
      "a",
      { class: "home-friend is-" + state, href: `https://www.roblox.com/users/${f.id}/profile`, title: game ? name + ": " + game : name },
      h("span", { class: "home-friend-av" }, ui.avatar(f.id, { size: 76, presence: p }), join),
      h("span", { class: "home-friend-name", text: name }),
      h("span", { class: "home-friend-game", text: game || " " })
    );
  }
  function renderFriends(list, pres) {
    const sec = S.friends;
    if (!list) return sec.body.replaceChildren(ui.empty("Could not load friends.", { icon: "users" }));
    if (!list.length) return (sec.hidden = true);
    const rows = list.map((f, i) => ({ f, p: pres?.get(String(f.id)), i }));
    rows.sort((a, b) => rank[api.presenceState(a.p)] - rank[api.presenceState(b.p)] || a.i - b.i);
    const shown = rows.slice(0, MAX_FRIENDS);
    const sig = shown.map((r) => r.f.id + ":" + api.presenceState(r.p) + ":" + (r.p?.gameId ?? r.p?.universeId ?? "")).join("|");
    if (S.friendSig === sig) return;
    S.friendSig = sig;
    const old = sec.body.querySelector(".cer-rail-track")?.scrollLeft ?? 0;
    const r = rail(
      shown.map((x) => friendTile(x.f, x.p)),
      "home-friend-rail"
    );
    sec.body.replaceChildren(r);
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
    if (!list.length) return (sec.hidden = true);
    const games = await fill(list.map((g) => g.game));
    if (my !== gen || S.playSig !== sig) return;
    const byId = new Map(list.map((g) => [String(g.game.universeId), g]));
    const cards = games.map((g) => {
      const grp = byId.get(String(g.universeId));
      const c = card(g);
      if (grp) c.querySelector(".cer-gc-media")?.append(h("span", { class: "home-gc-faces" }, faces(grp.friends, 3)));
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
  // null = failed (small error), [] = nothing (section hides)
  function lazyRail(sec, load) {
    ui.whenVisible(sec, async () => {
      const my = gen;
      const games = await safe(load());
      if (my !== gen) return;
      if (!games) return sec.body.replaceChildren(ui.empty("Could not load this.", { icon: "refresh" }));
      if (!games.length) return (sec.hidden = true);
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

    // everything below runs in parallel
    // null = the call failed, [] = nothing to show
    const omniP = api.json(OMNI, { method: "POST", body: { pageType: "Home", sessionId: crypto.randomUUID() }, bg: true }).then((j) => (j ? parseOmni(j) : null));
    // raw read first so a failed call is told apart from "no friends" (api.friends hides it); same URL + ttl, so no second request
    const friendsP = api.json(`https://friends.roblox.com/v1/users/${me.id}/friends`, { ttl: 60000 }).then((j) => (j ? safe(api.friends(me.id)) : null));
    renderPinned();

    // instant hero from the last visit
    const cache = await cacheP;
    if (alive() && cache?.uid === me.id && Date.now() - cache.t < 7 * 864e5 && cache.cont?.length) renderContinue(cache.cont, cache.heroImg);

    // hero + continue
    omniP.then(async (sorts) => {
      if (!alive()) return;
      let games = await fill((findSort(sorts, /continue/i)?.games ?? []).slice(0, 24));
      if (!games.length) games = (await safe(playtimeRecent())) ?? [];
      if (!alive()) return;
      if (!games.length) {
        if (!S.heroGame) heroFallback(sorts);
        return;
      }
      renderContinue(games);
      const first = games[0];
      // cache once the hero art URL is known (a failed load keeps the old cache)
      api.thumb("gameThumb", first.universeId).then((u) => {
        if (!alive()) return;
        if (u && S.heroGame && String(S.heroGame.universeId) === String(first.universeId)) S.heroImg = u;
        writeCache(me.id, games);
      });
    });

    // friends + presence
    let friendList = null;
    const loadPresence = () => (friendList?.length ? fetchPresence(friendList.map((f) => f.id)) : Promise.resolve(null));
    const applyPresence = (pres) => {
      renderFriends(friendList, pres);
      S.groups = groupPlaying(friendList, pres);
      heroFaces();
      renderPlaying(S.groups);
    };
    friendsP.then(async (list) => {
      if (!alive()) return;
      friendList = list;
      if (!list?.length) return renderFriends(list, null);
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
    lazyRail(S.favorites, () => loadFavorites(me.id));
    lazyRail(S.recommended, async () => {
      const sorts = await omniP;
      if (!sorts) return null;
      const rec = recSort(sorts);
      // the hero fallback already shows the first pick
      const games = rec ? await fill(rec.games.slice(0, 30)) : [];
      return S.heroPick ? games.filter((g) => String(g.universeId) !== String(S.heroGame.universeId)) : games;
    });
  }

  ui.route("home", start);
})();
