// CER search page. Built on CER.ui (content/ui.js).
//
// One results page for every search route:
//   /discover?Keyword=q       → Games  (omni-search)
//   /search/users?keyword=q   → People (users search + presence)
//   /search/communities?...   → Groups (groups search)
//   Catalog                   → a link to /catalog/?Keyword=q (catalog page owns it)
// Typing re-searches after a short pause and keeps the URL in sync with
// replaceState; switching tabs pushes a history entry so Back works.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;

  const SID = (() => {
    try {
      let s = localStorage.getItem("cer:exploreSid");
      if (!s) localStorage.setItem("cer:exploreSid", (s = "cer-" + Math.random().toString(36).slice(2, 12)));
      return s;
    } catch {
      return "cer-search";
    }
  })();

  const TABS = [
    { id: "games", label: "Games" },
    { id: "people", label: "People" },
    { id: "groups", label: "Groups" },
    { id: "catalog", label: "Catalog" },
  ];

  // ------------------------------------------------------------ url <-> state
  function parse() {
    const p = location.pathname.toLowerCase();
    const tab = p.startsWith("/search/users") ? "people" : /^\/search\/(communities|groups)/.test(p) ? "groups" : "games";
    let q = "";
    for (const [k, v] of new URLSearchParams(location.search)) if (k.toLowerCase() === "keyword") q = v;
    return { tab, q: q.trim() };
  }
  function urlFor(tab, q) {
    const e = encodeURIComponent(q);
    if (tab === "people") return "/search/users?keyword=" + e;
    if (tab === "groups") return "/search/communities?keyword=" + e;
    if (tab === "catalog") return "/catalog/?Keyword=" + e;
    return "/discover?Keyword=" + e;
  }

  const S = { root: null, tab: "games", q: "", seq: 0 };
  const alive = (root) => root && root.isConnected && document.getElementById("cer-app") === root;

  ui.route("search", async () => {
    const st = parse();
    // our own replaceState / pushState re-runs the route: same page, just sync
    if (alive(S.root)) {
      if (st.tab !== S.tab || st.q !== S.q) apply(st, true);
      return;
    }
    const { root, page } = ui.page("search");
    S.root = root;
    build(page, st);
  });

  // ------------------------------------------------------------ page
  function build(page, st) {
    S.tab = st.tab;
    S.q = st.q;
    const field = ui.search("Search games, people and groups", {
      class: "sr-field",
      value: st.q,
      delay: 350,
      onInput: (q) => setQuery(q),
      onSubmit: (q) => setQuery(q, true),
    });
    field.input.setAttribute("aria-label", "Search");
    field.input.setAttribute("enterkeyhint", "search");
    const tabs = ui.tabs(
      TABS,
      st.tab,
      (id) => {
        if (id === "catalog") {
          tabs.set(S.tab); // the catalog page is its own page
          location.href = urlFor("catalog", S.q);
          return;
        }
        S.tab = id;
        history.pushState(history.state, "", urlFor(id, S.q));
        run();
      }
    );
    tabs.classList.add("sr-tabs");
    const results = h("div", { class: "sr-results", "aria-live": "polite" });
    page.append(h("div", { class: "sr-top" }, field, tabs), results);
    Object.assign(S, { field, tabs, results });
    if (!st.q) requestAnimationFrame(() => field.input.focus());
    run();
  }

  // URL changed under us (Back/Forward, or a new search from the sidebar)
  function apply(st) {
    S.tab = st.tab;
    S.q = st.q;
    S.tabs.set(st.tab);
    if (S.field.input.value.trim() !== st.q) S.field.input.value = st.q;
    run();
  }

  function setQuery(q, now) {
    if (q === S.q && !now) return;
    S.q = q;
    history.replaceState(history.state, "", urlFor(S.tab, q));
    run();
  }

  // ------------------------------------------------------------ search
  function run() {
    const seq = ++S.seq;
    const { tab, q } = S;
    const ok = () => seq === S.seq && alive(S.root);
    if (!q) return ui.clear(S.results); // the focused field says it all
    if (tab === "people" && q.length < 3) return ui.clear(S.results, note("Type 3 or more letters."));
    ui.clear(S.results, skeleton(tab));
    const load = tab === "people" ? searchPeople : tab === "groups" ? searchGroups : searchGames;
    load(q, ok);
  }

  function skeleton(tab) {
    if (tab === "games") return ui.grid(ui.skeleton("card", 12), { min: 220, gap: 20 });
    if (tab === "people") return ui.grid(Array.from({ length: 12 }, () => h("div", { class: "sr-sk-person" }, h("div", { class: "cer-sk sr-sk-face" }), h("div", { class: "cer-sk cer-sk-line" }), h("div", { class: "cer-sk cer-sk-line short" }))), { min: 170, gap: 16 });
    return ui.grid(ui.skeleton("row", 8).map((x) => (x.classList.add("sr-sk-group"), x)), { min: 360, gap: 14 });
  }

  const note = (text, action) => h("div", { class: "sr-note" }, h("p", { text }), action);
  const failed = (retry) => note("Search is not working right now.", ui.button("Try again", { onClick: retry }));
  const nothing = () => note("Nothing found. Try other words.");

  // Next page loads by itself when the end of the list scrolls near view.
  function moreButton(onMore) {
    const spot = h("div", { class: "sr-more" }, ui.skeleton("line"));
    const arm = () =>
      ui.whenVisible(spot, async () => {
        if (!spot.isConnected) return;
        const done = await onMore();
        if (done) spot.remove();
        else requestAnimationFrame(arm);
      });
    arm();
    return spot;
  }

  // ---- games
  const normGame = (x) =>
    x && x.universeId && x.rootPlaceId && !x.isSponsored
      ? { universeId: x.universeId, placeId: x.rootPlaceId, name: x.name ?? "", playing: x.playerCount ?? null, rating: fmt.pct(x.totalUpVotes, x.totalDownVotes) }
      : null;
  const omni = (q, token) =>
    api.json(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&sessionId=${SID}&pageType=Games${token ? "&pageToken=" + encodeURIComponent(token) : ""}`, { ttl: 120000 });
  async function searchGames(q, ok) {
    const j = await omni(q);
    if (!ok()) return;
    if (!j?.searchResults) return ui.clear(S.results, failed(run));
    const seen = new Set();
    const take = (res) =>
      res
        .flatMap((r) => (r.contentGroupType === "Game" ? r.contents ?? [] : []))
        .map(normGame)
        .filter((g) => g && !seen.has(g.universeId) && seen.add(g.universeId));
    const games = take(j.searchResults);
    if (!games.length) return ui.clear(S.results, nothing());
    const grid = ui.grid(
      games.map((g) => ui.gameCard(g)),
      { min: 220, gap: 20, class: "sr-games" }
    );
    let token = j.nextPageToken;
    ui.clear(
      S.results,
      grid,
      token &&
        moreButton(async () => {
          const n = await omni(q, token);
          if (!ok()) return true;
          const more = take(n?.searchResults ?? []);
          grid.append(...more.map((g) => ui.gameCard(g)));
          token = n?.nextPageToken;
          return !token || !more.length;
        })
    );
  }

  // ---- people
  const usersUrl = (q, cursor) => `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(q)}&limit=25${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`;
  async function searchPeople(q, ok) {
    const j = await api.json(usersUrl(q), { ttl: 120000 });
    if (!ok()) return;
    if (!j?.data) return ui.clear(S.results, failed(run));
    if (!j.data.length) return ui.clear(S.results, nothing());
    const grid = ui.grid([], { min: 170, gap: 16, class: "sr-people" });
    const addUsers = (list) => {
      const tiles = list.map((u) => personTile(u, q));
      grid.append(...tiles.map((t) => t.el));
      // presence rings + "Playing X" fill in when presence arrives
      api.presence(list.map((u) => u.id)).then((pres) => {
        for (const t of tiles) t.setPresence(pres.get(String(t.id)));
      });
    };
    addUsers(j.data);
    let cursor = j.nextPageCursor;
    ui.clear(
      S.results,
      grid,
      cursor &&
        moreButton(async () => {
          const n = await api.json(usersUrl(q, cursor), { ttl: 120000 });
          if (!ok()) return true;
          if (n?.data?.length) addUsers(n.data);
          cursor = n?.nextPageCursor;
          return !cursor || !n?.data?.length;
        })
    );
  }

  function personTile(u, q) {
    const href = `https://www.roblox.com/users/${u.id}/profile`;
    const av = ui.avatar(u.id, { size: 120 });
    const status = h("span", { class: "sr-person-status" });
    // say why a result matched when it was an old name
    const lower = q.toLowerCase();
    const was = !u.name.toLowerCase().includes(lower) && !(u.displayName ?? "").toLowerCase().includes(lower) ? (u.previousUsernames ?? []).find((n) => n.toLowerCase().includes(lower)) : null;
    const el = h(
      "a",
      { class: "sr-person", href, title: u.displayName ?? u.name },
      av,
      ui.nameTag({ type: "user", id: u.id, name: u.displayName || u.name, verified: u.hasVerifiedBadge, cls: "sr-person-name" }),
      h("span", { class: "sr-person-user", text: "@" + u.name }),
      was ? h("span", { class: "sr-person-was", text: "Was @" + was }) : status
    );
    return {
      el,
      id: u.id,
      setPresence(p) {
        if (!p) return;
        av.setPresence(p);
        const state = api.presenceState(p);
        if (was) return;
        status.className = "sr-person-status is-" + state;
        status.textContent = state === "ingame" ? (p.lastLocation ? "Playing " + p.lastLocation : "In a game") : state === "online" ? "Online" : state === "studio" ? "In Studio" : "";
        status.title = status.textContent;
      },
    };
  }

  // ---- groups
  const groupsUrl = (q, cursor) => `https://groups.roblox.com/v1/groups/search?keyword=${encodeURIComponent(q)}&limit=25${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`;
  async function searchGroups(q, ok) {
    const j = await api.json(groupsUrl(q), { ttl: 120000 });
    if (!ok()) return;
    if (!j?.data) return ui.clear(S.results, failed(run));
    if (!j.data.length) return ui.clear(S.results, nothing());
    const grid = ui.grid(
      j.data.map(groupCard),
      { min: 360, gap: 14, class: "sr-groups" }
    );
    let cursor = j.nextPageCursor;
    ui.clear(
      S.results,
      grid,
      cursor &&
        moreButton(async () => {
          const n = await api.json(groupsUrl(q, cursor), { ttl: 120000 });
          if (!ok()) return true;
          if (n?.data?.length) grid.append(...n.data.map(groupCard));
          cursor = n?.nextPageCursor;
          return !cursor || !n?.data?.length;
        })
    );
  }

  function groupCard(g) {
    return h(
      "a",
      { class: "sr-group", href: `https://www.roblox.com/communities/${g.id}`, title: g.name },
      h("span", { class: "sr-group-icon" }, ui.thumb("groupIcon", g.id, { alt: "" })),
      h(
        "span",
        { class: "sr-group-main" },
        ui.nameTag({ type: "group", id: g.id, name: g.name, verified: g.hasVerifiedBadge, cls: "sr-group-name" }),
        h("span", { class: "sr-group-members", text: fmt.num(g.memberCount) + (g.memberCount === 1 ? " member" : " members") })
      )
    );
  }
})();
