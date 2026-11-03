// CER friends page. Built on CER.ui (content/ui.js).
// Routes: /users/friends and /users/{id}/friends, with Roblox's hash tabs
// (#!/friends, #!/online, #!/friend-requests, #!/followers, #!/following).
// Data only from friends / users / presence / games APIs. Writes (accept,
// decline, unfriend) go through one `write()` that honours the dev dry-run
// switch: sessionStorage["cer-dry-writes"] = "1" logs instead of sending.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;
  const FR = "https://friends.roblox.com/v1";

  // hash <-> tab
  const TAB_HASH = { friends: "friends", online: "online", requests: "friend-requests", followers: "followers", following: "following" };
  const HASH_TAB = Object.fromEntries(Object.entries(TAB_HASH).map(([k, v]) => [v, k]));
  HASH_TAB.requests = "requests";
  HASH_TAB["friend-requests"] = "requests";
  HASH_TAB.followings = "following";
  const tabFromHash = () => HASH_TAB[(location.hash.match(/^#!?\/?([\w-]+)/) ?? [])[1]?.toLowerCase()] ?? "friends";

  let S = null; // the live page session (replaced on every start)

  // ------------------------------------------------------------ data helpers
  const chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  // Fresh presence (api.presence caches forever, we refresh every 60 s).
  async function presenceOf(ids) {
    const out = new Map();
    await Promise.all(
      chunk(ids.map(Number), 50).map(async (c) => {
        const j = await api.json("https://presence.roblox.com/v1/presence/users", { method: "POST", body: { userIds: c }, bg: true });
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

  // Fill empty name / displayName from the users API (friends and follow
  // lists now come back with blank names).
  async function fillNames(list) {
    const missing = list.filter((u) => !u.name || !u.displayName).map((u) => u.id);
    if (!missing.length) return list;
    const names = await api.users(missing);
    for (const u of list) {
      const n = names.get(String(u.id));
      if (n) Object.assign(u, { name: n.name, displayName: n.displayName, hasVerifiedBadge: n.hasVerifiedBadge });
    }
    return list;
  }

  // One gate for every write. Returns a Response-like { ok, status }.
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

  // ------------------------------------------------------------ person card
  // A card for one person. Owns its presence display so refreshes can update
  // it in place (no image reload, no layout rebuild).
  function personCard(u, opts = {}) {
    const href = `https://www.roblox.com/users/${u.id}/profile`;
    const av = ui.avatar(u.id, { size: 96 });
    const status = h("div", { class: "fr-status" });
    const actions = h("div", { class: "fr-actions" });
    const name = h("span", { class: "fr-name" }, h("span", { class: "fr-name-text", text: u.displayName || u.name || "User " + u.id }), u.hasVerifiedBadge && ui.icon("verified", 15, "fr-verified"));
    const card = h(
      "div",
      { class: "fr-card", dataset: { id: u.id } },
      h("a", { class: "fr-link", href, title: u.displayName || u.name }, av, name, u.name && h("span", { class: "fr-handle", text: "@" + u.name })),
      status,
      actions
    );
    card.user = u;
    card.state = "offline";

    const join = ui.button("Join", { icon: "play", variant: "good", size: "sm", class: "fr-join" });
    join.addEventListener("click", () => card.presence && ui.play(card.presence.placeId ?? card.presence.rootPlaceId, card.presence.gameId));

    card.setStatus = (text, tone = "none", icon) => {
      status.className = "fr-status is-" + tone;
      status.replaceChildren(icon ? ui.icon(icon, 14) : h("span", { class: "fr-dot" }), h("span", { class: "fr-status-text", text }));
      status.title = text;
    };
    card.setPresence = (p, games) => {
      card.presence = p ?? null;
      const state = api.presenceState(p);
      card.state = state;
      av.setPresence(state === "offline" ? null : state);
      join.remove();
      if (opts.statusText) return card.setStatus(opts.statusText, "none", opts.statusIcon);
      if (state === "ingame") {
        const game = (p.universeId && games?.get(String(p.universeId))) || p.lastLocation;
        card.setStatus(game ? "Playing " + game : "In a game", "ingame");
        // joinable only when Roblox shares the server with us
        if (p.gameId && (p.placeId || p.rootPlaceId) && opts.canJoin !== false) actions.prepend(join);
      } else if (state === "online") card.setStatus("Online", "online");
      else if (state === "studio") card.setStatus("In Studio", "studio");
      else if (p?.lastOnline && new Date(p.lastOnline).getFullYear() > 2006 && Date.now() - new Date(p.lastOnline) > 120000) card.setStatus("Online " + fmt.ago(p.lastOnline), "offline");
      else card.setStatus("Offline", "offline");
    };
    card.actions = actions;
    card.setPresence(null);
    if (opts.menu) card.append(moreMenu(card, opts.menu));
    return card;
  }

  // Small "..." menu on a card. items: [{ label, icon, tone, onClick }]
  function moreMenu(card, items) {
    const pop = h("div", { class: "fr-menu", role: "menu" });
    const btn = ui.button("", { icon: "more", variant: "ghost", size: "sm", class: "fr-more", title: "More" });
    const close = () => {
      pop.classList.remove("is-open");
      document.removeEventListener("click", outside, true);
    };
    const outside = (e) => !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target) && close();
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pop.classList.contains("is-open")) return close();
      pop.replaceChildren(
        ...items.map((it) =>
          h("button", { type: "button", class: "fr-menu-item" + (it.tone ? " is-" + it.tone : ""), role: "menuitem", onClick: () => (close(), it.onClick(card)) }, ui.icon(it.icon, 16), h("span", { text: it.label }))
        )
      );
      pop.classList.add("is-open");
      document.addEventListener("click", outside, true);
    });
    return h("div", { class: "fr-more-wrap" }, btn, pop);
  }

  // ------------------------------------------------------------ progressive grid
  // Renders cards in pages of 48 as the user scrolls (big friend lists).
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

  // ------------------------------------------------------------ page
  ui.route("friends", async () => {
    S?.stop();
    const session = (S = { alive: true, timers: [], stop() { this.alive = false; this.timers.forEach(clearInterval); document.removeEventListener("visibilitychange", this.onVis); window.removeEventListener("hashchange", this.onHash); } });

    const pathId = (location.pathname.match(/^\/users\/(\d+)\/friends/i) ?? [])[1] ?? null;

    // shell first (skeletons), data after
    const { page } = ui.page("friends", "fr-view");
    const headSlot = h("div", { class: "fr-head" }, h("div", { class: "cer-sk fr-sk-title" }), h("div", { class: "cer-sk fr-sk-sub" }));
    const tabSlot = h("div", { class: "fr-toolbar" }, h("div", { class: "cer-sk fr-sk-tabs" }));
    const body = h("div", { class: "fr-body" }, skeletonGrid());
    page.append(headSlot, tabSlot, body);

    const me = await api.me();
    if (!session.alive) return;
    if (!me) return ui.release(); // every friends list API needs a login
    const userId = pathId ?? String(me.id);
    const own = String(me.id) === String(userId);

    // ---- header
    const counts = {};
    const subLine = h("p", { class: "cer-view-sub fr-sub" });
    if (own) {
      headSlot.replaceWith(ui.header({ title: "Friends", icon: "users" }));
      page.querySelector(".cer-view-head-text").append(subLine);
    } else {
      const who = h("span", { class: "fr-who-name", text: "Friends" });
      const handle = h("span", { class: "fr-who-handle" });
      const head = h(
        "header",
        { class: "cer-view-head fr-other-head" },
        h(
          "a",
          { class: "fr-who", href: `https://www.roblox.com/users/${userId}/profile`, title: "Open profile" },
          ui.avatar(userId, { size: 72 }),
          h("span", { class: "fr-who-text" }, h("h1", { class: "cer-view-title" }, who), handle, subLine)
        ),
        h("div", { class: "cer-view-actions" }, ui.button("Profile", { icon: "arrowLeft", variant: "soft", href: `https://www.roblox.com/users/${userId}/profile` }))
      );
      headSlot.replaceWith(head);
      api.user(userId).then((u) => {
        if (!u || !session.alive) return;
        who.textContent = (u.displayName || u.name) + "'s friends";
        handle.textContent = "@" + u.name;
        document.title = (u.displayName || u.name) + "'s friends - Roblox";
      });
    }

    // ---- tabs + search
    const tabItems = [
      { id: "friends", label: "Friends", icon: "users" },
      { id: "online", label: "Online", icon: "zap" },
      own && { id: "requests", label: "Requests", icon: "userPlus" },
      { id: "followers", label: "Followers", icon: "heart" },
      { id: "following", label: "Following", icon: "star" },
    ].filter(Boolean);
    let tab = tabFromHash();
    if (!tabItems.some((t) => t.id === tab)) tab = "friends";
    let query = "";
    const tabs = ui.tabs(tabItems, tab, (id) => go(id, true));
    const search = ui.search("Find someone", {
      class: "fr-search",
      onInput: (q) => {
        query = q.toLowerCase();
        render();
      },
    });
    tabSlot.replaceChildren(tabs, search);
    const setCount = (id, n) => {
      const it = tabItems.find((t) => t.id === id);
      if (!it || n == null) return;
      it.count = n;
      tabs.set(tab);
    };

    // counts (parallel, independent; a failure just leaves the tab without a number)
    const countUrl = { friends: `${FR}/users/${userId}/friends/count`, followers: `${FR}/users/${userId}/followers/count`, following: `${FR}/users/${userId}/followings/count` };
    if (own) countUrl.requests = `${FR}/user/friend-requests/count`;
    for (const [id, url] of Object.entries(countUrl))
      api.json(url, { ttl: 60000 }).then((j) => {
        if (!session.alive || j?.count == null) return;
        counts[id] = j.count;
        setCount(id, j.count);
        updateSub();
      });

    // ---- state
    const cards = new Map(); // id -> card (friends)
    let friends = null; // [{ id, name, displayName }] or false on error
    let pres = new Map();
    let games = new Map();
    const lists = {}; // followers / following / requests: { items, cursor, cards, loading, failed }

    function updateSub() {
      if (!session.alive) return;
      const parts = [];
      const n = counts.friends ?? (friends ? friends.length : null);
      if (n != null) parts.push(fmt.full(n) + (n === 1 ? " friend" : " friends"));
      if (friends) {
        const on = friends.filter((f) => cards.get(String(f.id))?.state !== "offline").length;
        parts.push(on + " online now");
      }
      subLine.textContent = parts.join(". ");
    }

    // ---- friends + presence
    const friendsReady = (async () => {
      const j = await api.json(`${FR}/users/${userId}/friends`, { ttl: 60000 });
      if (!session.alive) return;
      if (!j) {
        friends = false;
        return;
      }
      friends = await fillNames((j.data ?? []).map((f) => ({ id: f.id, name: f.name, displayName: f.displayName, hasVerifiedBadge: f.hasVerifiedBadge })));
      const ids = friends.map((f) => f.id);
      pres = await presenceOf(ids);
      games = await gameNames(pres);
      if (!session.alive) return;
      const menu = own
        ? [
            { label: "Open chat", icon: "chat", onClick: () => (CER.toggleChat ? CER.toggleChat() : (location.href = "https://www.roblox.com/my/messages")) },
            { label: "Unfriend", icon: "x", tone: "bad", onClick: (c) => confirmUnfriend(c) },
          ]
        : null;
      for (const f of friends) {
        const c = personCard(f, { menu });
        c.setPresence(pres.get(String(f.id)), games);
        cards.set(String(f.id), c);
      }
      setCount("online", friends.filter((f) => cards.get(String(f.id)).state !== "offline").length);
      if (counts.friends == null) setCount("friends", friends.length);
      updateSub();
    })();

    // Refresh presence every 60 s while the tab is visible.
    async function refresh() {
      if (!session.alive || document.hidden || !friends?.length) return;
      if (!document.getElementById("cer-app")?.contains(body)) return session.stop();
      const next = await presenceOf(friends.map((f) => f.id));
      if (!session.alive || !next.size) return;
      const newGames = await gameNames(next);
      let moved = false;
      for (const f of friends) {
        const c = cards.get(String(f.id));
        const before = c.state;
        c.setPresence(next.get(String(f.id)), newGames);
        if (c.state !== before) moved = true;
      }
      pres = next;
      games = newGames;
      setCount("online", friends.filter((f) => cards.get(String(f.id)).state !== "offline").length);
      updateSub();
      // follower / following cards on screen get the fresh state too
      for (const [kind, l] of Object.entries(lists)) if (kind !== "requests") for (const c of l.cards?.values() ?? []) if (next.has(String(c.user.id))) c.setPresence(next.get(String(c.user.id)), newGames);
      if (moved && (tab === "friends" || tab === "online")) render(true);
    }
    session.timers.push(setInterval(refresh, 60000));
    let lastVis = Date.now();
    session.onVis = () => {
      if (!document.hidden && Date.now() - lastVis > 60000) refresh();
      lastVis = Date.now();
    };
    document.addEventListener("visibilitychange", session.onVis);

    // ---- unfriend (own page only, behind a confirm)
    function confirmUnfriend(card) {
      const name = card.user.displayName || card.user.name;
      ui.modal({
        title: "Unfriend " + name + "?",
        body: h("p", { text: "You will not be friends anymore. You can send a new request later." }),
        actions: [
          { label: "Cancel", variant: "ghost" },
          {
            label: "Unfriend",
            variant: "danger",
            onClick: async (close) => {
              const res = await write(`${FR}/users/${card.user.id}/unfriend`);
              close();
              if (!res.ok) return CER.toast(res.status === 429 ? "Too fast! Wait a moment." : "Could not unfriend. Try again.", "error");
              friends = friends.filter((f) => String(f.id) !== String(card.user.id));
              cards.delete(String(card.user.id));
              card.remove();
              if (counts.friends != null) setCount("friends", (counts.friends = Math.max(0, counts.friends - 1)));
              updateSub();
              CER.toast("Unfriended " + name);
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
      if (tab === "friends" || tab === "online") {
        await friendsReady;
        if (tok !== renderTok || !session.alive) return;
        renderFriends(tab === "online");
      } else {
        await renderList(tab, tok);
      }
      if (keepScroll && tok === renderTok) window.scrollTo(0, y);
    }

    function renderFriends(onlineOnly) {
      if (friends === false) return body.replaceChildren(ui.empty(own ? "Could not load your friends. Try again soon." : "This friends list is hidden.", { icon: "lock" }));
      let list = friends.filter(matches);
      const ord = { ingame: 0, studio: 1, online: 1, offline: 2 };
      const stateOf = (f) => cards.get(String(f.id))?.state ?? "offline";
      list.sort((a, b) => ord[stateOf(a)] - ord[stateOf(b)]);
      if (onlineOnly) list = list.filter((f) => stateOf(f) !== "offline");
      if (!list.length) {
        const msg = query ? "No one matches that name." : onlineOnly ? "No friends are online right now." : own ? "No friends yet. Add some from their profiles!" : "No friends to show.";
        return body.replaceChildren(ui.empty(msg, { icon: query ? "search" : "users" }));
      }
      if (query) {
        const grid = ui.grid([], { min: 180, gap: 14, class: "fr-grid" });
        body.replaceChildren(grid);
        return fillGrid(grid, list.map((f) => cards.get(String(f.id))));
      }
      const groups = [
        ["Playing now", "gamepad", list.filter((f) => stateOf(f) === "ingame")],
        ["Online", "zap", list.filter((f) => stateOf(f) === "online" || stateOf(f) === "studio")],
        ["Offline", "clock", onlineOnly ? [] : list.filter((f) => stateOf(f) === "offline")],
      ].filter((g) => g[2].length);
      body.replaceChildren(
        ...groups.map(([title, icon, items]) => {
          const s = ui.section(title, { icon, count: items.length, class: "fr-group" });
          const grid = ui.grid([], { min: 180, gap: 14, class: "fr-grid" });
          s.body.append(grid);
          // fill after mount so the sentinel can sit after the grid
          queueMicrotask(() => fillGrid(grid, items.map((f) => cards.get(String(f.id)))));
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
      const l = (lists[kind] ??= { items: [], cursor: null, done: false, cards: new Map(), loading: null, failed: false });
      if (l.loading) return l.loading;
      if (l.done) return;
      l.loading = (async () => {
        const j = await api.json(LIST[kind](l.cursor));
        if (!j) {
          l.failed = !l.items.length;
          if (l.items.length) CER.toast("Could not load more. Try again.", "error");
          return;
        }
        const raw = (j.data ?? []).map((d) => ({ id: d.id, name: d.name, displayName: d.displayName, hasVerifiedBadge: d.hasVerifiedBadge, req: d.friendRequest, mutual: d.mutualFriendsList }));
        const fresh = raw.filter((u) => !l.cards.has(String(u.id)));
        await fillNames(fresh);
        const p = await presenceOf(fresh.map((u) => u.id));
        const g = await gameNames(p);
        for (const u of fresh) {
          const c = kind === "requests" ? requestCard(u) : personCard(u);
          if (kind !== "requests") c.setPresence(p.get(String(u.id)), g);
          l.cards.set(String(u.id), c);
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
        return body.replaceChildren(ui.empty(kind === "requests" ? "Could not load requests. Try again soon." : "This list is hidden or could not load.", { icon: "lock" }));
      }
      const items = l.items.filter(matches);
      if (!items.length && (l.done || !query)) {
        const msg = query ? "No one matches that name." : kind === "requests" ? "No friend requests right now." : kind === "followers" ? "No followers yet." : "Not following anyone yet.";
        return body.replaceChildren(ui.empty(msg, { icon: query ? "search" : kind === "requests" ? "userPlus" : "users" }));
      }
      const grid = ui.grid([], { min: 180, gap: 14, class: "fr-grid" });
      const foot = h("div", { class: "fr-foot" });
      body.replaceChildren(grid, foot);
      fillGrid(grid, items.map((u) => l.cards.get(String(u.id))));
      if (!l.done) {
        const btn = ui.button("Load more", { icon: "down", variant: "soft" });
        btn.addEventListener("click", async () => {
          btn.busy(true);
          const t = renderTok;
          await loadPage(kind);
          if (t === renderTok && tab === kind) render(true);
        });
        foot.append(btn);
      }
    }

    // A friend request card: Accept / Decline (real writes, for real users).
    function requestCard(u) {
      const c = personCard(u, { statusText: u.req?.sentAt ? "Sent " + fmt.ago(u.req.sentAt) : "Wants to be friends", statusIcon: "userPlus" });
      const mutual = u.mutual?.length;
      if (mutual) c.querySelector(".fr-status").after(h("div", { class: "fr-mutual", text: mutual + (mutual === 1 ? " friend in common" : " friends in common") }));
      const accept = ui.button("Accept", { icon: "check", variant: "primary", size: "sm" });
      const decline = ui.button("Decline", { variant: "soft", size: "sm" });
      const done = (text, tone) => {
        c.actions.replaceChildren(ui.badge(text, tone, tone === "good" ? "userCheck" : null));
        c.classList.add("is-done");
        if (counts.requests != null) setCount("requests", (counts.requests = Math.max(0, counts.requests - 1)));
      };
      accept.addEventListener("click", async () => {
        accept.busy(true);
        decline.disabled = true;
        const res = await write(`${FR}/users/${u.id}/accept-friend-request`);
        if (res.ok) {
          done("Friends now!", "good");
          if (counts.friends != null) setCount("friends", ++counts.friends);
          return;
        }
        accept.busy(false);
        decline.disabled = false;
        CER.toast(res.status === 429 ? "Too fast! Wait a moment." : "Could not accept. Try again.", "error");
      });
      decline.addEventListener("click", async () => {
        decline.busy(true);
        accept.disabled = true;
        const res = await write(`${FR}/users/${u.id}/decline-friend-request`);
        if (res.ok) return done("Declined", "plain");
        decline.busy(false);
        accept.disabled = false;
        CER.toast(res.status === 429 ? "Too fast! Wait a moment." : "Could not decline. Try again.", "error");
      });
      c.actions.classList.add("is-split");
      c.actions.append(accept, decline);
      return c;
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
      { class: "cer-autogrid fr-grid", style: { "--min": "180px", "--gap": "14px" } },
      Array.from({ length: 12 }, () => h("div", { class: "fr-card fr-card-sk" }, h("div", { class: "cer-sk fr-sk-av" }), h("div", { class: "cer-sk cer-sk-line" }), h("div", { class: "cer-sk cer-sk-line short" })))
    );
  }
})();
