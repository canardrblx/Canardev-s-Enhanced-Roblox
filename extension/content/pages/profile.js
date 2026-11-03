// CER profile page (/users/{id}/profile). Built on CER.ui (content/ui.js).
// Roblox is only a data source here (its web APIs) and an action source
// (friend / follow writes, game launch). Nothing is read from its page DOM.
//
// A player profile, not a dashboard: art first, little text.
//   hero      big full-body avatar, name, presence (+ Join when playing),
//             quiet friend / follower counts, ONE primary action + a menu
//   tabs      Overview · Games · Friends · Badges (panels built on first open)
//
// Promotable bits built here: menu() (popover menu that escapes clipping).

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
  const presenceText = (p) => {
    const s = api.presenceState(p);
    if (s === "ingame") return "In a game";
    if (s === "studio") return "In Studio";
    if (s === "online") return "Online";
    return p?.lastOnline ? "Online " + fmt.ago(p.lastOnline) : "Offline";
  };
  // Line under a friend: only the game they are in (no other text).
  const friendSub = (f) => (api.presenceState(f.presence) === "ingame" && f.presence.lastLocation ? f.presence.lastLocation : "");

  // Popover menu. items: () => [{ label, icon, href?, onClick? } | null]
  // Fixed-position and mounted outside the hero, so no rounded clip cuts it.
  function menu(items) {
    const btn = ui.button("", { icon: "more", variant: "soft", title: "More" });
    let pop = null;
    const close = () => {
      pop?.remove();
      pop = null;
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
    const outside = (e) => !btn.contains(e.target) && !pop?.contains(e.target) && close();
    const onKey = (e) => e.key === "Escape" && close();
    btn.addEventListener("click", () => {
      if (pop) return close();
      pop = h(
        "div",
        { class: "pf-menu", role: "menu" },
        items()
          .filter(Boolean)
          .map((it) =>
            h(
              it.href ? "a" : "button",
              {
                class: "pf-menu-item",
                role: "menuitem",
                href: it.href,
                type: it.href ? null : "button",
                onClick: () => {
                  setTimeout(close); // after a link's own navigation starts
                  it.onClick?.();
                },
              },
              ui.icon(it.icon ?? "right", 17),
              h("span", { text: it.label })
            )
          )
      );
      const r = btn.getBoundingClientRect();
      pop.style.top = r.bottom + 8 + "px";
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 230)) + "px";
      (btn.closest("#cer-app") ?? document.body).appendChild(pop);
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", onKey);
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    });
    return btn;
  }

  // ui.icon("verified") already draws in currentColor (seal) + page bg (check)
  const verified = (size) => ui.icon("verified", size, "pf-verified");

  const gameGrid = (games) => ui.grid(games.map((g) => ui.gameCard(g)), { min: 240, gap: 18 });
  const skelGrid = (n = 6, kind = "card", min = 240) => ui.grid(ui.skeleton(kind, n), { min, gap: 18 });
  // plain section: bold title, no icon / count / subtitle
  const section = (title, action) => ui.section(title, action ? { action } : {});

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
    const countsP = Promise.all([countP("friends"), countP("followers")]);
    const rolesP = get(`https://groups.roblox.com/v2/users/${id}/groups/roles`, 300000).then((j) => j?.data ?? null);
    const primaryP = get(`https://groups.roblox.com/v1/users/${id}/groups/primary/role`, 300000);
    const ownGamesP = gamesOf("users", id);
    const favP = get(`https://games.roblox.com/v2/users/${id}/favorite/games?limit=50&sortOrder=Desc`, 300000).then((j) =>
      j ? (j.data ?? []).map((g) => ({ universeId: g.id, placeId: g.rootPlace?.id, name: g.name })) : null
    );
    const canViewP = get(`https://inventory.roblox.com/v1/users/${id}/can-view-inventory`, 300000).then((j) => j?.canView ?? null);

    // ---- shell (skeletons, mounted right away)
    const { page } = ui.page(TAG, "pf");
    const alive = () => run === runId && page.isConnected;
    const heroEl = h(
      "div",
      { class: "pf-hero is-loading" },
      h("div", { class: "pf-hero-avatar" }, h("div", { class: "pf-sk pf-sk-avatar" })),
      h("div", { class: "pf-hero-main" }, h("div", { class: "pf-sk pf-sk-line w30" }), h("div", { class: "pf-sk pf-sk-line w60 tall" }), h("div", { class: "pf-sk pf-sk-line w40" }))
    );
    const tabHost = h("div", { class: "pf-tabbar" });
    const body = h("div", { class: "pf-body" }, skelGrid(4));
    page.append(heroEl, tabHost, body);

    const [res, me] = await Promise.all([userP, meP]);
    if (!alive()) return;
    if (res.error) throw new Error("user lookup failed"); // route() shows Roblox's page
    if (!me) return ui.release(); // logged out: Roblox's own page
    if (res.gone || res.user?.isBanned) return renderGone(page, res.user);

    const user = res.user;
    const isSelf = String(me.id) === String(id);
    document.title = `${user.displayName} (@${user.name}) - Roblox`;

    // friends: theirs + mine (for mutuals first), shared by Overview + Friends
    const theirFriendsP = friendsOf(id);
    const myFriendIdsP = isSelf ? Promise.resolve(null) : friendsOf(me.id).then((l) => (l ? new Set(l.map((f) => String(f.id))) : null));
    const friendsP = Promise.all([theirFriendsP, myFriendIdsP]).then(async ([list, mine]) => {
      if (!list) return null;
      for (const f of list) f.mutual = !!mine?.has(String(f.id));
      // presence for the first 500 (5 batched calls), then sort:
      // friends you share, in game, studio, online, offline
      const pres = await api.presence(list.slice(0, 500).map((f) => f.id));
      const rank = { ingame: 0, studio: 1, online: 2, offline: 3 };
      for (const f of list) f.presence = pres.get(String(f.id)) ?? null;
      list.sort((a, b) => b.mutual - a.mutual || rank[api.presenceState(a.presence)] - rank[api.presenceState(b.presence)]);
      return list;
    });

    // games from groups the user OWNS count as their creations too
    const groupGamesP = rolesP.then(async (roles) => {
      const owned = (roles ?? []).filter((r) => r.role?.rank === 255).slice(0, 10);
      const lists = await Promise.all(owned.map((r) => gamesOf("groups", r.group.id, 1).then((gs) => gs ?? [])));
      return lists.flat();
    });
    const creationsP = Promise.all([ownGamesP, groupGamesP]).then(async ([own, grp]) => {
      const seen = new Set();
      const all = [...(own ?? []), ...grp].filter((g) => g.placeId && !seen.has(g.universeId) && seen.add(g.universeId));
      all.sort((a, b) => b.visits - a.visits);
      await ui.hydrateGames(all);
      return { all, failed: own == null && !grp.length };
    });

    heroEl.replaceWith(buildHero({ id, user, me, isSelf, presenceP, countsP }));

    // ---- tabs
    const TABS = [
      { id: "overview", label: "Overview" },
      { id: "games", label: "Games" },
      { id: "friends", label: "Friends" },
      { id: "badges", label: "Badges" },
    ];
    const builders = { overview: overviewPanel, games: gamesPanel, friends: friendsPanel, badges: badgesPanel };
    const panels = {};
    let current = null;
    const show = (tab) => {
      if (!builders[tab]) tab = "overview";
      current = tab;
      tabs.set(tab);
      for (const k in panels) panels[k].hidden = k !== tab;
      if (!panels[tab]) {
        panels[tab] = h("div", { class: "pf-panel" });
        body.appendChild(panels[tab]);
        try {
          builders[tab](panels[tab]);
        } catch (e) {
          console.warn("[CER] profile tab failed", tab, e);
          ui.clear(panels[tab], ui.empty("Could not load this.", { icon: "info" }));
        }
      }
      // remember the tab for this person (Roblox's router strips URL hashes)
      try {
        sessionStorage.setItem("cer:pf-tab", id + ":" + tab);
      } catch {
        /* storage off */
      }
    };
    const tabs = ui.tabs(TABS, "overview", show);
    tabs.classList.add("pf-tabs");
    tabHost.appendChild(tabs);
    body.replaceChildren();
    let saved = null;
    try {
      const [sid, stab] = (sessionStorage.getItem("cer:pf-tab") ?? "").split(":");
      if (sid === id) saved = stab;
    } catch {
      /* storage off */
    }
    show(location.hash.toLowerCase().match(/games|friends|badges/)?.[0] ?? saved ?? "overview");

    // ================================================================ panels
    function overviewPanel(panel) {
      // bio: plain text, no card. Quiet join line under it.
      const about = h("div", { class: "pf-about" });
      if (user.description?.trim()) about.appendChild(ui.clamp(user.description.trim(), 3));
      const meta = h("div", { class: "pf-meta" }, h("span", { text: "Joined " + fmt.date(user.created) }));
      about.appendChild(meta);
      // social links, only if they set any (rare)
      get(`https://accountinformation.roblox.com/v1/users/${id}/promotion-channels?alwaysReturnUrls=true`, 600000).then((j) => {
        if (!j || !alive()) return;
        const NICE = { facebook: "Facebook", twitter: "X", youtube: "YouTube", twitch: "Twitch", guilded: "Guilded" };
        for (const [k, v] of Object.entries(j))
          if (typeof v === "string" && /^https:\/\//i.test(v)) meta.appendChild(h("a", { class: "pf-meta-link", href: v, target: "_blank", rel: "noopener noreferrer", text: NICE[k] ?? k }));
      });

      const games = section("Games", { label: "See all", onClick: () => show("games") });
      games.body.appendChild(ui.rail(ui.skeleton("card", 4), { item: 260 }));
      creationsP.then((c) => {
        if (!alive()) return;
        if (!c.all.length) return games.remove();
        ui.clear(games.body, ui.rail(c.all.slice(0, 10).map((g) => ui.gameCard(g)), { item: 260 }));
      });

      const friends = section("Friends", { label: "See all", onClick: () => show("friends") });
      friends.body.appendChild(ui.rail(ui.skeleton("tile", 8), { item: 104 }));
      friendsP.then((list) => {
        if (!alive()) return;
        if (!list?.length) return friends.remove();
        ui.clear(friends.body, ui.rail(list.slice(0, 24).map((f) => ui.userTile(f, { presence: f.presence, size: 84, sub: friendSub(f) })), { item: 104 }));
      });

      const groups = section("Groups");
      groups.body.appendChild(ui.rail(ui.skeleton("tile", 8), { item: 120 }));
      Promise.all([rolesP, primaryP]).then(([roles, prim]) => {
        if (!alive()) return;
        if (!roles?.length) return groups.remove();
        const pid = prim?.group?.id;
        const list = [...roles].sort((a, b) => (b.group.id === pid) - (a.group.id === pid) || (b.role.rank === 255) - (a.role.rank === 255) || (b.group.memberCount ?? 0) - (a.group.memberCount ?? 0));
        ui.clear(groups.body, ui.rail(list.map(groupTile), { item: 120 }));
      });

      const wearing = section("Wearing");
      wearing.body.appendChild(ui.grid(ui.skeleton("tile", 8), { min: 112, gap: 14 }));
      ui.whenVisible(wearing, () => fillWearing(wearing));

      panel.append(about, games, friends, groups, wearing);
    }

    async function fillWearing(sec) {
      // avatar/v1 gives names in one call. Clothes and accessories only:
      // body parts and animations are not interesting to look at.
      const j = await get(`https://avatar.roblox.com/v1/users/${id}/avatar`, 120000);
      if (!alive()) return;
      const SKIP = new Set([17, 27, 28, 29, 30, 31, 48, 49, 50, 51, 52, 53, 54, 55, 56, 61, 78, 79]);
      let items = (j?.assets ?? []).filter((a) => !SKIP.has(a.assetType?.id));
      if (!j) {
        // busy (429): the plain id list still gives the art, just no names
        const w = await get(`https://avatar.roblox.com/v1/users/${id}/currently-wearing`, 120000);
        if (!alive()) return;
        if (!w) return ui.clear(sec.body, ui.empty("Could not load this.", { icon: "shirt" }));
        items = (w.assetIds ?? []).map((a) => ({ id: a, name: "" }));
      }
      if (!items.length) return sec.remove();
      ui.clear(
        sec.body,
        ui.grid(
          items.map((a) => h("a", { class: "pf-item", href: `${RB}/catalog/${a.id}`, title: a.name }, h("div", { class: "pf-item-media" }, ui.thumb("asset", a.id)), a.name && h("span", { class: "pf-item-name", text: a.name }))),
          { min: 112, gap: 14 }
        )
      );
    }

    function gamesPanel(panel) {
      const made = section(isSelf ? "Your games" : "Creations");
      made.body.appendChild(skelGrid(4));
      const favs = section("Favorites");
      favs.body.appendChild(skelGrid(4));
      panel.append(made, favs);
      creationsP.then((c) => {
        if (!alive()) return;
        if (!c.all.length) return c.failed ? ui.clear(made.body, ui.empty("Could not load games.", { icon: "gamepad" })) : made.remove();
        ui.clear(made.body, gameGrid(c.all));
      });
      favP.then(async (list) => {
        if (list?.length) await ui.hydrateGames(list);
        if (!alive()) return;
        if (!list?.length) return favs.remove();
        ui.clear(favs.body, gameGrid(list));
      });
      // nothing at all: one simple line instead of two empty sections
      Promise.all([creationsP, favP]).then(([c, f]) => {
        if (alive() && !c.all.length && !c.failed && !f?.length) panel.appendChild(ui.empty("No games yet.", { icon: "gamepad" }));
      });
    }

    function friendsPanel(panel) {
      const filters = [{ id: "all", label: "All" }];
      if (!isSelf) filters.push({ id: "mutual", label: "In common" });
      filters.push({ id: "online", label: "Online" });
      let filter = "all";
      let query = "";
      let limit = 60;
      let list = null;
      const grid = h("div", { class: "pf-friends-grid" }, ui.skeleton("tile", 16));
      const moreBtn = ui.button("Show more", { variant: "soft", onClick: () => ((limit += 60), render()) });
      const foot = h("div", { class: "pf-foot", hidden: true }, moreBtn);
      const chips = ui.chips(filters, filter, (f) => ((filter = f), (limit = 60), render()));
      const search = ui.search("Find a friend", { onInput: (q) => ((query = q.toLowerCase()), (limit = 60), render()) });
      search.classList.add("pf-search");
      const toolbar = h("div", { class: "pf-toolbar" }, chips, search);
      panel.append(toolbar, grid, foot);

      const render = () => {
        if (!list) return;
        let rows = list;
        if (filter === "mutual") rows = rows.filter((f) => f.mutual);
        if (filter === "online") rows = rows.filter((f) => api.presenceState(f.presence) !== "offline");
        if (query) rows = rows.filter((f) => (f.displayName ?? "").toLowerCase().includes(query) || (f.name ?? "").toLowerCase().includes(query));
        grid.classList.toggle("is-empty", !rows.length);
        if (!rows.length) grid.replaceChildren(ui.empty("No one here.", { icon: "users" }));
        else grid.replaceChildren(...rows.slice(0, limit).map((f) => ui.userTile(f, { presence: f.presence, sub: friendSub(f) })));
        foot.hidden = rows.length <= limit;
      };
      Promise.all([friendsP, countsP]).then(([l, [count]]) => {
        if (!alive()) return;
        if (!l?.length) {
          toolbar.hidden = true;
          grid.classList.add("is-empty");
          grid.replaceChildren(ui.empty(l || count === 0 ? "No friends yet." : "Could not load friends.", { icon: "users" }));
          return;
        }
        list = l;
        render();
      });
    }

    function badgesPanel(panel) {
      // one grid: Roblox's own badges first, then game badges
      const grid = h("div", { class: "pf-badges" }, ui.skeleton("tile", 12));
      const moreBtn = ui.button("Show more", { variant: "soft" });
      const foot = h("div", { class: "pf-foot", hidden: true }, moreBtn);
      panel.append(grid, foot);
      const robloxP = get(`https://accountinformation.roblox.com/v1/users/${id}/roblox-badges`, 600000);
      let cursor = "";
      const load = async (first) => {
        moreBtn.busy(true);
        const url = `https://badges.roblox.com/v1/users/${id}/badges?limit=100&sortOrder=Desc${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`;
        const [j, rb] = await Promise.all([get(url, 300000), first ? robloxP : null]);
        moreBtn.busy(false);
        if (!alive()) return;
        if (first) {
          grid.replaceChildren(
            ...(Array.isArray(rb) ? rb : []).map((b) => badgeTile({ href: `${RB}/info/roblox-badges#Badge${b.id}`, name: b.name, tip: b.description, img: ui.img(b.imageUrl, { alt: "" }), roblox: true }))
          );
        }
        const data = j?.data ?? [];
        grid.append(...data.map((b) => badgeTile({ href: `${RB}/badges/${b.id}`, name: b.displayName ?? b.name, tip: b.displayDescription ?? b.description, img: ui.thumb("badge", b.id) })));
        cursor = j?.nextPageCursor ?? "";
        foot.hidden = !cursor;
        if (first && !grid.children.length) {
          const can = await canViewP;
          grid.classList.add("is-empty");
          grid.replaceChildren(ui.empty(!j && can === false ? "Badges are private." : j ? "No badges yet." : "Could not load badges.", { icon: can === false ? "lock" : "trophy" }));
        }
      };
      moreBtn.addEventListener("click", () => load(false));
      load(true);
    }
  }

  function groupTile(r) {
    return h(
      "a",
      { class: "pf-group", href: `${RB}/communities/${r.group.id}`, title: r.group.name },
      h("div", { class: "pf-group-icon" }, ui.thumb("groupIconLg", r.group.id)),
      h("span", { class: "pf-group-name" }, h("span", { text: r.group.name }), r.group.hasVerifiedBadge && verified(14))
    );
  }

  function badgeTile(b) {
    return h("a", { class: "pf-badge" + (b.roblox ? " is-roblox" : ""), href: b.href, title: b.tip ?? "" }, h("div", { class: "pf-badge-img" }, b.img), h("span", { class: "pf-badge-name", text: b.name }));
  }

  // ---------------------------------------------------------------- hero
  function buildHero({ id, user, me, isSelf, presenceP, countsP }) {
    const bg = h("div", { class: "pf-hero-bg" });
    api.thumb("avatarLg", id).then((url) => url && (bg.style.backgroundImage = `url("${url.replace(/"/g, "")}")`));

    const status = h("div", { class: "pf-status" });
    const playing = h("div", { class: "pf-playing", hidden: true });

    // quiet counts, each a link to the Friends page
    const friendsUrl = (hash) => `${RB}/users/${id}/friends#!/${hash}`;
    const counts = h("div", { class: "pf-counts" });
    countsP.then(([fr, fo]) => {
      const one = (n, label, hash) => n != null && h("a", { class: "pf-count", href: friendsUrl(hash), title: fmt.full(n) }, h("b", { text: fmt.num(n) }), " " + label);
      counts.append(one(fr, fr === 1 ? "friend" : "friends", "friends") || "", one(fo, fo === 1 ? "follower" : "followers", "followers") || "");
    });

    const actions = h("div", { class: "pf-actions" });
    const profileUrl = `${RB}/users/${id}/profile`;
    if (isSelf) {
      actions.append(
        ui.button("Edit avatar", { icon: "shirt", variant: "primary", size: "lg", href: `${RB}/my/avatar` }),
        menu(() => [
          { label: "Edit profile", icon: "edit", href: `${RB}/my/account#!/info` },
          { label: "My items", icon: "bag", href: `${RB}/users/${id}/inventory` },
          { label: "Copy link", icon: "link", onClick: () => ui.copy(profileUrl, "Link copied") },
          { label: "Roblox page", icon: "external", href: ui.nativeUrl(profileUrl) },
        ])
      );
    } else {
      const friendSlot = h("span", { class: "pf-slot" }, ui.button("Add friend", { icon: "userPlus", variant: "primary", size: "lg", disabled: true }));
      const chatSlot = h("span", { class: "pf-slot" });
      const follow = followState(id);
      actions.append(
        friendSlot,
        chatSlot,
        menu(() => [
          follow.ready && { label: follow.on ? "Unfollow" : "Follow", icon: follow.on ? "minus" : "plus", onClick: () => follow.toggle() },
          { label: "My note", icon: "edit", onClick: () => noteModal(id, user) },
          { label: "See items", icon: "bag", href: `${RB}/users/${id}/inventory` },
          { label: "Trade", icon: "box", href: `${RB}/users/${id}/trade` },
          { label: "Copy link", icon: "link", onClick: () => ui.copy(profileUrl, "Link copied") },
          { label: "Copy ID", icon: "hash", onClick: () => ui.copy(String(id), "ID copied") },
          { label: "Roblox page", icon: "external", href: ui.nativeUrl(profileUrl) },
        ])
      );
      wireFriend(friendSlot, chatSlot, id, me, user);
    }

    const hero = h(
      "section",
      { class: "pf-hero" },
      bg,
      h("div", { class: "pf-hero-avatar" }, ui.thumb("avatarLg", id, { class: "pf-hero-figure", alt: user.displayName })),
      h(
        "div",
        { class: "pf-hero-main" },
        status,
        h("h1", { class: "pf-name" }, h("span", { text: user.displayName }), user.hasVerifiedBadge && verified(28)),
        h("div", { class: "pf-handle", text: "@" + user.name }),
        counts,
        playing,
        actions
      )
    );

    presenceP.then(async (p) => {
      let state = api.presenceState(p);
      if (isSelf && state === "offline") state = "online"; // you are here right now
      status.className = "pf-status is-" + state;
      ui.clear(status, h("span", { class: "pf-status-dot" }), h("span", { text: isSelf && state === "online" ? "Online" : presenceText(p) }));
      if (state !== "ingame" || !(p.placeId || p.rootPlaceId)) return;
      // the game they are in, with Join when we can join their server
      const placeId = p.rootPlaceId ?? p.placeId;
      const uni = p.universeId ?? (await api.universeOf(placeId));
      const canJoin = !!(p.gameId && p.placeId);
      ui.clear(
        playing,
        h("a", { class: "pf-playing-icon", href: `${RB}/games/${placeId}` }, ui.thumb("gameIcon", uni)),
        h("a", { class: "pf-playing-name", href: `${RB}/games/${placeId}`, text: p.lastLocation || "A game" }),
        ui.button(canJoin ? "Join" : "Play", { icon: "play", variant: "primary", onClick: () => (canJoin ? ui.play(p.placeId, p.gameId) : ui.play(placeId)) })
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
        body: h("p", { text: "Roblox wants a quick check first." }),
        actions: [
          { label: "Cancel", variant: "ghost" },
          { label: "Open Roblox page", variant: "primary", onClick: (close) => (close(), (location.href = ui.nativeUrl())) },
        ],
      });
    const render = () => {
      let b;
      if (status === "Friends") {
        b = ui.button("Friends", { icon: "userCheck", variant: "soft", size: "lg", title: "Unfriend" });
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
        b = ui.button("Request sent", { icon: "clock", variant: "soft", size: "lg", disabled: true });
      } else if (status === "RequestReceived") {
        b = ui.button("Accept friend", { icon: "userCheck", variant: "primary", size: "lg" });
        b.addEventListener("click", async () => {
          b.busy(true);
          const r = await write(`https://friends.roblox.com/v1/users/${id}/accept-friend-request`);
          if (r.ok) (status = "Friends"), CER.toast("You are friends now!");
          else if (r.status === 403) askRoblox();
          else CER.toast("Could not accept", "error");
          render();
        });
      } else {
        b = ui.button("Add friend", { icon: "userPlus", variant: "primary", size: "lg" });
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
      // chat is for friends: CER's chat panel when on, else Roblox's profile
      chatSlot.replaceChildren(
        status === "Friends"
          ? CER.toggleChat
            ? ui.button("", { icon: "chat", variant: "soft", size: "lg", title: "Chat", onClick: () => CER.toggleChat() })
            : ui.button("", { icon: "chat", variant: "soft", size: "lg", title: "Chat", href: ui.nativeUrl() })
          : ""
      );
    };
    render();
  }

  // Follow state for the menu: { ready, on, toggle() }.
  function followState(id) {
    const st = { ready: false, on: false };
    api.json("https://friends.roblox.com/v1/user/following-exists", { method: "POST", bg: true, body: { targetUserIds: [Number(id)] } }).then((j) => {
      st.on = !!j?.followings?.[0]?.isFollowing;
      st.ready = !!j;
    });
    st.toggle = async () => {
      const r = await write(`https://friends.roblox.com/v1/users/${id}/${st.on ? "unfollow" : "follow"}`);
      if (r.ok) {
        st.on = !st.on;
        CER.toast(st.on ? "Following" : "Not following");
      } else if (r.status === 403) location.href = ui.nativeUrl(); // captcha: Roblox's page runs it
      else CER.toast("Could not do that", "error");
    };
    return st;
  }

  // Private note about another user (stored only in this browser).
  async function noteModal(id, user) {
    const area = h("textarea", { class: "cer-textarea pf-note", placeholder: "Only you can see this note.", maxlength: "2000" });
    try {
      const { playerNotes = {} } = await CER.ext.storage.local.get("playerNotes");
      area.value = playerNotes[id] ?? "";
    } catch {
      /* context invalidated: start blank */
    }
    const save = async () => {
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
    };
    ui.modal({ title: "Note about " + user.displayName, body: area, actions: [{ label: "Save", variant: "primary", onClick: (close) => (save(), close()) }] });
    requestAnimationFrame(() => area.focus());
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
