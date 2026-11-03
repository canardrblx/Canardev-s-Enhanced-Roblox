// CER groups pages. Built on CER.ui (content/ui.js).
//   /communities/{id}/{slug}, /groups/{id}  → one group (hero + tabs)
//   /communities                            → "My groups" grid
// Data comes from Roblox's web APIs only. The only write is Join (official
// API). There is NO leave / transfer / delete UI here, on purpose.
// No wall section: /v1 + /v2 wall/posts return 404 (Roblox retired walls).
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
  let current = null; // { gid, setTab } for the group page on screen
  ui.route(TAG, async () => {
    const feats = (await CER.get()).features ?? {};
    word = feats.renameGroups === false ? "community" : "group";
    const gid = gidFromPath();
    const root = document.getElementById("cer-app");
    if (gid && current?.gid === gid && root?.dataset.page === TAG && root.contains(current.page)) {
      current.setTab(tabFromUrl(), false); // our own ?tab= change: just switch
      return;
    }
    current = null;
    return gid ? groupPage(gid) : myGroups();
  });

  // ---------------------------------------------------------------- data
  // Your groups: Map groupId → { group, role }. No cache: it changes on join.
  async function myRoles(userId) {
    const j = await api.json(`${GROUPS}/v2/users/${userId}/groups/roles`);
    return j ? new Map((j.data ?? []).map((x) => [String(x.group.id), x])) : null;
  }

  // Your place in this group: { me, role, pending, perms, primary }.
  // The membership API sometimes 401s from the page; fall back to the
  // background worker, then to your groups list (role only).
  async function membership(gid, me) {
    if (!me) return { me: null };
    const url = `${GROUPS}/v1/groups/${gid}/membership`;
    let m = await api.json(url);
    if (!m?.groupId) m = await api.json(url, { bg: true });
    let role = m?.userRole?.role?.rank > 0 ? m.userRole.role : null;
    if (!m?.groupId) role = (await myRoles(me.id))?.get(String(gid))?.role ?? null;
    return { me, role, pending: !!m?.isPendingJoin, perms: m?.permissions ?? null, primary: !!m?.isPrimary };
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

  // Group card: blurred icon banner, icon, name, members, optional role.
  function groupCard(g, opts = {}) {
    const owner = opts.role?.rank === 255;
    return h(
      "a",
      { class: "cer-gp-card" + (opts.primary ? " is-primary" : ""), href: groupUrl(g.id, g.name), title: g.name },
      h("span", { class: "cer-gp-card-banner" }, ui.thumb("groupIcon", g.id)),
      opts.primary && h("span", { class: "cer-gp-card-pin" }, ui.icon("pin", 13), "Primary"),
      h("span", { class: "cer-gp-card-icon" }, ui.thumb("groupIcon", g.id, { alt: "" })),
      h("span", { class: "cer-gp-card-name" }, h("span", { text: g.name ?? "" }), g.hasVerifiedBadge && verified(16)),
      h("span", { class: "cer-gp-card-sub" }, ui.icon("users", 13), h("span", { text: fmt.num(g.memberCount) + " members" })),
      opts.role && h("span", { class: "cer-gp-card-role" }, ui.badge(opts.role.name, owner ? "accent" : "plain", owner ? "crown" : null))
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
      h("div", { class: "cer-gp-item-price" }, price)
    );
  }

  function loadMoreButton(onClick) {
    const b = ui.button("Load more", { variant: "soft", icon: "down" });
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
    const body = h("div", { class: "cer-gp-body" }, h("div", { class: "cer-gp-sk" }, ui.skeleton("line"), ui.skeleton("line"), ui.skeleton("card", 4)));
    page.append(heroSlot, tabSlot, body);

    // everything in parallel
    const meP = api.me();
    const infoP = api.json(`${GROUPS}/v1/groups/${gid}`, { ttl: TTL });
    const gamesP = loadGames(gid);
    const hydratedP = gamesP.then((g) => (g?.length ? ui.hydrateGames(g).catch(() => g) : g));
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
          action: ui.button("Open on Roblox", { href: ui.nativeUrl(), variant: "primary", icon: "external" }),
        })
      );
      return;
    }
    const ctx = { gid, info, gamesP, hydratedP, rolesP, socialP, alliesP, storeP, memP, alive, state };

    // ---- hero
    const heroImage = gamesP
      .then((g) => (g?.[0] ? api.thumb("gameThumb", g[0].universeId) : null))
      .then((u) => u ?? api.thumb("groupIconLg", gid));
    const actions = h("div", { class: "cer-gp-actions" });
    const owner = info.owner;
    const hero = ui.hero({
      class: "cer-gp-hero",
      image: heroImage,
      art: ui.thumb("groupIconLg", gid, { alt: info.name }),
      eyebrow: Word(),
      eyebrowIcon: "users",
      title: info.name,
      stats: [
        { icon: "users", label: fmt.full(info.memberCount) + " members" },
        info.isLocked && { icon: "lock", label: "Locked" },
        !info.publicEntryAllowed && { icon: "lock", label: "Ask to join" },
      ].filter(Boolean),
      children: [
        h(
          "div",
          { class: "cer-gp-owner" },
          owner
            ? [
                h("a", { href: profileUrl(owner.userId), class: "cer-gp-owner-link" }, ui.avatar(owner.userId, { size: 28 }), h("span", { class: "cer-gp-owner-by", text: "Owner" }), h("span", { class: "cer-gp-owner-name", text: owner.displayName || owner.username }), owner.hasVerifiedBadge && verified(15)),
              ]
            : h("span", { class: "cer-gp-owner-by", text: "No owner" })
        ),
        actions,
      ],
    });
    if (info.hasVerifiedBadge) hero.querySelector(".cer-hero-title")?.append(" ", verified(30));
    if (info.shout?.body) hero.append(shoutCard(info.shout));
    else
      hydratedP.then((list) => {
        // no shout: the right side shows the group's most played game
        const top = list?.length ? [...list].sort((a, b) => (b.playing ?? 0) - (a.playing ?? 0) || b.visits - a.visits)[0] : null;
        if (top && alive()) hero.append(featuredGame(top));
      });
    heroSlot.replaceChildren(hero);

    // ---- actions (join / manage / your role)
    const renderActions = (mem) => {
      if (!alive()) return;
      const out = [];
      if (!mem.me) {
        out.push(ui.button("Join", { variant: "light", size: "lg", icon: "plus", href: ui.nativeUrl() }));
      } else if (mem.role) {
        const own = mem.role.rank === 255;
        out.push(h("span", { class: "cer-gp-role", title: "Your role" }, ui.icon(own ? "crown" : "shield", 15), h("span", { class: "cer-gp-role-k", text: "Your role" }), h("span", { text: mem.role.name })));
        if (mem.primary) out.push(h("span", { class: "cer-gp-role is-plain" }, ui.icon("pin", 14), h("span", { text: "Primary" })));
        if (canManage(info, mem)) out.push(ui.button("Manage", { variant: "glass", icon: "sliders", href: configureUrl(gid) }));
      } else if (mem.pending) {
        out.push(ui.button("Request sent", { variant: "glass", size: "lg", icon: "clock", disabled: true }));
      } else if (info.isLocked) {
        out.push(h("span", { class: "cer-gp-role is-plain" }, ui.icon("lock", 14), h("span", { text: "This " + word + " is locked" })));
      } else {
        const btn = ui.button(info.publicEntryAllowed ? "Join" : "Ask to join", { variant: "light", size: "lg", icon: "plus" });
        btn.addEventListener("click", () => join(ctx, btn, renderActions, mem));
        out.push(btn);
      }
      out.push(ui.button("", { variant: "glass", icon: "link", title: "Copy link", onClick: () => ui.copy(groupUrl(gid, info.name), "Link copied!") }));
      actions.replaceChildren(...out);
    };
    actions.append(ui.skeleton("line"));
    memP.then(renderActions);

    // ---- tabs
    const counts = { overview: true, games: null, store: null, members: info.memberCount, allies: null };
    const LABEL = { overview: "Overview", games: "Games", store: "Store", members: "Members", allies: "Allies" };
    const ICON = { overview: "home", games: "gamepad", store: "bag", members: "users", allies: "shield" };
    const visibleTabs = () => TABS.filter((t) => t === "overview" || t === "members" || counts[t] || t === state.tab);
    const renderTabs = () => {
      if (!alive()) return;
      tabSlot.replaceChildren(
        ui.tabs(
          visibleTabs().map((id) => ({ id, label: LABEL[id], icon: ICON[id], count: typeof counts[id] === "number" ? counts[id] : null })),
          state.tab,
          (id) => setTab(id)
        )
      );
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

    // counts arrive → tabs appear
    gamesP.then((g) => ((counts.games = g?.length || null), renderTabs()));
    alliesP.then((a) => ((counts.allies = a?.totalGroupCount || null), renderTabs()));
    storeP.then((s) => ((counts.store = s?.items.length ? "yes" : null), renderTabs()));
  }

  function featuredGame(g) {
    const name = CER.cleanTitle(g.name ?? "", CER._featsCache ?? {});
    const play = ui.button("Play", { variant: "light", icon: "play", size: "sm" });
    play.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ui.play(g.placeId);
    });
    return h(
      "a",
      { class: "cer-gp-feat", href: `https://www.roblox.com/games/${g.placeId}`, title: g.name },
      h("div", { class: "cer-gp-feat-media" }, ui.thumb("gameThumb", g.universeId, { alt: "" })),
      h(
        "div",
        { class: "cer-gp-feat-body" },
        h("span", { class: "cer-gp-feat-k", text: "Top game" }),
        h("span", { class: "cer-gp-feat-name", text: name }),
        h(
          "span",
          { class: "cer-gp-feat-meta" },
          g.playing != null && h("span", {}, ui.icon("users", 13), fmt.num(g.playing) + " playing"),
          g.rating != null && h("span", {}, ui.icon("like", 13), g.rating + "%")
        )
      ),
      play
    );
  }

  function shoutCard(shout) {
    const p = shout.poster;
    return h(
      "div",
      { class: "cer-gp-shout" },
      h("div", { class: "cer-gp-shout-head" }, ui.icon("megaphone", 15), h("span", { text: "Shout" }), shout.updated && h("span", { class: "cer-gp-shout-time", text: fmt.ago(shout.updated) })),
      h("p", { class: "cer-gp-shout-body", text: shout.body }),
      p &&
        h(
          "a",
          { class: "cer-gp-shout-by", href: profileUrl(p.userId) },
          ui.avatar(p.userId, { size: 22 }),
          h("span", { text: p.displayName || p.username })
        )
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
    let text = "We could not join right now. You can try on Roblox's page.";
    if (challenge) text = "Roblox wants a quick check first. Finish it on Roblox's page.";
    else if (/maximum|too many/i.test(msg)) text = `You are in too many ${word}s to join one more.`;
    else if (/already.*(request|pending)/i.test(msg)) text = "You already asked to join. Please wait.";
    else if (/already.*member/i.test(msg)) {
      membership(gid, mem.me).then(renderActions);
      return;
    }
    ui.modal({
      title: challenge ? "One more step" : "Could not join",
      body: h("p", { text }),
      actions: [
        { label: "Cancel", variant: "ghost" },
        { label: "Open Roblox page", variant: "primary", icon: "external", onClick: () => (location.href = ui.nativeUrl()) },
      ],
    });
  }

  // ---------------------------------------------------------------- overview
  function buildOverview(ctx, pane, setTab) {
    const { info, gid } = ctx;

    // about
    const about = ui.section("About", { icon: "info" });
    const aboutCard = ui.card([
      info.description?.trim() ? ui.clamp(info.description.trim(), 6) : h("p", { class: "cer-gp-muted", text: "No description yet." }),
    ]);
    const links = h("div", { class: "cer-gp-links" });
    aboutCard.append(links);
    about.body.append(aboutCard);
    ctx.socialP.then((s) => {
      const list = (s?.data ?? []).filter((l) => safeHref(l.url));
      links.replaceChildren(
        ...list.map((l) =>
          h(
            "a",
            { class: "cer-gp-social is-" + String(l.type).toLowerCase(), href: l.url, target: "_blank", rel: "noopener noreferrer", title: l.url },
            ui.icon(socialIcon(l.type), 15),
            h("span", { text: l.title || l.type })
          )
        )
      );
    });

    // top games
    const games = ui.section("Top games", { icon: "trophy", action: { label: "See all", onClick: () => setTab("games") } });
    games.body.append(ui.rail(ui.skeleton("card", 4), { item: 280 }));
    ctx.hydratedP.then((list) => {
      if (!ctx.alive()) return;
      if (!list?.length) return games.remove();
      const top = [...list].sort((a, b) => (b.playing ?? 0) - (a.playing ?? 0) || b.visits - a.visits).slice(0, 10);
      games.body.replaceChildren(ui.rail(top.map((g, i) => ui.gameCard(g, { rank: top.length > 1 ? i + 1 : null })), { item: 280 }));
      if (list.length <= top.length && list.length < 4) games.head.querySelector(".cer-link")?.remove();
    });

    // store preview (lazy)
    const store = ui.section("Store", { icon: "bag", action: { label: "See all", onClick: () => setTab("store") } });
    store.body.append(ui.grid(ui.skeleton("card", 6), { min: 150 }));
    ui.whenVisible(store, () =>
      ctx.storeP.then((s) => {
        if (!ctx.alive()) return;
        if (!s?.items.length) return store.remove();
        store.body.replaceChildren(h("div", { class: "cer-gp-items is-preview" }, s.items.slice(0, 6).map(itemCard)));
      })
    );

    // side: facts + allies
    const facts = h("div", { class: "cer-gp-facts" });
    const fact = (icon, label, value) => h("div", { class: "cer-gp-fact" }, h("span", { class: "cer-gp-fact-k" }, ui.icon(icon, 16), h("span", { text: label })), h("span", { class: "cer-gp-fact-v" }, value));
    const gamesV = h("span", { text: "–" });
    const rolesV = h("span", { text: "–" });
    facts.append(
      info.owner
        ? fact("crown", "Owner", h("a", { href: profileUrl(info.owner.userId), class: "cer-gp-fact-link" }, ui.avatar(info.owner.userId, { size: 22 }), h("span", { text: info.owner.displayName || info.owner.username })))
        : fact("crown", "Owner", h("span", { text: "None" })),
      fact("users", "Members", h("span", { text: fmt.full(info.memberCount) })),
      fact("gamepad", "Games", gamesV),
      fact("medal", "Roles", rolesV),
      fact(info.publicEntryAllowed ? "globe" : "lock", "Joining", h("span", { text: info.publicEntryAllowed ? "Anyone can join" : "Ask to join" }))
    );
    ctx.gamesP.then((g) => (gamesV.textContent = g ? String(g.length) : "–"));
    ctx.rolesP.then((r) => (rolesV.textContent = r ? String((r.roles ?? []).filter((x) => x.rank > 0).length) : "–"));
    const factsSec = ui.section(`${Word()} info`, { icon: "info" });
    factsSec.body.append(ui.card(facts, { class: "cer-gp-facts-card" }));

    const allies = ui.section("Allies", { icon: "shield", action: { label: "See all", onClick: () => setTab("allies") } });
    allies.body.append(ui.skeleton("row", 3));
    ctx.alliesP.then((a) => {
      if (!ctx.alive()) return;
      const list = a?.relatedGroups ?? [];
      if (!list.length) return allies.remove();
      allies.head.querySelector(".cer-block-title")?.append(h("span", { class: "cer-block-count", text: fmt.num(a.totalGroupCount ?? list.length) }));
      allies.body.replaceChildren(ui.card(h("div", { class: "cer-list" }, list.slice(0, 6).map(allyRow)), { pad: false, class: "cer-gp-allylist" }));
    });

    pane.append(ui.cols([about, games, store], [factsSec, allies], { side: 340 }));
  }

  function socialIcon(type) {
    return { Discord: "chat", Twitter: "send", YouTube: "play", Twitch: "gamepad", Facebook: "users", Guilded: "shield", RobloxGroup: "users" }[type] ?? "link";
  }

  function allyRow(g) {
    return h(
      "a",
      { class: "cer-row cer-gp-allyrow", href: groupUrl(g.id, g.name), title: g.name },
      h("span", { class: "cer-gp-ally-icon" }, ui.thumb("groupIcon", g.id)),
      h("span", { class: "cer-row-main" }, h("span", { class: "cer-row-title" }, h("span", { text: g.name }), g.hasVerifiedBadge && verified(14)), h("span", { class: "cer-row-sub", text: fmt.num(g.memberCount) + " members" }))
    );
  }

  // ---------------------------------------------------------------- games tab
  function buildGames(ctx, pane) {
    pane.append(ui.grid(ui.skeleton("card", 8), { min: 240, gap: 20 }));
    ctx.hydratedP.then((list) => {
      if (!ctx.alive()) return;
      if (list == null) return pane.replaceChildren(ui.empty("We could not load the games.", { icon: "gamepad" }));
      if (!list.length) return pane.replaceChildren(ui.empty(`This ${word} has no games yet.`, { icon: "gamepad" }));
      pane.replaceChildren(ui.grid(list.map((g) => ui.gameCard(g, { sub: g.visits ? fmt.num(g.visits) + " visits" : null })), { min: 240, gap: 20 }));
    });
  }

  // ---------------------------------------------------------------- store tab
  function buildStore(ctx, pane) {
    const grid = h("div", { class: "cer-gp-items" }, ui.skeleton("card", 12));
    pane.append(grid);
    ctx.storeP.then((s) => {
      if (!ctx.alive()) return;
      if (!s) return pane.replaceChildren(ui.empty("We could not load the store. Try again soon.", { icon: "bag" }));
      if (!s.items.length) return pane.replaceChildren(ui.empty(`This ${word} sells nothing yet.`, { icon: "bag" }));
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
    const cache = new Map(); // roleId → { users, cursor, done }

    ctx.rolesP.then((r) => {
      if (!ctx.alive()) return;
      const roles = (r?.roles ?? []).filter((x) => x.rank > 0).sort((a, b) => b.rank - a.rank);
      if (!roles.length) return pane.replaceChildren(ui.empty("We could not load the members.", { icon: "users" }));
      const withPeople = roles.filter((x) => x.memberCount > 0);
      const first = withPeople.find((x) => x.rank < 255) ?? withPeople[0] ?? roles[0];
      chipSlot.replaceChildren(
        ui.chips(
          roles.map((x) => ({ id: String(x.id), label: x.name, count: x.memberCount })),
          String(first.id),
          (id) => show(roles.find((x) => String(x.id) === id)),
          { wrap: true }
        )
      );
      show(first);
    });

    let showing = null;
    async function show(role) {
      showing = role.id;
      const key = String(role.id);
      if (!cache.has(key)) cache.set(key, { users: [], cursor: "", done: false, grid: null });
      const c = cache.get(key);
      if (!c.grid) {
        c.grid = ui.grid([], { min: 116, gap: 10 });
        c.wrap = h("div", { class: "cer-gp-rolewrap" }, c.grid);
      }
      list.replaceChildren(c.wrap);
      if (!c.users.length && !c.done) {
        c.grid.append(...ui.skeleton("tile", 12));
        await page(role, c);
      }
    }
    async function page(role, c) {
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
      c.grid.append(...users.map((u) => ui.userTile({ id: u.userId, name: u.username, displayName: u.displayName }, { size: 84 })));
      if (!c.users.length) {
        const empty = ui.empty("Nobody has this role yet.", { icon: "users" });
        c.grid.replaceWith(empty);
        c.grid = empty;
      }
      if (!c.done) c.wrap.append(loadMoreButton(() => page(role, c)));
      return !c.done;
    }
  }

  // ---------------------------------------------------------------- allies tab
  function buildAllies(ctx, pane) {
    const grid = ui.grid(ui.skeleton("tile", 6), { min: 200 });
    pane.append(grid);
    ctx.alliesP.then((a) => {
      if (!ctx.alive()) return;
      if (!a) return pane.replaceChildren(ui.empty("We could not load the allies.", { icon: "shield" }));
      const list = a.relatedGroups ?? [];
      if (!list.length) return pane.replaceChildren(ui.empty(`This ${word} has no allies yet.`, { icon: "shield" }));
      grid.replaceChildren(...list.map((g) => groupCard(g)));
      // nextRowIndex is set even on the last page: also stop at the total
      let next = a.nextRowIndex;
      let shown = list.length;
      const total = a.totalGroupCount ?? 0;
      if (next && shown < total)
        pane.append(
          loadMoreButton(async () => {
            const more = await loadAllies(ctx.gid, next);
            if (!more) return true;
            const page = more.relatedGroups ?? [];
            grid.append(...page.map((g) => groupCard(g)));
            shown += page.length;
            next = more.nextRowIndex;
            return !!next && page.length > 0 && shown < total;
          })
        );
    });
  }

  // ---------------------------------------------------------------- my groups
  async function myGroups() {
    const me = await api.me();
    if (!me) return ui.release();
    const { page } = ui.page(TAG, "cer-mg");
    const mine = { list: null, primary: null };
    let query = "";
    let sort = "rank";

    const count = h("span", { class: "cer-block-count cer-mg-count", hidden: true });
    const search = ui.search(`Find one of your ${word}s`, {
      class: "cer-mg-search",
      onInput: (v) => ((query = v.toLowerCase()), render()),
    });
    const sortSel = ui.select(
      [
        { id: "rank", label: "My rank" },
        { id: "members", label: "Most members" },
        { id: "name", label: "Name" },
      ],
      sort,
      (v) => ((sort = v), render())
    );
    const head = ui.header({
      title: `My ${word}s`,
      icon: "users",
      sub: `Every ${word} you are in.`,
      actions: [ui.button(`Find ${word}s`, { icon: "search", variant: "soft", href: "https://www.roblox.com/search/communities" })],
    });
    head.querySelector(".cer-view-title")?.append(count);
    const tools = h("div", { class: "cer-mg-tools" }, search, sortSel);
    const grid = ui.grid(ui.skeleton("tile", 10), { min: 210, gap: 16 });
    grid.classList.add("cer-mg-grid");
    page.append(head, tools, grid);

    const [rolesRes, primaryRes] = await Promise.all([
      api.json(`${GROUPS}/v2/users/${me.id}/groups/roles`, { ttl: 30000 }),
      api.json(`${GROUPS}/v1/users/${me.id}/groups/primary/role`, { ttl: 30000 }),
    ]);
    if (!page.isConnected) return;
    if (!rolesRes) {
      grid.replaceWith(ui.empty(`We could not load your ${word}s.`, { icon: "users", action: ui.button("Try again", { variant: "soft", icon: "refresh", onClick: () => location.reload() }) }));
      return;
    }
    mine.list = rolesRes.data ?? [];
    mine.primary = primaryRes?.group?.id ? String(primaryRes.group.id) : null;
    count.textContent = fmt.num(mine.list.length);
    count.hidden = !mine.list.length;
    if (!mine.list.length) {
      tools.remove();
      head.querySelector(".cer-view-actions")?.remove(); // the empty state has the button
      grid.replaceWith(ui.empty(`You are not in any ${word}s yet.`, { icon: "users", action: ui.button(`Find ${word}s`, { variant: "primary", icon: "search", href: "https://www.roblox.com/search/communities" }) }));
      return;
    }

    function render() {
      const isPrimary = (x) => String(x.group.id) === mine.primary;
      const by = {
        rank: (a, b) => b.role.rank - a.role.rank || b.group.memberCount - a.group.memberCount,
        members: (a, b) => b.group.memberCount - a.group.memberCount,
        name: (a, b) => a.group.name.localeCompare(b.group.name),
      }[sort];
      const list = mine.list
        .filter((x) => !query || x.group.name.toLowerCase().includes(query) || x.role.name.toLowerCase().includes(query))
        .sort((a, b) => isPrimary(b) - isPrimary(a) || by(a, b));
      if (!list.length) {
        grid.replaceChildren(h("div", { class: "cer-mg-none" }, ui.empty(`No ${word}s match your search.`, { icon: "search" })));
        return;
      }
      grid.replaceChildren(...list.map((x) => groupCard(x.group, { role: x.role, primary: isPrimary(x) })));
    }
    render();
  }
})();
