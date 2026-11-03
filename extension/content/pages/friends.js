// CER friends page. Built on CER.ui (content/ui.js).
// Routes: /users/friends and /users/{id}/friends, with Roblox's hash tabs
// (#!/friends, #!/friend-requests, #!/followers, #!/following).
// Game-platform look: avatars first, a name, and a status only when it
// matters (Playing / Online / In Studio). No counts, no helper lines.
// Writes (accept, decline, unfriend) go through one `write()` that honours
// the dev dry-run switch: sessionStorage["cer-dry-writes"] = "1" logs instead
// of sending.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api } = CER;
  const h = ui.h;
  const FR = "https://friends.roblox.com/v1";

  // hash <-> tab (#!/online is an old Roblox tab: it lands on Friends, online first anyway)
  const TAB_HASH = { friends: "friends", requests: "friend-requests", followers: "followers", following: "following" };
  const HASH_TAB = { friends: "friends", online: "friends", "friend-requests": "requests", requests: "requests", followers: "followers", following: "following", followings: "following" };
  const tabFromHash = () => HASH_TAB[(location.hash.match(/^#!?\/?([\w-]+)/) ?? [])[1]?.toLowerCase()] ?? "friends";

  let S = null; // the live page session (replaced on every start)

  // ------------------------------------------------------------ data helpers
  const chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  // Fresh presence (api.presence caches forever; we refresh every 60 s).
  // Sent from the page, not the background worker: the worker's request
  // carries no Roblox session, so every friend came back "offline".
  async function presenceOf(ids) {
    const out = new Map();
    await Promise.all(
      chunk(ids.map(Number), 50).map(async (c) => {
        const j = await api.json("https://presence.roblox.com/v1/presence/users", { method: "POST", body: { userIds: c } });
        for (const p of j?.userPresences ?? []) out.set(String(p.userId), p);
      })
    );
    return out;
  }

  // Game names for in-game presences (by universe id, cached by api.game).
  async function gameNames(presences) {
    const ids = [...new Set([...presences.values()].map((p) => p.universeId).filter(Boolean))];
    if (!ids.length) return new Map();
    const games = await api.games(ids);
    const feats = CER._featsCache ?? {};
    return new Map([...games].map(([id, g]) => [id, CER.cleanTitle(g.name ?? "", feats)]));
  }

  // Friends / follow / request lists come back with blank or missing names.
  async function fillNames(list) {
    const missing = list.filter((u) => !u.name || !u.displayName).map((u) => u.id);
    if (!missing.length) return list;
    const names = await api.users(missing);
    for (const u of list) {
      const n = names.get(String(u.id));
      if (n) Object.assign(u, { name: n.name, displayName: n.displayName });
    }
    return list;
  }

  // One gate for every write. Returns { ok, status }.
  async function write(url, body = {}) {
    let dry = false;
    try {
      dry = sessionStorage.getItem("cer-dry-writes") === "1";
    } catch {
      /* storage off */
    }
    if (dry) {
      console.info("[CER friends] dry write (not sent)", url, JSON.stringify(body));
      return { ok: true, status: 200, dry: true };
    }
    try {
      return (await CER.robloxWrite(url, "POST", body)) ?? { ok: false, status: 0 };
    } catch {
      return { ok: false, status: 0 };
    }
  }
  const failMsg = (res, what) => (res.status === 429 ? "Too fast! Wait a moment." : "Could not " + what + ". Try again.");

  // ------------------------------------------------------------ person tile
  // Avatar first, then the name, then a status only when they are on.
  // setPresence() updates it in place (no image reload, no rebuild).
  function personTile(u, opts = {}) {
    const href = `https://www.roblox.com/users/${u.id}/profile`;
    const av = ui.avatar(u.id, { size: 112 });
    const face = h("span", { class: "fr-face" }, av);
    const status = h("span", { class: "fr-status" });
    const actions = h("div", { class: "fr-actions" });
    const name = u.displayName || u.name || "User " + u.id;
    const tile = h(
      "div",
      { class: "fr-tile", dataset: { id: u.id } },
      h("a", { class: "fr-link", href, title: u.name ? "@" + u.name : name }, face, h("span", { class: "fr-name", text: name })),
      status,
      actions
    );
    tile.user = u;
    tile.state = "offline";
    tile.actions = actions;

    let gameIcon = null;
    const join = ui.button("Join", { variant: "primary", size: "sm", class: "fr-join" });
    join.addEventListener("click", () => {
      const p = tile.presence;
      if (p) ui.play(p.placeId ?? p.rootPlaceId, p.gameId);
    });

    tile.setPresence = (p, games) => {
      tile.presence = p ?? null;
      const state = api.presenceState(p);
      tile.state = state;
      av.setPresence(state === "offline" ? null : state);
      join.remove();
      if (opts.noStatus) return;
      status.className = "fr-status is-" + state;
      // a small game icon on the avatar: who is playing what, at a glance
      const uni = state === "ingame" ? p.universeId : null;
      if (gameIcon && gameIcon.dataset.uni !== String(uni)) (gameIcon.remove(), (gameIcon = null));
      if (uni && !gameIcon) {
        gameIcon = h("span", { class: "fr-game", dataset: { uni } }, ui.thumb("gameIcon", uni));
        face.append(gameIcon);
      }
      if (state === "ingame") {
        const game = (uni && games?.get(String(uni))) || p.lastLocation;
        status.textContent = game ? "Playing " + game : "Playing";
        status.title = status.textContent;
        if (p.gameId && (p.placeId || p.rootPlaceId)) actions.prepend(join);
      } else status.textContent = state === "online" ? "Online" : state === "studio" ? "In Studio" : "";
    };
    tile.setPresence(null);
    if (opts.menu) tile.append(moreMenu(tile, opts.menu));
    return tile;
  }

  // Small "..." menu on a tile (shows on hover). items: [{ label, icon, tone, onClick }]
  function moreMenu(tile, items) {
    const pop = h("div", { class: "fr-menu", role: "menu" });
    const btn = ui.button("", { icon: "more", variant: "ghost", size: "sm", class: "fr-more", title: "More" });
    const close = () => {
      pop.classList.remove("is-open");
      document.removeEventListener("click", outside, true);
    };
    const outside = (e) => !pop.contains(e.target) && !btn.contains(e.target) && close();
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pop.classList.contains("is-open")) return close();
      pop.replaceChildren(
        ...items.map((it) => h("button", { type: "button", class: "fr-menu-item" + (it.tone ? " is-" + it.tone : ""), role: "menuitem", onClick: () => (close(), it.onClick(tile)) }, h("span", { text: it.label })))
      );
      pop.classList.add("is-open");
      document.addEventListener("click", outside, true);
    });
    return h("div", { class: "fr-more-wrap" }, btn, pop);
  }

  // ------------------------------------------------------------ progressive grid
  // Renders tiles in pages of 48 as the user scrolls (big friend lists).
  function fillGrid(grid, nodes, step = 48) {
    let i = 0;
    const more = () => {
      const part = nodes.slice(i, i + step);
      i += part.length;
      grid.append(...part);
      if (i < nodes.length) {
        const sentinel = h("div", { class: "fr-sentinel" });
        grid.after(sentinel);
        ui.whenVisible(sentinel, () => {
          sentinel.remove();
          more();
        });
      }
    };
    more();
  }
  const newGrid = () => h("div", { class: "fr-grid" });

  // ------------------------------------------------------------ page
  ui.route("friends", async () => {
    S?.stop();
    const session = (S = {
      alive: true,
      timers: [],
      stop() {
        this.alive = false;
        this.timers.forEach(clearInterval);
        document.removeEventListener("visibilitychange", this.onVis);
        window.removeEventListener("hashchange", this.onHash);
      },
    });

    const pathId = (location.pathname.match(/^\/users\/(\d+)\/friends/i) ?? [])[1] ?? null;

    // shell first (skeletons), data after
    const { page } = ui.page("friends", "fr-view");
    const headSlot = h("div", { class: "cer-sk fr-sk-title" });
    const tabSlot = h("div", { class: "fr-toolbar" }, h("div", { class: "cer-sk fr-sk-tabs" }));
    const body = h("div", { class: "fr-body" }, skeletonGrid());
    page.append(headSlot, tabSlot, body);

    const me = await api.me();
    if (!session.alive) return;
    if (!me) return ui.release(); // every friends list API needs a login
    const userId = pathId ?? String(me.id);
    const own = String(me.id) === String(userId);

    // ---- header: just the title (someone else's: their face + name, links back)
    if (own) headSlot.replaceWith(ui.header({ title: "Friends" }));
    else {
      const who = h("span", { class: "fr-who-name", text: "Friends" });
      headSlot.replaceWith(
        h("header", { class: "cer-view-head" }, h("a", { class: "fr-who", href: `https://www.roblox.com/users/${userId}/profile`, title: "Back to profile" }, ui.avatar(userId, { size: 56 }), h("h1", { class: "cer-view-title" }, who)))
      );
      api.user(userId).then((u) => {
        if (!u || !session.alive) return;
        who.textContent = (u.displayName || u.name) + "'s friends";
        document.title = (u.displayName || u.name) + "'s friends - Roblox";
      });
    }

    // ---- tabs + search
    const tabItems = [{ id: "friends", label: "Friends" }, own && { id: "requests", label: "Requests" }, { id: "followers", label: "Followers" }, { id: "following", label: "Following" }].filter(Boolean);
    let tab = tabFromHash();
    if (!tabItems.some((t) => t.id === tab)) tab = "friends";
    let query = "";
    const tabs = ui.tabs(tabItems, tab, (id) => go(id, true));
    const search = ui.search("Search", {
      class: "fr-search",
      onInput: (q) => {
        query = q.toLowerCase();
        render();
      },
    });
    tabSlot.replaceChildren(tabs, search);

    // the only number on the page: pending requests, when there are any
    let reqCount = null;
    const setReqCount = (n) => {
      reqCount = n == null ? null : Math.max(0, n);
      const it = tabItems.find((t) => t.id === "requests");
      if (!it) return;
      it.count = reqCount || null;
      tabs.set(tab);
    };
    if (own) api.json(`${FR}/user/friend-requests/count`).then((j) => session.alive && setReqCount(j?.count));

    // ---- state
    const tiles = new Map(); // id -> tile (friends)
    let friends = null; // [{ id, name, displayName }] or false on error
    const lists = {}; // followers / following / requests

    const friendsReady = (async () => {
      const j = await api.json(`${FR}/users/${userId}/friends`, { ttl: 60000 });
      if (!session.alive) return;
      if (!j) {
        friends = false;
        return;
      }
      friends = await fillNames((j.data ?? []).map((f) => ({ id: f.id, name: f.name, displayName: f.displayName })));
      const pres = await presenceOf(friends.map((f) => f.id));
      const games = await gameNames(pres);
      if (!session.alive) return;
      const menu = own
        ? [
            { label: "Chat", onClick: () => (CER.toggleChat ? CER.toggleChat() : (location.href = "https://www.roblox.com/my/messages")) },
            { label: "Unfriend", tone: "bad", onClick: (t) => confirmUnfriend(t) },
          ]
        : null;
      for (const f of friends) {
        const t = personTile(f, { menu });
        t.setPresence(pres.get(String(f.id)), games);
        tiles.set(String(f.id), t);
      }
    })();

    // Refresh presence every 60 s while the tab is visible.
    async function refresh() {
      if (!session.alive || document.hidden || !friends?.length) return;
      if (!document.getElementById("cer-app")?.contains(body)) return session.stop();
      const next = await presenceOf(friends.map((f) => f.id));
      if (!session.alive || !next.size) return;
      const games = await gameNames(next);
      let moved = false;
      for (const f of friends) {
        const t = tiles.get(String(f.id));
        const before = t.state;
        t.setPresence(next.get(String(f.id)), games);
        if ((t.state === "offline") !== (before === "offline") || (t.state === "ingame") !== (before === "ingame")) moved = true;
      }
      for (const kind of ["followers", "following"]) for (const t of lists[kind]?.tiles.values() ?? []) if (next.has(String(t.user.id))) t.setPresence(next.get(String(t.user.id)), games);
      if (moved && tab === "friends") render(true);
    }
    session.timers.push(setInterval(refresh, 60000));
    let lastVis = Date.now();
    session.onVis = () => {
      if (!document.hidden && Date.now() - lastVis > 60000) refresh();
      lastVis = Date.now();
    };
    document.addEventListener("visibilitychange", session.onVis);

    // ---- unfriend (own page only, behind a confirm)
    function confirmUnfriend(tile) {
      const name = tile.user.displayName || tile.user.name;
      ui.modal({
        title: "Unfriend " + name + "?",
        actions: [
          { label: "Cancel", variant: "ghost" },
          {
            label: "Unfriend",
            variant: "danger",
            onClick: async (close) => {
              const res = await write(`${FR}/users/${tile.user.id}/unfriend`);
              close();
              if (!res.ok) return CER.toast(failMsg(res, "unfriend"), "error");
              friends = friends.filter((f) => String(f.id) !== String(tile.user.id));
              tiles.delete(String(tile.user.id));
              tile.remove();
            },
          },
        ],
      });
    }

    // ---- views
    const matches = (u) => !query || (u.displayName ?? "").toLowerCase().includes(query) || (u.name ?? "").toLowerCase().includes(query);
    let renderTok = 0;

    async function render(keepScroll) {
      const tok = ++renderTok;
      const y = window.scrollY;
      if (!keepScroll) body.replaceChildren(skeletonGrid());
      if (tab === "friends") {
        await friendsReady;
        if (tok !== renderTok || !session.alive) return;
        renderFriends();
      } else await renderList(tab, tok);
      if (keepScroll && tok === renderTok) window.scrollTo(0, y);
    }

    function renderFriends() {
      if (friends === false) return body.replaceChildren(ui.empty(own ? "Could not load friends." : "This list is private.", { icon: own ? "users" : "lock" }));
      const rank = { ingame: 0, studio: 1, online: 2, offline: 3 };
      const stateOf = (f) => tiles.get(String(f.id))?.state ?? "offline";
      const list = friends.filter(matches).sort((a, b) => rank[stateOf(a)] - rank[stateOf(b)]);
      if (!list.length) return body.replaceChildren(ui.empty(query ? "No one found." : own ? "No friends yet." : "No friends yet.", { icon: query ? "search" : "users" }));
      const on = list.filter((f) => stateOf(f) !== "offline");
      const off = list.filter((f) => stateOf(f) === "offline");
      // one plain grid while searching; Online / Offline groups otherwise
      const groups = query || !on.length || !off.length ? [[null, list]] : [["Online", on], ["Offline", off]];
      body.replaceChildren(
        ...groups.map(([title, items]) => {
          const grid = newGrid();
          queueMicrotask(() => fillGrid(grid, items.map((f) => tiles.get(String(f.id)))));
          if (!title) return grid;
          const s = ui.section(title, { class: "fr-group" });
          s.body.append(grid);
          return s;
        })
      );
    }

    // followers / following / requests: cursor pages with "Load more"
    const LIST = {
      followers: (c) => `${FR}/users/${userId}/followers?limit=100&sortOrder=Desc${c ? "&cursor=" + encodeURIComponent(c) : ""}`,
      following: (c) => `${FR}/users/${userId}/followings?limit=100&sortOrder=Desc${c ? "&cursor=" + encodeURIComponent(c) : ""}`,
      requests: (c) => `${FR}/my/friends/requests?limit=50&sortOrder=Desc${c ? "&cursor=" + encodeURIComponent(c) : ""}`,
    };

    async function loadPage(kind) {
      const l = (lists[kind] ??= { items: [], cursor: null, done: false, tiles: new Map(), loading: null, failed: false });
      if (l.loading) return l.loading;
      if (l.done) return;
      l.loading = (async () => {
        const j = await api.json(LIST[kind](l.cursor));
        if (!j) {
          l.failed = !l.items.length;
          if (l.items.length) CER.toast("Could not load more. Try again.", "error");
          return;
        }
        const fresh = (j.data ?? []).map((d) => ({ id: d.id, name: d.name, displayName: d.displayName })).filter((u) => !l.tiles.has(String(u.id)));
        await fillNames(fresh);
        const p = kind === "requests" ? new Map() : await presenceOf(fresh.map((u) => u.id));
        const g = await gameNames(p);
        for (const u of fresh) {
          const t = kind === "requests" ? requestTile(u) : personTile(u);
          if (kind !== "requests") t.setPresence(p.get(String(u.id)), g);
          l.tiles.set(String(u.id), t);
          l.items.push(u);
        }
        l.cursor = j.nextPageCursor ?? null;
        l.done = !l.cursor;
      })();
      try {
        await l.loading;
      } finally {
        l.loading = null;
      }
    }

    async function renderList(kind, tok) {
      if (!lists[kind]?.items.length) await loadPage(kind);
      if (tok !== renderTok || !session.alive) return;
      const l = lists[kind];
      if (l.failed) {
        l.failed = false;
        return body.replaceChildren(ui.empty(kind === "requests" ? "Could not load requests." : "This list is private.", { icon: kind === "requests" ? "userPlus" : "lock" }));
      }
      const items = l.items.filter(matches);
      if (!items.length && (l.done || !query)) {
        const msg = query ? "No one found." : kind === "requests" ? "No friend requests." : kind === "followers" ? "No followers yet." : "Not following anyone.";
        return body.replaceChildren(ui.empty(msg, { icon: query ? "search" : kind === "requests" ? "userPlus" : "users" }));
      }
      const grid = newGrid();
      const foot = h("div", { class: "fr-foot" });
      body.replaceChildren(grid, foot);
      fillGrid(grid, items.map((u) => l.tiles.get(String(u.id))));
      if (!l.done) {
        const btn = ui.button("Load more", { variant: "soft" });
        btn.addEventListener("click", async () => {
          btn.busy(true);
          const t = renderTok;
          await loadPage(kind);
          if (t === renderTok && tab === kind) render(true);
        });
        foot.append(btn);
      }
    }

    // A friend request: Accept (primary) and a quiet Decline.
    function requestTile(u) {
      const t = personTile(u, { noStatus: true });
      const accept = ui.button("Accept", { variant: "primary", size: "sm" });
      const decline = ui.button("", { icon: "x", variant: "soft", size: "sm", title: "Decline" });
      const settle = (text) => {
        t.actions.replaceChildren(h("span", { class: "fr-done", text }));
        t.classList.add("is-done");
        setReqCount((reqCount ?? 1) - 1);
      };
      const act = async (btn, other, verb, done) => {
        btn.busy(true);
        other.disabled = true;
        const res = await write(`${FR}/users/${u.id}/${verb}-friend-request`);
        if (res.ok) return settle(done);
        btn.busy(false);
        other.disabled = false;
        CER.toast(failMsg(res, verb), "error");
      };
      accept.addEventListener("click", () => act(accept, decline, "accept", "Friends!"));
      decline.addEventListener("click", () => act(decline, accept, "decline", "Declined"));
      t.actions.append(accept, decline);
      return t;
    }

    // ---- tab switching (+ Roblox-style hash so links and Back work)
    function go(id, push) {
      if (!tabItems.some((t) => t.id === id)) id = "friends";
      tab = id;
      tabs.set(id);
      const want = "#!/" + TAB_HASH[id];
      if (push && location.hash !== want) history.replaceState(history.state, "", location.pathname + location.search + want);
      render();
    }
    session.onHash = () => {
      const id = tabFromHash();
      if (id !== tab) go(id, false);
    };
    window.addEventListener("hashchange", session.onHash);

    render();
  });

  function skeletonGrid() {
    return h(
      "div",
      { class: "fr-grid" },
      Array.from({ length: 14 }, () => h("div", { class: "fr-tile fr-tile-sk" }, h("div", { class: "cer-sk fr-sk-av" }), h("div", { class: "cer-sk cer-sk-line" })))
    );
  }
})();
