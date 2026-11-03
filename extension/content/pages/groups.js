// CER groups pages. Built on CER.ui (content/ui.js).
//   /communities/{id}/{slug}, /groups/{id}  → one group (hero + tabs)
//   /communities#mine (or SPA /communities) → "My groups" grid
// Data comes from Roblox's web APIs only. The only write is Join (official
// API). There is NO leave / transfer / delete UI here, on purpose.
// No wall section: /v1 + /v2 wall/posts return 404 (Roblox retired walls).
//
// Why "#mine": Roblox's SERVER 302s /communities → /my/communities → your
// primary group (or /search/communities when logged out), so a plain
// /communities link never lands on a list. A URL fragment survives those
// redirects (it shows in the navigation entry even after Roblox's app
// rewrites location.hash to "#!/about"), so /communities#mine reaches us.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;
  const TAG = "groups";
  const TTL = 60000;
  const GROUPS = "https://groups.roblox.com";

  // "Groups" or "Communities", following the renameGroups setting
  let word = "group";
  const Word = () => word[0].toUpperCase() + word.slice(1);

  const gidFromPath = () => location.pathname.match(/^\/(?:communities|groups)\/(\d+)/i)?.[1] ?? null;
  const slug = (s) => String(s ?? "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "group";
  const groupUrl = (id, name) => `https://www.roblox.com/communities/${id}/${slug(name)}`;
  const profileUrl = (id) => `https://www.roblox.com/users/${id}/profile`;
  const configureUrl = (id) => `https://www.roblox.com/communities/configure?id=${id}#!/information`;
  const safeHref = (u) => (/^https?:\/\//i.test(u ?? "") ? u : null);
  const MINE_URL = "/communities#mine";

  // Arrived through the /communities#mine redirect chain? (read once)
  let mineFromRedirect = (() => {
    try {
      const nav = performance.getEntriesByType("navigation")[0];
      return /#mine\b/.test(nav?.name ?? "");
    } catch {
      return false;
    }
  })();

  // ---------------------------------------------------------------- tabs in the URL
  const TABS = ["overview", "games", "members", "store", "allies"];
  const HASH_TABS = { about: "overview", store: "store", affiliates: "allies", allies: "allies", games: "games", members: "members" };
  function tabFromUrl() {
    const q = new URLSearchParams(location.search).get("tab");
    if (q && TABS.includes(q)) return q;
    const hash = location.hash.replace(/^#!?\/?/, "").split(/[/?]/)[0].toLowerCase();
    return HASH_TABS[hash] ?? "overview";
  }
  function writeTab(tab) {
    const u = new URL(location.href);
    if (tab === "overview") u.searchParams.delete("tab");
    else u.searchParams.set("tab", tab);
    u.hash = "";
    if (u.href !== location.href) history.replaceState(history.state, "", u.href);
  }

  // ---------------------------------------------------------------- route
  let current = null; // { gid, page, setTab } for the group page on screen
  ui.route(TAG, async () => {
    const feats = (await CER.get()).features ?? {};
    word = feats.renameGroups === false ? "community" : "group";
    const root = document.getElementById("cer-app");
    const mineOnScreen = root?.dataset.page === TAG && root.querySelector(".cer-mg");
    let gid = gidFromPath();
    if (gid && (mineFromRedirect || /#mine\b/.test(location.hash))) {
      mineFromRedirect = false;
      history.replaceState(history.state, "", MINE_URL); // show (and reload to) the list URL
      gid = null;
    }
    if (!gid) {
      if (mineOnScreen) return; // our own URL fix-up above, nothing to redo
      current = null;
      return myGroups();
    }
    if (current?.gid === gid && root?.dataset.page === TAG && root.contains(current.page)) {
      current.setTab(tabFromUrl(), false); // our own ?tab= change: just switch
      return;
    }
    current = null;
    return groupPage(gid);
  });

  // ---------------------------------------------------------------- data
  // Your groups: Map groupId → { group, role }. No cache: it changes on join.
  async function myRoles(userId) {
    const j = await api.json(`${GROUPS}/v2/users/${userId}/groups/roles`);
    return j ? new Map((j.data ?? []).map((x) => [String(x.group.id), x])) : null;
  }

  // Your place in this group: { me, role, pending, perms }. The membership
  // API sometimes 401s from the page; fall back to the background worker,
  // then to your groups list (role only).
  async function membership(gid, me) {
    if (!me) return { me: null };
    const url = `${GROUPS}/v1/groups/${gid}/membership`;
    let m = await api.json(url);
    if (!m?.groupId) m = await api.json(url, { bg: true });
    let role = m?.userRole?.role?.rank > 0 ? m.userRole.role : null;
    if (!m?.groupId) role = (await myRoles(me.id))?.get(String(gid))?.role ?? null;
    return { me, role, pending: !!m?.isPendingJoin, perms: m?.permissions ?? null };
  }

  // Manage = any admin permission (posts/forums are normal member rights)
  function canManage(info, mem) {
    if (!mem?.me || !mem.role) return false;
    if (info.owner?.userId === mem.me.id || mem.role.rank === 255) return true;
    for (const [k, v] of Object.entries(mem.perms ?? {})) {
      if (/posts|forums/i.test(k) || !v || typeof v !== "object") continue;
      if (Object.values(v).some((x) => x === true)) return true;
    }
    return false;
  }

  function loadGames(gid) {
    return api.json(`https://games.roblox.com/v2/groups/${gid}/gamesV2?accessFilter=Public&limit=50&sortOrder=Desc`, { ttl: TTL }).then((j) =>
      j
        ? (j.data ?? [])
            .filter((g) => g.rootPlace?.id)
            .map((g) => ({ universeId: String(g.id), placeId: String(g.rootPlace.id), name: g.name, visits: g.placeVisits ?? 0 }))
        : null
    );
  }
  // most played first (visits break ties), so the best game leads
  const byPopular = (list) => [...list].sort((a, b) => (b.playing ?? 0) - (a.playing ?? 0) || b.visits - a.visits);

  // One page of the group store, with names + prices. null = could not load.
  // v2 search returns details in one GET; v1 search + details POST is the
  // fallback if v2 ever goes away.
  async function loadStore(gid, cursor = "") {
    const cur = cursor ? "&cursor=" + encodeURIComponent(cursor) : "";
    const v2 = await api.json(`https://catalog.roblox.com/v2/search/items/details?Category=All&CreatorTargetId=${gid}&CreatorType=Group&Limit=30${cur}`, { ttl: 5 * 60000 });
    if (Array.isArray(v2?.data)) return { items: v2.data, next: v2.nextPageCursor ?? null };
    const s = await api.json(`https://catalog.roblox.com/v1/search/items?category=All&creatorTargetId=${gid}&creatorType=Group&limit=30${cur}`, { ttl: 5 * 60000 });
    if (!s) return null;
    const ids = (s.data ?? []).map((x) => ({ itemType: x.itemType, id: x.id }));
    const det = ids.length ? await api.json("https://catalog.roblox.com/v1/catalog/items/details", { method: "POST", body: { items: ids } }) : null;
    const byKey = new Map((det?.data ?? []).map((d) => [d.itemType + ":" + d.id, d]));
    return { items: ids.map((x) => ({ ...x, ...(byKey.get(x.itemType + ":" + x.id) ?? {}) })), next: s.nextPageCursor ?? null };
  }

  const loadAllies = (gid, start = 0) =>
    api.json(`${GROUPS}/v1/groups/${gid}/relationships/allies?model.startRowIndex=${start}&model.maxRows=50`, { ttl: TTL });

  // ---------------------------------------------------------------- small parts
  const verified = (size = 18) => h("span", { class: "cer-gp-verified", title: "Verified" }, ui.icon("verified", size));

  // Group tile: the icon IS the tile, name under it. Crown = you own it.
  function groupTile(g, opts = {}) {
    return h(
      "a",
      { class: "cer-gp-tile", href: groupUrl(g.id, g.name), title: g.name },
      h("span", { class: "cer-gp-tile-art" }, ui.thumb("groupIconLg", g.id, { alt: "" }), opts.owner && h("span", { class: "cer-gp-tile-crown", title: "You own this" }, ui.icon("crown", 14))),
      h("span", { class: "cer-gp-tile-name" }, h("span", { text: g.name ?? "" }), g.hasVerifiedBadge && verified(15))
    );
  }

  function itemCard(it) {
    const bundle = it.itemType === "Bundle";
    const name = it.name ?? "Item";
    const known = it.name != null; // details missing: say nothing about price
    const off = it.priceStatus === "Off Sale" || (it.price == null && it.lowestPrice == null && it.priceStatus !== "Free");
    const free = !off && (it.priceStatus === "Free" || (it.price ?? it.lowestPrice) === 0);
    const price = !known
      ? null
      : off
        ? h("span", { class: "is-off", text: "Off sale" })
        : free
          ? h("span", { class: "is-free", text: "Free" })
          : h("span", {}, ui.icon("robux", 15), h("span", { text: fmt.full(it.price ?? it.lowestPrice) }));
    return h(
      "a",
      { class: "cer-gp-item", href: `https://www.roblox.com/${bundle ? "bundles" : "catalog"}/${it.id}/${slug(name)}`, title: name },
      h("div", { class: "cer-gp-item-media" }, ui.thumb(bundle ? "bundle" : "asset", it.id, { alt: "" })),
      h("div", { class: "cer-gp-item-name", text: name }),
      price && h("div", { class: "cer-gp-item-price" }, price)
    );
  }

  function loadMoreButton(onClick) {
    const b = ui.button("More", { variant: "soft" });
    b.addEventListener("click", async () => {
      b.busy(true);
      const more = await onClick();
      b.busy(false);
      if (!more) b.remove();
    });
    return h("div", { class: "cer-gp-more" }, b);
  }

  // ---------------------------------------------------------------- group page
  async function groupPage(gid) {
    const { page } = ui.page(TAG, "cer-gp");
    const state = { gid, page, tab: tabFromUrl(), panes: {}, setTab: () => {} };
    current = state;
    const alive = () => current === state && page.isConnected;

    // shell first (skeletons), data fills in
    const heroSlot = h("div", { class: "cer-gp-heroslot" }, ui.skeleton("hero"));
    const tabSlot = h("div", { class: "cer-gp-tabbar" });
    const body = h("div", { class: "cer-gp-body" }, h("div", { class: "cer-gp-sk" }, ui.skeleton("card", 4)));
    page.append(heroSlot, tabSlot, body);

    // everything in parallel
    const meP = api.me();
    const infoP = api.json(`${GROUPS}/v1/groups/${gid}`, { ttl: TTL });
    const gamesP = loadGames(gid);
    const hydratedP = gamesP.then((g) => (g?.length ? ui.hydrateGames(g).then(byPopular).catch(() => g) : g));
    const rolesP = api.json(`${GROUPS}/v1/groups/${gid}/roles`, { ttl: TTL });
    const socialP = api.json(`${GROUPS}/v1/groups/${gid}/social-links`, { ttl: TTL });
    const alliesP = loadAllies(gid);
    // catalog often rate-limits: one quiet retry before the Store tab gives up
    const storeP = loadStore(gid).then((s) => s ?? api.sleep(2500).then(() => loadStore(gid)));
    const memP = meP.then((me) => membership(gid, me));

    let info = await infoP;
    if (!info?.id && alive()) info = await api.sleep(1500).then(() => api.json(`${GROUPS}/v1/groups/${gid}`, { ttl: TTL })); // rate limit: one retry
    if (!alive()) return;
    if (!info?.id) {
      heroSlot.remove();
      body.replaceChildren(
        ui.empty(`We could not load this ${word}.`, {
          icon: "users",
          action: ui.button("Open on Roblox", { href: ui.nativeUrl(), variant: "primary" }),
        })
      );
      return;
    }
    const ctx = { gid, info, gamesP, hydratedP, rolesP, socialP, alliesP, storeP, memP, alive, state };

    // ---- hero: icon, name, members, owner, one action
    const heroImage = gamesP
      .then((g) => (g?.[0] ? api.thumb("gameThumb", g[0].universeId) : null))
      .then((u) => u ?? api.thumb("groupIconLg", gid));
    const actions = h("div", { class: "cer-gp-actions" });
    const owner = info.owner;
    const hero = ui.hero({
      class: "cer-gp-hero",
      image: heroImage,
      art: ui.thumb("groupIconLg", gid, { alt: info.name }),
      title: info.name,
      children: [
        h(
          "div",
          { class: "cer-gp-meta" },
          h("span", { text: fmt.num(info.memberCount) + " members" }),
          owner &&
            h(
              "a",
              { href: profileUrl(owner.userId), class: "cer-gp-owner" },
              ui.avatar(owner.userId, { size: 24 }),
              h("span", { text: owner.displayName || owner.username }),
              owner.hasVerifiedBadge && verified(14)
            )
        ),
        actions,
      ],
    });
    if (info.hasVerifiedBadge) hero.querySelector(".cer-hero-title")?.append(" ", verified(30));
    if (info.shout?.body) hero.append(shoutCard(info.shout));
    else
      hydratedP.then((list) => {
        // no shout: the right side shows the group's most played game
        if (list?.[0] && alive()) hero.append(featuredGame(list[0]));
      });
    heroSlot.replaceChildren(hero);

    // ---- action: Join for visitors, your role (+ Manage) for members
    const renderActions = (mem) => {
      if (!alive()) return;
      const out = [];
      if (!mem.me) {
        out.push(ui.button("Join", { variant: "light", size: "lg", href: ui.nativeUrl() }));
      } else if (mem.role) {
        const own = mem.role.rank === 255;
        out.push(h("span", { class: "cer-gp-role", title: "You are in this " + word }, ui.icon(own ? "crown" : "check", 16), h("span", { text: mem.role.name })));
        if (canManage(info, mem)) out.push(ui.button("Manage", { variant: "glass", href: configureUrl(gid) }));
      } else if (mem.pending) {
        out.push(ui.button("Request sent", { variant: "glass", size: "lg", disabled: true }));
      } else if (!info.isLocked) {
        const btn = ui.button(info.publicEntryAllowed ? "Join" : "Ask to join", { variant: "light", size: "lg" });
        btn.addEventListener("click", () => join(ctx, btn, renderActions, mem));
        out.push(btn);
      }
      actions.replaceChildren(...out);
    };
    memP.then(renderActions);

    // ---- tabs (only the ones with something in them)
    const has = { overview: true, games: false, members: true, store: false, allies: false };
    const LABEL = { overview: "Overview", games: "Games", members: "Members", store: "Store", allies: "Allies" };
    const renderTabs = () => {
      if (!alive()) return;
      const items = TABS.filter((t) => has[t] || t === state.tab).map((id) => ({ id, label: LABEL[id] }));
      tabSlot.replaceChildren(ui.tabs(items, state.tab, (id) => setTab(id)));
    };
    const BUILD = { overview: buildOverview, games: buildGames, store: buildStore, members: buildMembers, allies: buildAllies };
    function setTab(id, write = true) {
      if (!TABS.includes(id)) id = "overview";
      state.tab = id;
      if (write) writeTab(id);
      renderTabs();
      if (!state.panes[id]) {
        const pane = h("div", { class: "cer-gp-pane", "data-tab": id });
        state.panes[id] = pane;
        body.append(pane);
        BUILD[id](ctx, pane, setTab);
      }
      for (const [k, el] of Object.entries(state.panes)) el.hidden = k !== id;
    }
    state.setTab = setTab;
    body.replaceChildren();
    setTab(state.tab, false);

    gamesP.then((g) => ((has.games = !!g?.length), renderTabs()));
    alliesP.then((a) => ((has.allies = !!a?.relatedGroups?.length), renderTabs()));
    storeP.then((s) => ((has.store = !!s?.items.length), renderTabs()));
  }

  function featuredGame(g) {
    const name = CER.cleanTitle(g.name ?? "", CER._featsCache ?? {});
    const play = h("button", { type: "button", class: "cer-gp-feat-play", title: "Play", "aria-label": "Play " + name }, ui.icon("play", 18));
    play.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ui.play(g.placeId);
    });
    return h(
      "a",
      { class: "cer-gp-feat", href: `https://www.roblox.com/games/${g.placeId}`, title: g.name },
      h("div", { class: "cer-gp-feat-media" }, ui.thumb("gameThumb", g.universeId, { alt: "" }), play),
      h(
        "div",
        { class: "cer-gp-feat-body" },
        h("span", { class: "cer-gp-feat-name", text: name }),
        h(
          "span",
          { class: "cer-gp-feat-meta" },
          g.playing != null && h("span", {}, ui.icon("users", 13), fmt.num(g.playing)),
          g.rating != null && h("span", {}, ui.icon("like", 13), g.rating + "%")
        )
      )
    );
  }

  function shoutCard(shout) {
    const p = shout.poster;
    return h(
      "div",
      { class: "cer-gp-shout" },
      h("p", { class: "cer-gp-shout-body", text: shout.body }),
      p && h("a", { class: "cer-gp-shout-by", href: profileUrl(p.userId) }, ui.avatar(p.userId, { size: 22 }), h("span", { text: p.displayName || p.username }))
    );
  }

  // ---- join (the only write on this page; official API, user-pressed)
  async function join(ctx, btn, renderActions, mem) {
    const { gid, info } = ctx;
    btn.busy(true);
    let res = null;
    let data = null;
    try {
      res = await CER.robloxWrite(`${GROUPS}/v1/groups/${gid}/users`, "POST", {});
      data = await res.json().catch(() => null);
    } catch {
      /* network */
    }
    btn.busy(false);
    if (res?.ok) {
      const next = info.publicEntryAllowed ? { ...mem, role: { name: "Member", rank: 1 } } : { ...mem, pending: true };
      renderActions(next);
      CER.toast?.(info.publicEntryAllowed ? "You joined!" : "Request sent!");
      membership(gid, mem.me).then((m) => (m.role || m.pending) && renderActions(m));
      return;
    }
    const msg = data?.errors?.[0]?.message ?? "";
    const challenge = !!res?.headers?.get("rblx-challenge-id") || /captcha|challenge/i.test(msg);
    let text = "We could not join right now. Try on Roblox's page.";
    if (challenge) text = "Roblox wants a quick check first.";
    else if (/maximum|too many/i.test(msg)) text = `You are in too many ${word}s to join one more.`;
    else if (/already.*(request|pending)/i.test(msg)) text = "You already asked to join.";
    else if (/already.*member/i.test(msg)) {
      membership(gid, mem.me).then(renderActions);
      return;
    }
    ui.modal({
      title: challenge ? "One more step" : "Could not join",
      body: h("p", { text }),
      actions: [
        { label: "Cancel", variant: "ghost" },
        { label: "Open Roblox page", variant: "primary", onClick: () => (location.href = ui.nativeUrl()) },
      ],
    });
  }

  // ---------------------------------------------------------------- overview
  // Art first: games, store, allies. About text goes last.
  function buildOverview(ctx, pane, setTab) {
    const { info } = ctx;

    const games = ui.section("Games");
    games.body.append(ui.rail(ui.skeleton("card", 4), { item: 280 }));
    ctx.hydratedP.then((list) => {
      if (!ctx.alive()) return;
      if (!list?.length) return games.remove();
      games.body.replaceChildren(ui.rail(list.slice(0, 12).map((g) => ui.gameCard(g)), { item: 280 }));
      if (list.length > 12) games.head.querySelector(".cer-block-tools")?.append(ui.link("See all", { onClick: () => setTab("games") }));
    });

    const store = ui.section("Store");
    store.body.append(h("div", { class: "cer-gp-items is-row" }, ui.skeleton("card", 6)));
    ui.whenVisible(store, () =>
      ctx.storeP.then((s) => {
        if (!ctx.alive()) return;
        if (!s?.items.length) return store.remove();
        store.body.replaceChildren(h("div", { class: "cer-gp-items is-row" }, s.items.slice(0, 6).map(itemCard)));
        if (s.items.length > 6 || s.next) store.head.querySelector(".cer-block-tools")?.append(ui.link("See all", { onClick: () => setTab("store") }));
      })
    );

    const allies = ui.section("Allies");
    ctx.alliesP.then((a) => {
      if (!ctx.alive()) return;
      const list = a?.relatedGroups ?? [];
      if (!list.length) return allies.remove();
      allies.body.append(ui.rail(list.slice(0, 12).map((g) => groupTile(g)), { item: 132 }));
      if (list.length > 12) allies.head.querySelector(".cer-block-tools")?.append(ui.link("See all", { onClick: () => setTab("allies") }));
    });

    // about: plain text + social links, only if there is any
    const about = ui.section("About");
    const links = h("div", { class: "cer-gp-links" });
    const desc = info.description?.trim();
    if (desc) about.body.append(ui.clamp(desc, 4));
    about.body.append(links);
    if (!desc) about.hidden = true;
    ctx.socialP.then((s) => {
      const list = (s?.data ?? []).filter((l) => safeHref(l.url));
      if (!list.length || !ctx.alive()) return;
      about.hidden = false;
      links.replaceChildren(
        ...list.map((l) =>
          h("a", { class: "cer-gp-social", href: l.url, target: "_blank", rel: "noopener noreferrer", title: l.url }, ui.icon(socialIcon(l.type), 16), h("span", { text: l.title || l.type }))
        )
      );
    });

    pane.append(games, store, allies, about);
    // nothing at all to show (no games, store, allies, about)
    Promise.all([ctx.hydratedP, ctx.storeP, ctx.alliesP, ctx.socialP]).then(() => {
      if (ctx.alive() && ![...pane.children].some((x) => x.isConnected && !x.hidden)) pane.append(ui.empty(`This ${word} is quiet for now.`, { icon: "users" }));
    });
  }

  function socialIcon(type) {
    return { Discord: "chat", Twitter: "send", YouTube: "play", Twitch: "gamepad", Facebook: "users", Guilded: "shield", RobloxGroup: "users" }[type] ?? "link";
  }

  // ---------------------------------------------------------------- games tab
  function buildGames(ctx, pane) {
    pane.append(ui.grid(ui.skeleton("card", 8), { min: 240, gap: 20 }));
    ctx.hydratedP.then((list) => {
      if (!ctx.alive()) return;
      if (list == null) return pane.replaceChildren(ui.empty("We could not load the games.", { icon: "gamepad" }));
      if (!list.length) return pane.replaceChildren(ui.empty(`No games yet.`, { icon: "gamepad" }));
      pane.replaceChildren(ui.grid(list.map((g) => ui.gameCard(g)), { min: 240, gap: 20 }));
    });
  }

  // ---------------------------------------------------------------- store tab
  function buildStore(ctx, pane) {
    const grid = h("div", { class: "cer-gp-items" }, ui.skeleton("card", 12));
    pane.append(grid);
    ctx.storeP.then((s) => {
      if (!ctx.alive()) return;
      if (!s) return pane.replaceChildren(ui.empty("We could not load the store.", { icon: "bag" }));
      if (!s.items.length) return pane.replaceChildren(ui.empty("Nothing for sale yet.", { icon: "bag" }));
      grid.replaceChildren(...s.items.map(itemCard));
      let cursor = s.next;
      if (cursor)
        pane.append(
          loadMoreButton(async () => {
            const more = await loadStore(ctx.gid, cursor);
            if (!more) return true; // keep the button to retry
            grid.append(...more.items.map(itemCard));
            cursor = more.next;
            return !!cursor;
          })
        );
    });
  }

  // ---------------------------------------------------------------- members tab
  function buildMembers(ctx, pane) {
    const chipSlot = h("div", { class: "cer-gp-rolebar" }, ui.skeleton("line"));
    const list = h("div", { class: "cer-gp-members" });
    pane.append(chipSlot, list);
    const cache = new Map(); // roleId → { users, cursor, done, grid, wrap }

    ctx.rolesP.then((r) => {
      if (!ctx.alive()) return;
      const roles = (r?.roles ?? []).filter((x) => x.rank > 0 && x.memberCount > 0).sort((a, b) => b.rank - a.rank);
      if (!roles.length) return pane.replaceChildren(ui.empty("We could not load the members.", { icon: "users" }));
      const first = roles.find((x) => x.rank < 255) ?? roles[0];
      chipSlot.replaceChildren(
        ui.chips(
          roles.map((x) => ({ id: String(x.id), label: x.name })),
          String(first.id),
          (id) => show(roles.find((x) => String(x.id) === id)),
          { wrap: true }
        )
      );
      show(first);
    });

    async function show(role) {
      const key = String(role.id);
      if (!cache.has(key)) {
        const grid = ui.grid([], { min: 116, gap: 10 });
        cache.set(key, { users: [], cursor: "", done: false, grid, wrap: h("div", { class: "cer-gp-rolewrap" }, grid) });
      }
      const c = cache.get(key);
      list.replaceChildren(c.wrap);
      if (!c.users.length && !c.done) {
        c.grid.append(...ui.skeleton("tile", 12));
        await loadPage(role, c);
      }
    }
    async function loadPage(role, c) {
      const j = await api.json(`${GROUPS}/v1/groups/${ctx.gid}/roles/${role.id}/users?limit=50&sortOrder=Desc${c.cursor ? "&cursor=" + encodeURIComponent(c.cursor) : ""}`);
      if (!ctx.alive()) return false;
      c.grid.querySelectorAll(".cer-sk").forEach((x) => x.remove());
      c.wrap.querySelector(".cer-gp-more")?.remove();
      if (!j) {
        if (!c.users.length) c.grid.replaceWith((c.grid = ui.empty("We could not load these members.", { icon: "users" })));
        return false;
      }
      const users = j.data ?? [];
      c.users.push(...users);
      c.cursor = j.nextPageCursor;
      c.done = !c.cursor;
      c.grid.append(...users.map((u) => ui.userTile({ id: u.userId, name: u.username, displayName: u.displayName }, { size: 84, sub: "" })));
      if (!c.users.length) c.grid.replaceWith((c.grid = ui.empty("Nobody here yet.", { icon: "users" })));
      if (!c.done) c.wrap.append(loadMoreButton(() => loadPage(role, c)));
      return !c.done;
    }
  }

  // ---------------------------------------------------------------- allies tab
  function buildAllies(ctx, pane) {
    const grid = ui.grid(ui.skeleton("tile", 6), { min: 132, gap: 18 });
    pane.append(grid);
    ctx.alliesP.then((a) => {
      if (!ctx.alive()) return;
      if (!a) return pane.replaceChildren(ui.empty("We could not load the allies.", { icon: "shield" }));
      const list = a.relatedGroups ?? [];
      if (!list.length) return pane.replaceChildren(ui.empty("No allies yet.", { icon: "shield" }));
      grid.replaceChildren(...list.map((g) => groupTile(g)));
      // nextRowIndex is set even on the last page: also stop at the total
      let next = a.nextRowIndex;
      let shown = list.length;
      const total = a.totalGroupCount ?? 0;
      if (next && shown < total)
        pane.append(
          loadMoreButton(async () => {
            const more = await loadAllies(ctx.gid, next);
            if (!more) return true;
            const got = more.relatedGroups ?? [];
            grid.append(...got.map((g) => groupTile(g)));
            shown += got.length;
            next = more.nextRowIndex;
            return !!next && got.length > 0 && shown < total;
          })
        );
    });
  }

  // ---------------------------------------------------------------- my groups
  async function myGroups() {
    const me = await api.me();
    if (!me) return ui.release();
    const { page } = ui.page(TAG, "cer-mg");
    document.title = Word() + "s - Roblox";
    let query = "";

    const search = ui.search("Search", { class: "cer-mg-search", onInput: (v) => ((query = v.toLowerCase()), render()) });
    const head = ui.header({
      title: Word() + "s",
      actions: [search, ui.button("Find more", { variant: "soft", icon: "search", href: "https://www.roblox.com/search/communities" })],
    });
    const grid = ui.grid(ui.skeleton("tile", 12), { min: 150, gap: 22 });
    grid.classList.add("cer-mg-grid");
    page.append(head, grid);

    const [rolesRes, primaryRes] = await Promise.all([
      api.json(`${GROUPS}/v2/users/${me.id}/groups/roles`, { ttl: 30000 }),
      api.json(`${GROUPS}/v1/users/${me.id}/groups/primary/role`, { ttl: 30000 }),
    ]);
    if (!page.isConnected) return;
    if (!rolesRes) {
      grid.replaceWith(ui.empty(`We could not load your ${word}s.`, { icon: "users", action: ui.button("Try again", { variant: "soft", onClick: () => location.reload() }) }));
      return;
    }
    const primary = primaryRes?.group?.id ? String(primaryRes.group.id) : null;
    // primary first, then the ones you run, then the biggest
    const list = (rolesRes.data ?? []).sort(
      (a, b) => (String(b.group.id) === primary) - (String(a.group.id) === primary) || b.role.rank - a.role.rank || b.group.memberCount - a.group.memberCount
    );
    if (!list.length) {
      search.remove();
      grid.replaceWith(ui.empty(`You are not in any ${word}s yet.`, { icon: "users" }));
      return;
    }
    if (list.length < 10) search.remove(); // a short list needs no search

    function render() {
      const shown = list.filter((x) => !query || x.group.name.toLowerCase().includes(query));
      if (!shown.length) {
        grid.replaceChildren(h("div", { class: "cer-mg-none" }, ui.empty("No match.", { icon: "search" })));
        return;
      }
      grid.replaceChildren(...shown.map((x) => groupTile(x.group, { owner: x.role.rank === 255 })));
    }
    render();
  }
})();
