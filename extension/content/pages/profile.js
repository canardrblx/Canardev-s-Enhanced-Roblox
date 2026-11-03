// CER profile page (/users/{id}/profile). Built on CER.ui (content/ui.js).
// Roblox is only a data source here (its web APIs) and an action source
// (friend / follow writes, game launch). Nothing is read from its page DOM.
//
//   hero      full-body avatar on a soft glow, names, presence (+ Join),
//             counts, join date, actions (Add friend / Message / Follow / more)
//   tabs      About · Creations · Favorites · Friends · Groups · Badges · Items
//             (tab kept in the URL hash, panels built on first open)
//
// Promotable bits built here: menu() (popover menu), countBtn().

(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;
  const TAG = "profile";
  const RB = "https://www.roblox.com";

  ui.route(TAG, start);

  let runId = 0; // bumps per start(); async work from an older run stops

  // ---------------------------------------------------------------- data
  // GET with a background-fetch fallback (some hosts answer the page with a
  // 401/CORS error but work from the worker, which holds our host permissions).
  const get = async (url, ttl = 60000) => (await api.json(url, { ttl })) ?? (await api.json(url, { ttl, bg: true }));

  // users/v1 lookup that tells "gone" (404 / banned) apart from "failed".
  async function loadUser(id) {
    const url = "https://users.roblox.com/v1/users/" + id;
    try {
      const r = await fetch(url, { credentials: "include" });
      if (r.ok) return { user: await r.json() };
      if (r.status === 404 || r.status === 400) return { gone: true };
    } catch {
      /* fall through to the worker */
    }
    const r = await CER.bgFetch(url);
    if (r.ok && r.data?.id) return { user: r.data };
    if (r.status === 404 || r.status === 400) return { gone: true };
    return { error: true };
  }

  // All friends of a user, names filled in. Old list endpoint first, then the
  // paged /friends/find one (Roblox has been moving people to it).
  async function friendsOf(id) {
    let list = null;
    const old = await get(`https://friends.roblox.com/v1/users/${id}/friends`);
    if (Array.isArray(old?.data)) list = old.data.map((f) => ({ id: f.id, name: f.name, displayName: f.displayName }));
    if (!list || !list.length) {
      const found = [];
      let cursor = "";
      let answered = false;
      for (let i = 0; i < 5; i++) {
        const j = await get(`https://friends.roblox.com/v1/users/${id}/friends/find?limit=50${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`);
        if (!j) break;
        answered = true;
        for (const f of j.PageItems ?? j.pageItems ?? []) found.push({ id: f.id });
        cursor = j.NextCursor ?? j.nextCursor;
        if (!cursor) break;
      }
      if (found.length || (!list && answered)) list = found;
    }
    if (!list) return null;
    const missing = list.filter((f) => !f.name).map((f) => f.id);
    if (missing.length) {
      const names = await api.users(missing);
      for (const f of list) {
        const u = names.get(String(f.id));
        if (u) Object.assign(f, { name: u.name, displayName: u.displayName, hasVerifiedBadge: u.hasVerifiedBadge });
      }
    }
    return list;
  }

  // Public games of a user or group, as gameCard objects.
  async function gamesOf(kind, id, pages = 2) {
    const out = [];
    let cursor = "";
    for (let i = 0; i < pages; i++) {
      const j = await get(`https://games.roblox.com/v2/${kind}/${id}/games?accessFilter=Public&limit=50&sortOrder=Desc${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, 300000);
      if (!j) return i ? out : null;
      for (const g of j.data ?? []) out.push({ universeId: g.id, placeId: g.rootPlace?.id, name: g.name, visits: g.placeVisits ?? 0 });
      cursor = j.nextPageCursor;
      if (!cursor) break;
    }
    return out;
  }

  // Roblox writes go through the worker (CSRF handled there). { ok, status }
  const write = (url, body = {}) => CER.bgFetch(url, "POST", body);

  // ---------------------------------------------------------------- small UI
  const plural = (n, one, many = one + "s") => (n === 1 ? one : many);
  const presenceText = (p) => {
    const s = api.presenceState(p);
    if (s === "ingame") return p.lastLocation ? "Playing " + p.lastLocation : "In a game";
    if (s === "studio") return "In Studio";
    if (s === "online") return "Online";
    return p?.lastOnline ? "Last online " + fmt.ago(p.lastOnline) : "Offline";
  };

  // Line under a friend: the game they are in, else "Your friend too" for
  // mutuals, else userTile's default (@name).
  const friendSub = (f, showMutual) =>
    api.presenceState(f.presence) === "ingame" && f.presence.lastLocation ? f.presence.lastLocation : showMutual && f.mutual ? "Your friend too" : undefined;

  // Popover menu. items: [{ label, icon, href?, onClick? } | null]
  function menu(items) {
    const btn = ui.button("", { icon: "more", variant: "soft", title: "More" });
    const wrap = h("div", { class: "pf-menu-wrap" }, btn);
    let pop = null;
    const close = () => {
      pop?.remove();
      pop = null;
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
    const outside = (e) => !wrap.contains(e.target) && !pop?.contains(e.target) && close();
    const onKey = (e) => e.key === "Escape" && close();
    btn.addEventListener("click", () => {
      if (pop) return close();
      pop = h(
        "div",
        { class: "pf-menu", role: "menu" },
        items.filter(Boolean).map((it) =>
          h(
            it.href ? "a" : "button",
            {
              class: "pf-menu-item",
              role: "menuitem",
              href: it.href,
              type: it.href ? null : "button",
              onClick: () => {
                setTimeout(close); // after the link's own navigation starts
                it.onClick?.();
              },
            },
            ui.icon(it.icon ?? "right", 17),
            h("span", { text: it.label })
          )
        )
      );
      // fixed + outside the hero, so the hero's rounded clip never cuts it
      const r = btn.getBoundingClientRect();
      pop.style.top = r.bottom + 8 + "px";
      pop.style.left = Math.min(r.left, window.innerWidth - 230) + "px";
      (btn.closest("#cer-app") ?? document.body).appendChild(pop);
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", onKey);
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    });
    return wrap;
  }

  // Big number + label, as a link. Value fills in later via .set(n).
  function countBtn(label, href) {
    const val = h("span", { class: "pf-count-val" }, h("span", { class: "pf-sk-text" }));
    const a = h("a", { class: "pf-count", href }, val, h("span", { class: "pf-count-label", text: label }));
    a.set = (n) => {
      val.textContent = n == null ? "–" : fmt.num(n);
      a.title = n == null ? "" : fmt.full(n) + " " + label.toLowerCase();
    };
    return a;
  }

  const gameGrid = (games, sub) =>
    ui.grid(
      games.map((g) => ui.gameCard(g, { sub: sub?.(g) })),
      { min: 230, gap: 18 }
    );
  const skelGrid = (n = 6, kind = "card", min = 230) => ui.grid(ui.skeleton(kind, n), { min, gap: 18 });

  // ---------------------------------------------------------------- page
  async function start() {
    const id = location.pathname.match(/^\/users\/(\d+)\/profile/i)?.[1];
    if (!id) return ui.release();
    const run = ++runId;

    // data that only needs the id starts before anything else
    const userP = loadUser(id);
    const meP = api.me();
    const presenceP = api.presenceOne(id);
    const countP = (k) => get(`https://friends.roblox.com/v1/users/${id}/${k}/count`, 120000).then((j) => j?.count ?? null);
    const countsP = Promise.all([countP("friends"), countP("followers"), countP("followings")]);
    const rolesP = get(`https://groups.roblox.com/v2/users/${id}/groups/roles`, 300000).then((j) => j?.data ?? null);
    const primaryP = get(`https://groups.roblox.com/v1/users/${id}/groups/primary/role`, 300000);
    const ownGamesP = gamesOf("users", id);
    const favP = get(`https://games.roblox.com/v2/users/${id}/favorite/games?limit=50&sortOrder=Desc`, 300000).then((j) =>
      j ? (j.data ?? []).map((g) => ({ universeId: g.id, placeId: g.rootPlace?.id, name: g.name, visits: g.placeVisits })) : null
    );
    const canViewP = get(`https://inventory.roblox.com/v1/users/${id}/can-view-inventory`, 300000).then((j) => j?.canView ?? null);

    // ---- shell (skeletons, mounted right away)
    const { page } = ui.page(TAG, "pf");
    const alive = () => run === runId && page.isConnected;
    const heroEl = h("div", { class: "pf-hero is-loading" }, h("div", { class: "pf-hero-glow" }), h("div", { class: "pf-hero-avatar" }, h("div", { class: "pf-sk-avatar" })), h("div", { class: "pf-hero-main" }, h("div", { class: "pf-sk-line w40" }), h("div", { class: "pf-sk-line w60 tall" }), h("div", { class: "pf-sk-line w30" }), h("div", { class: "pf-sk-line w50" })));
    const tabHost = h("div", { class: "pf-tabbar" });
    const body = h("div", { class: "pf-body" }, ui.cols([ui.skeleton("row", 3)], [ui.skeleton("row", 2)]));
    page.append(heroEl, tabHost, body);

    const [res, me] = await Promise.all([userP, meP]);
    if (!alive()) return;
    if (res.error) throw new Error("user lookup failed"); // route() shows Roblox's page
    if (!me) return ui.release(); // logged out: Roblox's own page
    if (res.gone || res.user?.isBanned) return renderGone(page, res.user);

    const user = res.user;
    const isSelf = String(me.id) === String(id);
    document.title = `${user.displayName} (@${user.name}) - Roblox`;

    // friends lists: theirs + mine (for mutuals), shared by About and Friends
    const theirFriendsP = friendsOf(id);
    const myFriendIdsP = isSelf ? Promise.resolve(null) : friendsOf(me.id).then((l) => (l ? new Set(l.map((f) => String(f.id))) : null));
    const friendsP = Promise.all([theirFriendsP, myFriendIdsP]).then(async ([list, mine]) => {
      if (!list) return null;
      for (const f of list) f.mutual = !!mine?.has(String(f.id));
      // presence for the first 500 (5 batched calls), then sort:
      // mutuals, in game, online, studio, offline
      const pres = await api.presence(list.slice(0, 500).map((f) => f.id));
      const rank = { ingame: 0, studio: 1, online: 2, offline: 3 };
      for (const f of list) f.presence = pres.get(String(f.id)) ?? null;
      list.sort((a, b) => (b.mutual - a.mutual) || rank[api.presenceState(a.presence)] - rank[api.presenceState(b.presence)]);
      return list;
    });

    // games from groups the user OWNS count as their creations too
    const groupGamesP = rolesP.then(async (roles) => {
      const owned = (roles ?? []).filter((r) => r.role?.rank === 255).slice(0, 10);
      const lists = await Promise.all(owned.map((r) => gamesOf("groups", r.group.id, 1).then((gs) => (gs ?? []).map((g) => ({ ...g, group: r.group.name })))));
      return lists.flat();
    });
    const creationsP = Promise.all([ownGamesP, groupGamesP]).then(async ([own, grp]) => {
      const seen = new Set();
      const all = [...(own ?? []), ...grp].filter((g) => g.placeId && !seen.has(g.universeId) && seen.add(g.universeId));
      all.sort((a, b) => b.visits - a.visits);
      await ui.hydrateGames(all);
      return { own: all.filter((g) => !g.group), group: all.filter((g) => g.group), all, failed: own == null && !grp.length };
    });

    // ---- hero
    const hero = buildHero({ id, user, me, isSelf, presenceP, countsP, creationsP, rolesP });
    heroEl.replaceWith(hero);

    // ---- tabs
    const TABS = [
      { id: "about", label: "About" },
      { id: "creations", label: "Creations" },
      { id: "favorites", label: "Favorites" },
      { id: "friends", label: "Friends" },
      { id: "groups", label: "Groups" },
      { id: "badges", label: "Badges" },
    ];
    const panels = {};
    const builders = {
      about: () => aboutPanel(),
      creations: () => creationsPanel(),
      favorites: () => favoritesPanel(),
      friends: () => friendsPanel(),
      groups: () => groupsPanel(),
      badges: () => badgesPanel(),
      items: () => itemsPanel(),
    };
    let current = null;
    const show = (tab) => {
      if (!builders[tab]) tab = "about";
      current = tab;
      tabs.set(tab);
      for (const k in panels) panels[k].hidden = k !== tab;
      if (!panels[tab]) {
        panels[tab] = h("div", { class: "pf-panel", "data-tab": tab });
        body.appendChild(panels[tab]);
        try {
          builders[tab](panels[tab]);
        } catch (e) {
          console.warn("[CER] profile tab failed", tab, e);
          ui.clear(panels[tab], ui.empty("Could not load this part.", { icon: "info" }));
        }
      }
      // remember the tab for this person (a reload keeps it); Roblox's old
      // router strips URL hashes on load, so the hash is only read, not kept
      try {
        sessionStorage.setItem("cer:pf-tab", id + ":" + tab);
      } catch {
        /* storage off */
      }
    };
    const tabs = ui.tabs(TABS, "about", (t) => show(t));
    tabs.classList.add("pf-tabs");
    tabHost.appendChild(tabs);
    body.replaceChildren();

    const setCount = (tabId, n) => {
      const t = TABS.find((x) => x.id === tabId);
      if (!t || !alive()) return;
      t.count = n;
      tabs.set(current);
    };
    // Items tab only when the inventory is public
    canViewP.then((can) => {
      if (!alive() || !can) return;
      TABS.push({ id: "items", label: "Items" });
      tabs.set(current);
    });
    creationsP.then((c) => c.all.length && setCount("creations", c.all.length));
    favP.then((f) => f?.length && setCount("favorites", f.length));
    countsP.then(([fr]) => fr && setCount("friends", fr));
    rolesP.then((r) => r?.length && setCount("groups", r.length));

    // Roblox's old router may rewrite "#x" to "#!#x", so match the name anywhere
    let saved = null;
    try {
      const [sid, stab] = (sessionStorage.getItem("cer:pf-tab") ?? "").split(":");
      if (sid === id) saved = stab;
    } catch {
      /* storage off */
    }
    const want = location.hash.toLowerCase().match(/creations|favorites|friends|groups|badges|items/)?.[0] ?? saved ?? "about";
    // Items exists only once we know the inventory is public
    show(want === "items" ? "about" : want);
    if (want === "items") canViewP.then((can) => can && alive() && current === "about" && show("items"));

    // ================================================================ panels
    function aboutPanel() {
      const panel = panels.about;
      // main column
      const bioCard = ui.card(
        [
          h("h2", { class: "pf-card-title", text: "About" }),
          user.description?.trim() ? ui.clamp(user.description.trim(), 6) : h("p", { class: "pf-muted", text: isSelf ? "You have no bio yet." : "No bio yet." }),
        ],
        { class: "pf-about" }
      );
      const facts = h("div", { class: "pf-facts" });
      bioCard.appendChild(facts);
      const fact = (icon, label, value) => h("div", { class: "pf-fact" }, h("span", { class: "pf-fact-icon" }, ui.icon(icon, 17)), h("div", { class: "pf-fact-text" }, h("span", { class: "pf-fact-label", text: label }), value));
      facts.append(
        fact("calendar", "Joined", h("span", { text: `${fmt.date(user.created)} (${fmt.ago(user.created).replace(" ago", "")})` })),
        fact("hash", "User ID", h("button", { type: "button", class: "pf-copy", title: "Copy ID", onClick: () => ui.copy(String(id), "ID copied") }, h("span", { text: id }), ui.icon("copy", 14)))
      );
      // past names + social links fill in when they land
      get(`https://users.roblox.com/v1/users/${id}/username-history?limit=10&sortOrder=Desc`, 600000).then((j) => {
        const names = (j?.data ?? []).map((x) => x.name).filter(Boolean);
        if (!names.length || !alive()) return;
        facts.appendChild(fact("clock", "Past names", h("div", { class: "pf-names" }, names.map((n) => h("span", { class: "pf-name-chip", text: n })))));
      });
      get(`https://accountinformation.roblox.com/v1/users/${id}/promotion-channels?alwaysReturnUrls=true`, 600000).then((j) => {
        if (!j || !alive()) return;
        const NICE = { facebook: "Facebook", twitter: "X", youtube: "YouTube", twitch: "Twitch", guilded: "Guilded" };
        const links = Object.entries(j)
          .filter(([, v]) => typeof v === "string" && /^https:\/\//i.test(v))
          .map(([k, v]) => h("a", { class: "pf-social", href: v, target: "_blank", rel: "noopener noreferrer" }, ui.icon("link", 15), h("span", { text: NICE[k] ?? k })));
        if (links.length) facts.appendChild(fact("globe", "Links", h("div", { class: "pf-names" }, links)));
      });

      const wearing = ui.section("Wearing now", { icon: "shirt" });
      wearing.body.appendChild(ui.grid(ui.skeleton("tile", 8), { min: 112, gap: 14 }));
      ui.whenVisible(wearing, () => fillWearing(wearing));

      const topGames = ui.section("Top games", { icon: "trophy", action: { label: "All games", onClick: () => show("creations") } });
      topGames.hidden = true;
      creationsP.then((c) => {
        if (!alive() || !c.all.length) return;
        topGames.hidden = false;
        topGames.body.appendChild(gameGrid(c.all.slice(0, 3), (g) => fmt.num(g.visits) + " visits"));
      });

      // side column
      const friendsCard = ui.section("Friends", { icon: "users", action: { label: "See all", onClick: () => show("friends") } });
      friendsCard.classList.add("pf-side-card");
      friendsCard.body.appendChild(h("div", { class: "pf-mini-friends" }, ui.skeleton("tile", 6)));
      Promise.all([friendsP, countsP]).then(([list, [count]]) => {
        if (!alive()) return;
        const box = friendsCard.body;
        if (!list?.length) return ui.clear(box, h("p", { class: "pf-muted", text: list || count === 0 ? "No friends yet." : "Could not load friends." }));
        const mutuals = list.filter((f) => f.mutual).length;
        ui.clear(
          box,
          mutuals ? h("p", { class: "pf-mutual-line" }, ui.icon("userCheck", 15), h("span", { text: `${mutuals} ${plural(mutuals, "friend")} in common` })) : null,
          h(
            "div",
            { class: "pf-mini-friends" },
            list.slice(0, 9).map((f) => ui.userTile(f, { presence: f.presence, size: 64, sub: friendSub(f, true) }))
          )
        );
      });

      const groupsCard = ui.section("Groups", { icon: "shield", action: { label: "See all", onClick: () => show("groups") } });
      groupsCard.classList.add("pf-side-card");
      groupsCard.body.appendChild(h("div", { class: "cer-list" }, ui.skeleton("row", 2)));
      Promise.all([rolesP, primaryP]).then(([roles, prim]) => {
        if (!alive()) return;
        if (!roles?.length) return groupsCard.remove();
        const list = sortGroups(roles, prim);
        ui.clear(groupsCard.body, h("div", { class: "cer-list" }, list.slice(0, 4).map((r) => groupRow(r, prim))));
      });

      const side = [friendsCard, groupsCard];
      if (!isSelf) side.push(noteCard(id));
      panel.appendChild(ui.cols([bioCard, topGames, wearing], side, { side: 340 }));
    }

    async function fillWearing(sec) {
      // avatar/v1 gives names + types in one call (no catalog lookup needed)
      const j = await get(`https://avatar.roblox.com/v1/users/${id}/avatar`, 120000);
      if (!alive()) return;
      if (!j) return ui.clear(sec.body, ui.empty("Could not load this.", { icon: "shirt" }));
      // accessories and clothes first, body parts next, animations last
      const BODY = new Set([17, 27, 28, 29, 30, 31, 79]);
      const tier = (t) => (t >= 48 && t <= 56 ? 2 : BODY.has(t) ? 1 : 0);
      const items = (j.assets ?? []).map((a, i) => ({ id: a.id, name: a.name, type: a.assetType?.name ?? "", t: a.assetType?.id, i }));
      items.sort((a, b) => tier(a.t) - tier(b.t) || a.i - b.i);
      if (!items.length) return ui.clear(sec.body, ui.empty("Not wearing any items.", { icon: "shirt" }));
      const nice = (t) => (t === "TShirt" ? "T-Shirt" : t.replace(/([a-z])([A-Z])/g, "$1 $2"));
      sec.head.querySelector(".cer-block-title").appendChild(h("span", { class: "cer-block-count", text: items.length }));
      ui.clear(
        sec.body,
        ui.grid(
          items.map((a) =>
            h(
              "a",
              { class: "pf-item", href: `${RB}/catalog/${a.id}`, title: a.name },
              h("div", { class: "pf-item-media" }, ui.thumb("asset", a.id)),
              h("span", { class: "pf-item-name", text: a.name }),
              a.type && h("span", { class: "pf-item-sub", text: nice(a.type) })
            )
          ),
          { min: 112, gap: 14 }
        )
      );
    }

    function creationsPanel() {
      const panel = panels.creations;
      panel.appendChild(skelGrid(6));
      creationsP.then((c) => {
        if (!alive()) return;
        panel.replaceChildren();
        if (!c.all.length) return panel.appendChild(ui.empty(c.failed ? "Could not load games." : isSelf ? "You have not made a public game yet." : "No public games yet.", { icon: "gamepad" }));
        const visits = (g) => fmt.num(g.visits) + " visits";
        const secs = [];
        if (c.own.length) {
          const s = ui.section(isSelf ? "Your games" : "Games", { icon: "gamepad", count: c.own.length });
          s.body.appendChild(gameGrid(c.own, visits));
          secs.push([c.own[0].visits, s]);
        }
        if (c.group.length) {
          const s = ui.section("Group games", { icon: "shield", count: c.group.length, sub: isSelf ? "From groups you own" : "From groups they own" });
          s.body.appendChild(gameGrid(c.group, (g) => visits(g) + " · " + g.group));
          secs.push([c.group[0].visits, s]);
        }
        // the list holding the most-visited game goes first
        secs.sort((a, b) => b[0] - a[0]).forEach(([, s]) => panel.appendChild(s));
      });
    }

    function favoritesPanel() {
      const panel = panels.favorites;
      panel.appendChild(skelGrid(6));
      favP.then(async (favs) => {
        if (!alive()) return;
        if (!favs) return ui.clear(panel, ui.empty("Could not load favorites.", { icon: "star" }));
        if (!favs.length) return ui.clear(panel, ui.empty(isSelf ? "Tap the star on a game to save it here." : "No favorite games yet.", { icon: "star" }));
        await ui.hydrateGames(favs);
        if (!alive()) return;
        const s = ui.section("Favorite games", { icon: "star", count: favs.length });
        s.body.appendChild(gameGrid(favs));
        ui.clear(panel, s);
      });
    }

    function friendsPanel() {
      const panel = panels.friends;
      const filters = [{ id: "all", label: "All" }];
      if (!isSelf) filters.push({ id: "mutual", label: "In common" });
      filters.push({ id: "online", label: "Online" });
      let filter = "all";
      let query = "";
      let limit = 60;
      let list = null;
      const grid = h("div", { class: "pf-friends-grid" }, ui.skeleton("tile", 12));
      const moreBtn = ui.button("Show more", { variant: "soft", onClick: () => ((limit += 60), render()) });
      const foot = h("div", { class: "pf-foot" }, moreBtn);
      const chips = ui.chips(filters, filter, (f) => ((filter = f), (limit = 60), render()));
      const search = ui.search("Find a friend", { onInput: (q) => ((query = q.toLowerCase()), (limit = 60), render()) });
      search.classList.add("pf-search");
      const head = ui.section(isSelf ? "Your friends" : "Friends", {
        icon: "users",
        tools: [ui.link("Friends page", { href: `${RB}/users/${id}/friends` })],
      });
      head.body.append(h("div", { class: "pf-toolbar" }, chips, search), grid, foot);
      panel.appendChild(head);

      const render = () => {
        if (!list) return;
        let rows = list;
        if (filter === "mutual") rows = rows.filter((f) => f.mutual);
        if (filter === "online") rows = rows.filter((f) => api.presenceState(f.presence) !== "offline");
        if (query) rows = rows.filter((f) => (f.displayName ?? "").toLowerCase().includes(query) || (f.name ?? "").toLowerCase().includes(query));
        const shown = rows.slice(0, limit);
        if (!rows.length) {
          grid.replaceChildren(ui.empty(list.length ? "No one matches." : isSelf ? "Add friends to see them here." : "No friends yet.", { icon: "users" }));
          grid.classList.add("is-empty");
        } else {
          grid.classList.remove("is-empty");
          grid.replaceChildren(...shown.map((f) => ui.userTile(f, { presence: f.presence, sub: friendSub(f, filter !== "mutual") })));
        }
        foot.hidden = rows.length <= limit;
      };
      foot.hidden = true;
      Promise.all([friendsP, countsP]).then(([l, [count]]) => {
        if (!alive()) return;
        if (!l) {
          head.querySelector(".pf-toolbar").hidden = true;
          grid.replaceChildren(ui.empty(count === 0 ? "No friends yet." : "Could not load friends.", { icon: "users" }));
          grid.classList.add("is-empty");
          return;
        }
        list = l;
        if (!l.length) head.querySelector(".pf-toolbar").hidden = true;
        const mutuals = l.filter((f) => f.mutual).length;
        if (!isSelf) chips.querySelectorAll(".cer-chip")[1]?.append(h("span", { class: "cer-chip-count", text: fmt.num(mutuals) }));
        render();
      });
    }

    function groupsPanel() {
      const panel = panels.groups;
      panel.appendChild(ui.grid(ui.skeleton("row", 6), { min: 300, gap: 12 }));
      Promise.all([rolesP, primaryP]).then(([roles, prim]) => {
        if (!alive()) return;
        if (!roles) return ui.clear(panel, ui.empty("Could not load groups.", { icon: "shield" }));
        if (!roles.length) return ui.clear(panel, ui.empty(isSelf ? "Join a group to see it here." : "Not in any groups.", { icon: "shield" }));
        const s = ui.section("Groups", { icon: "shield", count: roles.length });
        s.body.appendChild(ui.grid(sortGroups(roles, prim).map((r) => groupCard(r, prim)), { min: 300, gap: 12 }));
        ui.clear(panel, s);
      });
    }

    function badgesPanel() {
      const panel = panels.badges;
      // Roblox's own badges (Veteran, Friendship, ...)
      const rb = ui.section("Roblox badges", { icon: "medal" });
      rb.hidden = true;
      get(`https://accountinformation.roblox.com/v1/users/${id}/roblox-badges`, 600000).then((list) => {
        if (!alive() || !Array.isArray(list) || !list.length) return;
        rb.hidden = false;
        rb.body.appendChild(
          h(
            "div",
            { class: "pf-rbadges" },
            list.map((b) => h("a", { class: "pf-rbadge", href: `${RB}/info/roblox-badges#Badge${b.id}`, title: b.description ?? "" }, h("div", { class: "pf-rbadge-img" }, ui.img(b.imageUrl, { alt: "" })), h("span", { text: b.name })))
          )
        );
      });

      const gb = ui.section("Game badges", { icon: "trophy" });
      const grid = h("div", { class: "pf-badges" }, ui.skeleton("row", 8));
      const moreBtn = ui.button("Show more", { variant: "soft" });
      const foot = h("div", { class: "pf-foot" }, moreBtn);
      foot.hidden = true;
      gb.body.append(grid, foot);
      panel.append(rb, gb);

      let cursor = "";
      let total = 0;
      const load = async (first) => {
        moreBtn.busy(true);
        const j = await get(`https://badges.roblox.com/v1/users/${id}/badges?limit=100&sortOrder=Desc${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, 300000);
        moreBtn.busy(false);
        if (!alive()) return;
        if (first) grid.replaceChildren();
        if (!j) {
          if (first) {
            const can = await canViewP;
            grid.replaceChildren(ui.empty(can === false ? "Their badges are private." : "Could not load badges.", { icon: can === false ? "lock" : "trophy" }));
          }
          return;
        }
        const data = j.data ?? [];
        total += data.length;
        if (first && !data.length) {
          const can = await canViewP;
          grid.replaceChildren(ui.empty(can === false ? "Their badges are private." : isSelf ? "Play games to win badges." : "No game badges yet.", { icon: can === false ? "lock" : "trophy" }));
        }
        grid.append(...data.map(badgeTile));
        cursor = j.nextPageCursor ?? "";
        foot.hidden = !cursor;
        const c = gb.querySelector(".cer-block-count") ?? gb.head.querySelector(".cer-block-title").appendChild(h("span", { class: "cer-block-count" }));
        c.textContent = fmt.num(total) + (cursor ? "+" : "");
        if (!total) c.remove();
      };
      moreBtn.addEventListener("click", () => load(false));
      load(true);
    }

    function itemsPanel() {
      const panel = panels.items;
      const TYPES = [
        { id: "limited", label: "Limiteds" },
        { id: "8", label: "Hats" },
        { id: "41", label: "Hair" },
        { id: "42", label: "Face" },
        { id: "18", label: "Faces" },
        { id: "11", label: "Shirts" },
        { id: "12", label: "Pants" },
        { id: "2", label: "T-Shirts" },
        { id: "61", label: "Emotes" },
        { id: "19", label: "Gear" },
      ];
      let type = "8";
      let token = 0;
      const grid = h("div", { class: "pf-items-grid" });
      const foot = h("div", { class: "pf-foot" }, ui.link("All items", { href: `${RB}/users/${id}/inventory` }));
      const sec = ui.section(isSelf ? "Your items" : "Items", { icon: "bag" });
      sec.body.append(h("div", { class: "pf-toolbar" }, ui.chips(TYPES, type, (t) => ((type = t), load()))), grid, foot);
      panel.appendChild(sec);
      const load = async () => {
        const my = ++token;
        grid.replaceChildren(...ui.skeleton("tile", 12));
        const url =
          type === "limited"
            ? `https://inventory.roblox.com/v1/users/${id}/assets/collectibles?limit=50&sortOrder=Desc`
            : `https://inventory.roblox.com/v2/users/${id}/inventory/${type}?limit=50&sortOrder=Desc`;
        const j = await get(url, 300000);
        if (my !== token || !alive()) return;
        const rows = (j?.data ?? []).map((it) => ({ id: it.assetId, name: it.assetName ?? it.name ?? "", rap: it.recentAveragePrice }));
        if (!rows.length) return grid.replaceChildren(ui.empty(j ? "Nothing here yet." : "Could not load items.", { icon: "bag" }));
        grid.replaceChildren(
          ...rows.map((r) =>
            h(
              "a",
              { class: "pf-item", href: `${RB}/catalog/${r.id}`, title: r.name },
              h("div", { class: "pf-item-media" }, ui.thumb("asset", r.id)),
              h("span", { class: "pf-item-name", text: r.name }),
              r.rap ? h("span", { class: "pf-item-sub" }, ui.icon("robux", 13), h("span", { text: fmt.num(r.rap) })) : null
            )
          )
        );
      };
      load();
    }

    // ---------------------------------------------------------------- groups
    function sortGroups(roles, prim) {
      const pid = prim?.group?.id;
      return [...roles].sort((a, b) => (b.group.id === pid) - (a.group.id === pid) || (b.role.rank === 255) - (a.role.rank === 255) || (b.group.memberCount ?? 0) - (a.group.memberCount ?? 0));
    }
    function groupRow(r, prim) {
      return h(
        "a",
        { class: "cer-row pf-group-row", href: `${RB}/communities/${r.group.id}` },
        h("div", { class: "pf-group-icon sm" }, ui.thumb("groupIcon", r.group.id)),
        h("div", { class: "cer-row-main" }, h("span", { class: "cer-row-title" }, h("span", { text: r.group.name }), r.group.hasVerifiedBadge && ui.icon("verified", 14, "pf-verified")), h("span", { class: "cer-row-sub pf-group-role" }, r.role.rank === 255 && ui.icon("crown", 13), h("span", { text: r.role.name }))),
        prim?.group?.id === r.group.id ? ui.badge("Main", "accent") : null
      );
    }
    function groupCard(r, prim) {
      const isMain = prim?.group?.id === r.group.id;
      return h(
        "a",
        { class: "pf-group", href: `${RB}/communities/${r.group.id}` },
        h("div", { class: "pf-group-icon" }, ui.thumb("groupIcon", r.group.id)),
        h(
          "div",
          { class: "pf-group-text" },
          h("span", { class: "pf-group-name" }, h("span", { text: r.group.name }), r.group.hasVerifiedBadge && ui.icon("verified", 15, "pf-verified")),
          h("span", { class: "pf-group-role" }, r.role.rank === 255 && ui.icon("crown", 14), h("span", { text: r.role.name })),
          h("span", { class: "pf-group-meta" }, ui.icon("users", 13), h("span", { text: fmt.num(r.group.memberCount) + " " + plural(r.group.memberCount, "member") }))
        ),
        isMain ? ui.badge("Main", "accent") : null
      );
    }

    function badgeTile(b) {
      const pct = b.statistics?.winRatePercentage;
      return h(
        "a",
        { class: "pf-badge", href: `${RB}/badges/${b.id}`, title: b.displayDescription ?? b.description ?? "" },
        h("div", { class: "pf-badge-img" }, ui.thumb("badge", b.id)),
        h(
          "div",
          { class: "pf-badge-text" },
          h("span", { class: "pf-badge-name", text: b.displayName ?? b.name }),
          pct != null ? h("span", { class: "pf-badge-sub", text: pct < 0.1 ? "Very rare" : `${+(pct * 100).toFixed(pct < 0.01 ? 2 : 1)}% have it` }) : null
        )
      );
    }
  }

  // ---------------------------------------------------------------- hero
  function buildHero({ id, user, me, isSelf, presenceP, countsP, creationsP, rolesP }) {
    const avatarImg = ui.thumb("avatarLg", id, { class: "pf-hero-figure", alt: user.displayName });
    const bg = h("div", { class: "pf-hero-bg" });
    api.thumb("avatarLg", id).then((url) => url && (bg.style.backgroundImage = `url("${url.replace(/"/g, "")}")`));

    const status = h("div", { class: "pf-status" });
    const playing = h("div", { class: "pf-playing", hidden: true });
    const friendsUrl = (hash) => `${RB}/users/${id}/friends#!/${hash}`;
    const counts = [countBtn("Friends", friendsUrl("friends")), countBtn("Followers", friendsUrl("followers")), countBtn("Following", friendsUrl("following"))];
    countsP.then((ns) => ns.forEach((n, i) => counts[i].set(n)));

    // quick facts on the right (wide screens only)
    const side = h("div", { class: "pf-hero-side" });
    const years = Math.floor((Date.now() - new Date(user.created)) / 31557600000);
    const fact = (icon, value, label) => h("div", { class: "pf-hero-fact" }, h("span", { class: "pf-hero-fact-icon" }, ui.icon(icon, 18)), h("div", {}, h("div", { class: "pf-hero-fact-val", text: value }), h("div", { class: "pf-hero-fact-label", text: label })));
    side.appendChild(fact("calendar", years >= 1 ? `${years} ${years === 1 ? "year" : "years"}` : "New", "On Roblox"));
    creationsP.then((c) => {
      const visits = c.all.reduce((n, g) => n + (g.visits || 0), 0);
      if (visits > 0) side.prepend(fact("eye", fmt.num(visits), "Game visits"));
    });
    rolesP.then((r) => r?.length && side.appendChild(fact("shield", fmt.num(r.length), r.length === 1 ? "Group" : "Groups")));

    const actions = h("div", { class: "pf-actions" });
    const profileUrl = `${RB}/users/${id}/profile`;
    if (isSelf) {
      actions.append(
        ui.button("Edit avatar", { icon: "shirt", variant: "primary", href: `${RB}/my/avatar` }),
        ui.button("Customize", { icon: "edit", variant: "soft", href: `${RB}/my/account#!/info` }),
        menu([
          { label: "Copy profile link", icon: "link", onClick: () => ui.copy(profileUrl, "Link copied") },
          { label: "My items", icon: "bag", href: `${RB}/users/${id}/inventory` },
          { label: "Roblox's page", icon: "external", href: ui.nativeUrl(profileUrl) },
        ])
      );
    } else {
      const friendSlot = h("span", { class: "pf-slot" }, ui.button("Add friend", { icon: "userPlus", variant: "primary", disabled: true }));
      const followSlot = h("span", { class: "pf-slot" });
      const chatSlot = h("span", { class: "pf-slot" });
      actions.append(
        friendSlot,
        chatSlot,
        followSlot,
        menu([
          { label: "Copy profile link", icon: "link", onClick: () => ui.copy(profileUrl, "Link copied") },
          { label: "Copy user ID", icon: "hash", onClick: () => ui.copy(String(id), "ID copied") },
          { label: "See items", icon: "bag", href: `${RB}/users/${id}/inventory` },
          { label: "Trade", icon: "box", href: `${RB}/users/${id}/trade` },
          { label: "Roblox's page", icon: "external", href: ui.nativeUrl(profileUrl) },
        ])
      );
      wireFriend(friendSlot, chatSlot, id, me, user);
      wireFollow(followSlot, id);
    }

    const hero = h(
      "section",
      { class: "pf-hero" },
      bg,
      h("div", { class: "pf-hero-glow" }),
      h("div", { class: "pf-hero-avatar" }, h("div", { class: "pf-hero-floor" }), avatarImg),
      h(
        "div",
        { class: "pf-hero-main" },
        status,
        h("h1", { class: "pf-name" }, h("span", { text: user.displayName }), user.hasVerifiedBadge && ui.icon("verified", 26, "pf-verified")),
        h(
          "div",
          { class: "pf-handle" },
          h("span", { text: "@" + user.name }),
          h("span", { class: "pf-dot" }),
          h("span", { class: "pf-joined" }, ui.icon("calendar", 15), h("span", { text: "Joined " + new Date(user.created).toLocaleDateString("en", { month: "short", year: "numeric" }) }))
        ),
        playing,
        h("div", { class: "pf-counts" }, counts),
        actions
      ),
      side
    );

    presenceP.then(async (p) => {
      const state = api.presenceState(p);
      status.className = "pf-status is-" + state;
      ui.clear(status, h("span", { class: "pf-status-dot" }), h("span", { text: isSelf && state === "offline" ? "Online" : presenceText(p) }));
      if (isSelf && state === "offline") status.className = "pf-status is-online";
      if (state !== "ingame" || !(p.placeId || p.rootPlaceId)) return;
      // "Playing X" card with the game's icon and a Join button when we can join
      const placeId = p.rootPlaceId ?? p.placeId;
      const uni = p.universeId ?? (await api.universeOf(placeId));
      const canJoin = !!(p.gameId && p.placeId);
      ui.clear(
        playing,
        h("a", { class: "pf-playing-icon", href: `${RB}/games/${placeId}` }, ui.thumb("gameIcon", uni)),
        h("a", { class: "pf-playing-text", href: `${RB}/games/${placeId}` }, h("span", { class: "pf-playing-label", text: "Playing now" }), h("span", { class: "pf-playing-name", text: p.lastLocation || "A game" })),
        canJoin
          ? ui.button("Join", { icon: "play", variant: "light", onClick: () => ui.play(p.placeId, p.gameId) })
          : ui.button("Play", { icon: "play", variant: "light", onClick: () => ui.play(placeId) })
      );
      playing.hidden = false;
    });

    return hero;
  }

  // Friend button: status → Add friend / Request sent / Accept / Friends.
  async function wireFriend(slot, chatSlot, id, me, user) {
    const j = await api.json(`https://friends.roblox.com/v1/users/${me.id}/friends/statuses?userIds=${id}`, { bg: true });
    let status = j?.data?.[0]?.status ?? "NotFriends";
    const askRoblox = () =>
      ui.modal({
        title: "Finish on Roblox",
        body: h("p", { text: "Roblox wants a quick check. Do it on Roblox's page." }),
        actions: [
          { label: "Cancel", variant: "ghost" },
          { label: "Open page", variant: "primary", onClick: (close) => (close(), (location.href = ui.nativeUrl())) },
        ],
      });
    const render = () => {
      let b;
      if (status === "Friends") {
        b = ui.button("Friends", { icon: "userCheck", variant: "soft", title: "Unfriend" });
        b.addEventListener("click", () =>
          ui.modal({
            title: "Unfriend " + user.displayName + "?",
            body: h("p", { text: "You will not be friends anymore." }),
            actions: [
              { label: "Cancel", variant: "ghost" },
              {
                label: "Unfriend",
                variant: "danger",
                onClick: async (close) => {
                  close();
                  b.busy(true);
                  const r = await write(`https://friends.roblox.com/v1/users/${id}/unfriend`);
                  if (r.ok) (status = "NotFriends"), CER.toast("Unfriended");
                  else CER.toast("Could not unfriend", "error");
                  render();
                },
              },
            ],
          })
        );
      } else if (status === "RequestSent") {
        b = ui.button("Request sent", { icon: "clock", variant: "soft", disabled: true });
      } else if (status === "RequestReceived") {
        b = ui.button("Accept friend", { icon: "userCheck", variant: "primary" });
        b.addEventListener("click", async () => {
          b.busy(true);
          const r = await write(`https://friends.roblox.com/v1/users/${id}/accept-friend-request`);
          if (r.ok) (status = "Friends"), CER.toast("You are friends now!");
          else if (r.status === 403) askRoblox();
          else CER.toast("Could not accept", "error");
          render();
        });
      } else {
        b = ui.button("Add friend", { icon: "userPlus", variant: "primary" });
        b.addEventListener("click", async () => {
          b.busy(true);
          const r = await write(`https://friends.roblox.com/v1/users/${id}/request-friendship`, { friendshipOriginSourceType: "UserProfile" });
          if (r.ok && r.data?.success !== false) (status = "RequestSent"), CER.toast("Friend request sent");
          else if (r.status === 403 || r.data?.isCaptchaRequired) askRoblox();
          else CER.toast("Could not send request", "error");
          render();
        });
      }
      slot.replaceChildren(b);
      // Roblox chat is for friends: CER's chat panel when it is on, else
      // Roblox's own profile (its Message button opens Roblox's chat)
      chatSlot.replaceChildren(
        status === "Friends"
          ? CER.toggleChat
            ? ui.button("Chat", { icon: "chat", variant: "soft", onClick: () => CER.toggleChat() })
            : ui.button("Chat", { icon: "chat", variant: "soft", href: ui.nativeUrl() })
          : ""
      );
    };
    render();
  }

  // Follow / Following toggle.
  async function wireFollow(slot, id) {
    const j = await api.json("https://friends.roblox.com/v1/user/following-exists", { method: "POST", bg: true, body: { targetUserIds: [Number(id)] } });
    let following = !!j?.followings?.[0]?.isFollowing;
    const render = () => {
      const b = ui.button(following ? "Following" : "Follow", { icon: following ? "check" : "plus", variant: following ? "soft" : "outline", title: following ? "Stop following" : null });
      b.addEventListener("click", async () => {
        b.busy(true);
        const r = await write(`https://friends.roblox.com/v1/users/${id}/${following ? "unfollow" : "follow"}`);
        if (r.ok) following = !following;
        else if (r.status === 403) location.href = ui.nativeUrl(); // captcha: Roblox's page runs it
        else CER.toast("Could not do that", "error");
        render();
      });
      slot.replaceChildren(b);
    };
    render();
  }

  // Private note about another user (stored only in this browser).
  function noteCard(id) {
    const area = h("textarea", { class: "cer-textarea pf-note", placeholder: "Write a note about this person.", maxlength: "2000" });
    const card = ui.section("My note", { icon: "edit", sub: "Only you can see this" });
    card.classList.add("pf-side-card");
    card.body.appendChild(area);
    CER.ext.storage.local
      .get("playerNotes")
      .then(({ playerNotes = {} }) => (area.value = playerNotes[id] ?? ""))
      .catch(() => {});
    let t = null;
    area.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        let cur = {};
        try {
          ({ playerNotes: cur = {} } = await CER.ext.storage.local.get("playerNotes"));
        } catch {
          return;
        }
        const v = area.value.trim();
        if (v) cur[id] = v;
        else delete cur[id];
        await CER.set({ playerNotes: cur });
      }, 500);
    });
    return card;
  }

  // Banned, deleted or unknown account.
  function renderGone(page, user) {
    page.replaceChildren(
      h(
        "div",
        { class: "pf-gone" },
        ui.empty(user?.isBanned ? "This account is closed." : "We could not find this person.", {
          icon: "user",
          action: ui.button("Go home", { icon: "home", variant: "soft", href: `${RB}/home` }),
        })
      )
    );
  }
})();
