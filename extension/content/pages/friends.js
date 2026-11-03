// CER friends page. Built on CER.ui (content/ui.js).
// Routes: /users/friends and /users/{id}/friends, with Roblox's hash tabs
// (#!/friends, #!/friend-requests, #!/followers, #!/following).
// Game-platform look: avatars first, a name, and a status only when it
// adds something (the game, or In Studio; the ring and the Online heading
// say the rest). No counts, no helper lines. Join is a small round button
// on the avatar.
// Requests: sort (Newest / Most mutual / Most followers) and filters (Mutual
// friends, Verified, Over X followers). With any of them on, every request
// page is loaded first. Mutual friends come with the request list; follower counts are fetched lazily (visible tiles first, all of them
// only while a followers sort/filter is on), queued with 429 backoff and
// cached 12 h in localStorage.
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
  // Presence through the shared api.presence (short cache, one request for
  // everyone asking, no 429 storm). Ids whose lookup failed are absent from
  // its Map: they keep their previous presence (`prev`), so a hiccup never
  // flips friends to offline or hides their Join button.
  async function presenceOf(ids, prev) {
    const got = await api.presence(ids.map(String)).catch(() => new Map());
    const out = new Map();
    for (const id of ids) {
      const k = String(id);
      if (got.has(k)) out.set(k, got.get(k));
      else if (prev?.has(k)) out.set(k, prev.get(k));
    }
    return out;
  }

  // GET with the HTTP status, so "private" (403) and "failed" can differ.
  async function getJson(url) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(url, { credentials: "include" });
        if (r.status === 429 && attempt < 2) {
          await new Promise((ok) => setTimeout(ok, 600 * (attempt + 1)));
          continue;
        }
        return { status: r.status, data: r.ok ? await r.json().catch(() => null) : null };
      } catch {
        return { status: 0, data: null };
      }
    }
  }
  const isPrivate = (status) => status === 403 || status === 400;

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
      if (n) Object.assign(u, { name: n.name, displayName: n.displayName, hasVerifiedBadge: n.hasVerifiedBadge });
    }
    return list;
  }

  // ------------------------------------------------------------ follower counts
  // Source: the profile header API Roblox's own profile uses (one POST read
  // per user, verified live: 10 in parallel all 200). friends v1
  // users/{id}/followers/count is the fallback: it 429s after ONE call per
  // IP for a while (verified live), so it is only asked when the first fails.
  // One queue, 3 at a time (1 after a 429), a shared pause, a 12 h cache.
  const PP = "https://apis.roblox.com/profile-platform-api/v1/profiles/get";
  async function fetchFollowers(id) {
    try {
      const r = await CER.robloxWrite(PP, "POST", { profileType: "User", profileId: String(id), components: [{ component: "UserProfileHeader" }], includeComponentOrdering: false });
      if (r?.status === 429) return 429;
      if (r?.ok) {
        const c = (await r.json().catch(() => null))?.components?.UserProfileHeader?.counts;
        if (typeof c?.followersCount === "number") return { n: c.followersCount };
      }
    } catch {
      /* CORS / network: try the old count */
    }
    try {
      const r = await fetch(`${FR}/users/${id}/followers/count`, { credentials: "include" });
      if (r.status === 429) return 429;
      if (r.ok) {
        const n = (await r.json().catch(() => null))?.count;
        if (typeof n === "number") return { n };
      }
    } catch {
      /* give up on this one */
    }
    return null;
  }
  const FC_KEY = "cer-fr-followers";
  const FC_TTL = 12 * 3600 * 1000;
  let fcCache = {};
  try {
    fcCache = JSON.parse(localStorage.getItem(FC_KEY) ?? "{}") || {};
  } catch {
    /* storage off: memory only */
  }
  let fcSaveT = null;
  const fcSave = () => {
    clearTimeout(fcSaveT);
    fcSaveT = setTimeout(() => {
      try {
        const keep = Object.entries(fcCache)
          .filter(([, v]) => Date.now() - v[1] < FC_TTL)
          .sort((a, b) => b[1][1] - a[1][1])
          .slice(0, 3000);
        fcCache = Object.fromEntries(keep);
        localStorage.setItem(FC_KEY, JSON.stringify(fcCache));
      } catch {
        /* quota: memory cache still works */
      }
    }, 800);
  };
  const fcQueue = [];
  const fcWait = new Map(); // id -> { promise, job }
  let fcActive = 0;
  let fcPauseUntil = 0;
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  // known count or undefined (no request)
  const followersKnown = (id) => {
    const c = fcCache[String(id)];
    return c && Date.now() - c[1] < FC_TTL ? c[0] : undefined;
  };
  // Promise<number|null>. urgent: jump the queue (tiles on screen)
  function followersCount(id, urgent) {
    id = String(id);
    const known = followersKnown(id);
    if (known !== undefined) return Promise.resolve(known);
    const w = fcWait.get(id);
    if (w) {
      if (urgent && fcQueue.includes(w.job)) fcQueue.splice(fcQueue.indexOf(w.job), 1), fcQueue.unshift(w.job);
      return w.promise;
    }
    let job;
    const promise = new Promise((res) => (job = { id, res }));
    urgent ? fcQueue.unshift(job) : fcQueue.push(job);
    fcWait.set(id, { promise, job });
    fcPump();
    return promise;
  }
  function fcPump() {
    // 2 at a time, 1 while Roblox is saying "too many requests"
    while (fcActive < (Date.now() < fcPauseUntil + 5000 ? 1 : 3) && fcQueue.length) {
      const job = fcQueue.shift();
      fcActive++;
      (async () => {
        let n = null;
        for (let a = 0; a < 7; a++) {
          const wait = fcPauseUntil - Date.now();
          if (wait > 0) await sleep(wait);
          const r = await fetchFollowers(job.id);
          if (r === 429) {
            fcPauseUntil = Math.max(fcPauseUntil, Date.now() + Math.min(2000 * (a + 1), 10000));
            continue;
          }
          n = r?.n ?? null;
          break;
        }
        if (typeof n === "number") {
          fcCache[job.id] = [n, Date.now()];
          fcSave();
        }
        fcWait.delete(job.id);
        job.res(n);
        await sleep(80);
        fcActive--;
        fcPump();
      })();
    }
  }
  // drop queued (not started) lookups when the page goes away
  function fcDrop() {
    for (const job of fcQueue.splice(0)) {
      fcWait.delete(job.id);
      job.res(null);
    }
  }
  const fcPending = () => fcQueue.length + fcActive;

  // One gate for every write. Returns { ok, status }.
  async function write(url, body = {}) {
    let dry = false;
    try {
      dry = !!CER.dev && sessionStorage.getItem("cer-dry-writes") === "1"; // unpacked test builds only
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
      h("a", { class: "fr-link", href, title: u.name ? "@" + u.name : name }, face, ui.nameTag({ type: "user", id: u.id, name, verified: u.hasVerifiedBadge, size: "sm", cls: "fr-name" })),
      status,
      actions
    );
    tile.user = u;
    tile.state = "offline";
    tile.actions = actions;

    let gameIcon = null;
    // Join: a small round button on the avatar (shows on hover), not a big one per row
    const join = ui.button("", { icon: "play", variant: "primary", size: "sm", class: "fr-join", title: "Join" });
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
      // only what the heading and the ring do not already say: the game, or Studio
      if (state === "ingame") {
        const game = (uni && games?.get(String(uni))) || p.lastLocation || "";
        status.textContent = game;
        status.title = game;
        if (p.gameId && (p.placeId || p.rootPlaceId)) tile.append(join);
      } else {
        status.textContent = state === "studio" ? "In Studio" : "";
        status.title = "";
      }
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
  // Returns a disposer that disconnects the pending sentinel observer.
  function fillGrid(grid, nodes, step = 48) {
    let i = 0;
    let dispose = null;
    const more = () => {
      const part = nodes.slice(i, i + step);
      i += part.length;
      grid.append(...part);
      if (i < nodes.length) {
        const sentinel = h("div", { class: "fr-sentinel" });
        grid.after(sentinel);
        dispose = ui.whenVisible(sentinel, () => {
          sentinel.remove();
          more();
        });
      } else dispose = null;
    };
    more();
    return () => {
      if (typeof dispose === "function") dispose();
      dispose = null;
    };
  }
  const newGrid = () => h("div", { class: "fr-grid" });

  // ------------------------------------------------------------ page
  ui.route("friends", start);
  async function start() {
    S?.stop();
    const session = (S = {
      alive: true,
      timers: [],
      stop() {
        this.alive = false;
        this.timers.forEach(clearInterval);
        fcDrop();
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
    if (!me) {
      // every friends list API needs a login, but only a real 401/403 means
      // signed out; a busy or failed check gets Try again, not Roblox's page
      if (CER.loggedOut) return ui.release();
      headSlot.replaceWith(ui.header({ title: "Friends" }));
      tabSlot.remove();
      body.replaceChildren(ui.empty("Could not load. Try again.", { icon: "users", action: ui.button("Try again", { variant: "soft", onClick: () => start() }) }));
      return;
    }
    const userId = pathId ?? String(me.id);
    const own = String(me.id) === String(userId);

    // ---- header: just the title (someone else's: their face + name, links back)
    if (own) headSlot.replaceWith(ui.header({ title: "Friends" }));
    else {
      // their face + name (with badges) is the title; the tabs say the rest
      const who = h("h1", { class: "cer-view-title fr-who-name" }, h("span", { class: "cer-sk fr-sk-name" }));
      headSlot.replaceWith(h("header", { class: "cer-view-head" }, h("a", { class: "fr-who", href: `https://www.roblox.com/users/${userId}/profile`, title: "Back to profile" }, ui.avatar(userId, { size: 56 }), who)));
      api.user(userId).then((u) => {
        if (!session.alive) return;
        if (!u) return who.replaceChildren("Friends");
        who.replaceChildren(ui.nameTag({ type: "user", id: u.id, name: u.displayName || u.name, verified: !!u.hasVerifiedBadge, size: "lg" }));
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

    // ---- requests: sort + filters (one quiet row, Requests tab only).
    // Saved per browser, so the same picks come back next time.
    const REQ_KEY = "cer-fr-reqview";
    const rv = { sort: "new", mutual: false, verified: false, followers: false, min: 100 };
    try {
      Object.assign(rv, JSON.parse(localStorage.getItem(REQ_KEY) ?? "{}"));
    } catch {
      /* storage off */
    }
    const saveRv = () => {
      try {
        localStorage.setItem(REQ_KEY, JSON.stringify(rv));
      } catch {
        /* storage off */
      }
    };
    const needFollowers = () => rv.sort === "followers" || rv.followers;
    // a sort or filter has to see every request, not only the loaded pages
    const reqPicky = () => rv.sort !== "new" || rv.mutual || rv.verified || rv.followers;
    const reqBar = h("div", { class: "fr-reqbar", hidden: true });
    if (own) {
      const toggle = (label, key) => {
        const c = ui.chip(label, { active: rv[key] });
        c.addEventListener("click", () => {
          rv[key] = !rv[key];
          c.classList.toggle("is-active", rv[key]);
          c.setAttribute("aria-pressed", rv[key] ? "true" : "false");
          saveRv();
          reqChanged();
        });
        return c;
      };
      // "Over [100] followers": the chip toggles, the number edits X
      const minIn = h("input", { class: "fr-min", type: "number", min: "0", step: "1", value: String(rv.min), "aria-label": "Followers", inputmode: "numeric" });
      const fChip = h("div", { class: "cer-chip fr-fchip" + (rv.followers ? " is-active" : ""), role: "button", tabindex: "0", "aria-pressed": rv.followers ? "true" : "false" }, h("span", { text: "Over" }), minIn, h("span", { text: "followers" }));
      const setF = (on) => {
        rv.followers = on;
        fChip.classList.toggle("is-active", on);
        fChip.setAttribute("aria-pressed", on ? "true" : "false");
        saveRv();
        reqChanged();
      };
      fChip.addEventListener("click", (e) => e.target !== minIn && setF(!rv.followers));
      fChip.addEventListener("keydown", (e) => e.target !== minIn && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setF(!rv.followers)));
      let minT = null;
      minIn.addEventListener("input", () => {
        clearTimeout(minT);
        minT = setTimeout(() => {
          const v = Math.max(0, Math.floor(Number(minIn.value) || 0));
          rv.min = v;
          if (!rv.followers) return setF(true);
          saveRv();
          reqChanged();
        }, 350);
      });
      const sortSel = ui.select(
        [
          { id: "new", label: "Newest" },
          { id: "mutual", label: "Most mutual" },
          { id: "followers", label: "Most followers" },
        ],
        rv.sort,
        (v) => {
          rv.sort = v;
          saveRv();
          reqChanged();
        }
      );
      sortSel.classList.add("fr-sort");
      reqBar.append(h("div", { class: "cer-chips is-wrap fr-filters" }, toggle("Mutual friends", "mutual"), toggle("Verified", "verified"), fChip), sortSel);
    }
    tabSlot.after(reqBar);

    // pending requests: a small dot on the tab (no number pill). The chips
    // re-render on every set(), so the dot is put back each time.
    let reqCount = null;
    const markReq = () => {
      const chip = tabs.children[tabItems.findIndex((t) => t.id === "requests")];
      if (chip && reqCount) chip.append(h("span", { class: "fr-req-dot", title: CER.fmt.full(reqCount) + " requests" }));
    };
    const tabsSet = tabs.set;
    tabs.set = (id) => (tabsSet(id), markReq());
    const setReqCount = (n) => {
      reqCount = n == null ? null : Math.max(0, n);
      tabs.set(tab);
    };
    if (own) api.json(`${FR}/user/friend-requests/count`).then((j) => session.alive && setReqCount(j?.count));

    // ---- state
    const tiles = new Map(); // id -> tile (friends)
    let friends = null; // [{ id, name, displayName }], or null while loading / failed
    let friendsErr = 0; // HTTP status when the friends list failed
    let pres = new Map(); // last known presence of friends
    const lists = {}; // followers / following / requests
    const gridStops = []; // disposers for progressive grids on screen
    const menu = own
      ? [
          { label: "Chat", onClick: (t) => (CER.openChat ? CER.openChat(t.user.id) : CER.toggleChat ? CER.toggleChat() : (location.href = "https://www.roblox.com/my/messages")) },
          { label: "Unfriend", tone: "bad", onClick: (t) => confirmUnfriend(t) },
        ]
      : null;

    let friendsReady = null;
    const loadFriends = () =>
      (friendsReady = (async () => {
        const r = await getJson(`${FR}/users/${userId}/friends`);
        if (!session.alive) return;
        if (!r.data) {
          friendsErr = r.status || -1;
          return;
        }
        friendsErr = 0;
        const list = await fillNames((r.data.data ?? []).map((f) => ({ id: f.id, name: f.name, displayName: f.displayName })));
        pres = await presenceOf(list.map((f) => f.id));
        const games = await gameNames(pres);
        if (!session.alive) return;
        // tiles first, then publish the list (refresh reads both)
        for (const f of list) {
          const t = tiles.get(String(f.id)) ?? personTile(f, { menu });
          t.setPresence(pres.get(String(f.id)), games);
          tiles.set(String(f.id), t);
        }
        friends = list;
      })());
    loadFriends();

    // Refresh presence every 60 s while the tab is visible.
    async function refresh() {
      if (!session.alive) return;
      if (!document.getElementById("cer-app")?.contains(body)) return session.stop();
      if (document.hidden || !friends?.length) return;
      const next = await presenceOf(friends.map((f) => f.id), pres);
      if (!session.alive || !next.size) return;
      pres = next;
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
      let pending = false;
      const m = ui.modal({
        title: "Unfriend " + name + "?",
        actions: [
          { label: "Cancel", variant: "ghost" },
          {
            label: "Unfriend",
            variant: "danger",
            onClick: async (close) => {
              if (pending) return;
              pending = true;
              m.el.querySelectorAll(".cer-modal-actions button").forEach((b) => (b.disabled = true));
              const res = await write(`${FR}/users/${tile.user.id}/unfriend`);
              close();
              if (!res.ok) return CER.toast(failMsg(res, "unfriend"), "error");
              if (friends) friends = friends.filter((f) => String(f.id) !== String(tile.user.id));
              tiles.delete(String(tile.user.id));
              tile.remove();
              if (tab === "friends" && session.alive) render(true); // regroup, or "No friends yet."
            },
          },
        ],
      });
    }

    // ---- views
    const matches = (u) => !query || (u.displayName ?? "").toLowerCase().includes(query) || (u.name ?? "").toLowerCase().includes(query);
    let renderTok = 0;

    // keepScroll: a refresh of what is on screen. Every tile renders at once
    // (they are cached nodes) and the scroll position comes back after.
    async function render(keepScroll) {
      const tok = ++renderTok;
      const y = window.scrollY;
      const stopGrids = () => gridStops.splice(0).forEach((f) => f());
      if (!keepScroll) {
        stopGrids();
        body.replaceChildren(skeletonGrid());
      }
      if (tab === "friends") {
        await friendsReady;
        if (tok !== renderTok || !session.alive) return;
        stopGrids();
        renderFriends(keepScroll);
      } else {
        const ready = await renderList(tab, tok, keepScroll, stopGrids);
        if (!ready) return;
      }
      if (keepScroll && tok === renderTok) window.scrollTo(0, y);
    }
    const fill = (grid, nodes, all) => gridStops.push(fillGrid(grid, nodes, all ? Infinity : 48));
    const retry = (fn) => ui.button("Try again", { variant: "soft", size: "sm", onClick: fn });

    function renderFriends(all) {
      if (!friends) {
        if (isPrivate(friendsErr) && !own) return body.replaceChildren(ui.empty("This list is private.", { icon: "lock" }));
        return body.replaceChildren(
          ui.empty("Could not load. Try again.", {
            icon: "users",
            action: retry(() => {
              loadFriends();
              render();
            }),
          })
        );
      }
      const rank = { ingame: 0, studio: 1, online: 2, offline: 3 };
      const stateOf = (f) => tiles.get(String(f.id))?.state ?? "offline";
      const list = friends.filter(matches).sort((a, b) => rank[stateOf(a)] - rank[stateOf(b)]);
      if (!list.length) return body.replaceChildren(ui.empty(query ? "No one found." : "No friends yet.", { icon: query ? "search" : "users" }));
      const on = list.filter((f) => stateOf(f) !== "offline");
      const off = list.filter((f) => stateOf(f) === "offline");
      // one plain grid while searching; Online / Offline groups otherwise
      const groups = query || !on.length || !off.length ? [[null, list]] : [["Online", on], ["Offline", off]];
      const filled = groups.map(([title, items]) => {
        const grid = newGrid();
        const nodes = items.map((f) => tiles.get(String(f.id))).filter(Boolean);
        if (!title) return [grid, grid, nodes];
        const s = ui.section(title, { class: "fr-group" });
        s.body.append(grid);
        return [s, grid, nodes];
      });
      body.replaceChildren(...filled.map((x) => x[0]));
      for (const [, grid, nodes] of filled) fill(grid, nodes, all); // in the page now, so sentinels can sit after
    }

    // followers / following / requests: cursor pages with "Load more"
    const LIST = {
      followers: (c) => `${FR}/users/${userId}/followers?limit=100&sortOrder=Desc${c ? "&cursor=" + encodeURIComponent(c) : ""}`,
      following: (c) => `${FR}/users/${userId}/followings?limit=100&sortOrder=Desc${c ? "&cursor=" + encodeURIComponent(c) : ""}`,
      requests: (c) => `${FR}/my/friends/requests?limit=50&sortOrder=Desc${c ? "&cursor=" + encodeURIComponent(c) : ""}`,
    };

    // Resolves "ok", "private" or "error".
    async function loadPage(kind) {
      const l = (lists[kind] ??= { items: [], cursor: null, done: false, tiles: new Map(), loading: null });
      if (l.loading) return l.loading;
      if (l.done) return "ok";
      l.loading = (async () => {
        const r = await getJson(LIST[kind](l.cursor));
        const j = r.data;
        if (!j) {
          if (l.items.length) {
            CER.toast("Could not load more. Try again.", "error");
            return "ok";
          }
          return isPrivate(r.status) && kind !== "requests" ? "private" : "error";
        }
        const fresh = (j.data ?? [])
          .map((d) => ({
            id: d.id,
            name: d.name,
            displayName: d.displayName,
            hasVerifiedBadge: d.hasVerifiedBadge,
            // requests only: who you both know, and when it was sent
            mutual: Array.isArray(d.mutualFriendsList) ? d.mutualFriendsList : null,
            sentAt: d.friendRequest?.sentAt ?? null,
          }))
          .filter((u) => !l.tiles.has(String(u.id)));
        await fillNames(fresh);
        // the Verified filter: hasVerifiedBadge in these lists is often stale,
        // so ask the same marks the name badges use (one batched, cached call)
        if (kind === "requests") wantVerified(fresh);
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
        return "ok";
      })();
      try {
        return await l.loading;
      } finally {
        l.loading = null;
      }
    }

    // Every request page, one after another (a sort or filter needs them all).
    // Stops when a page brings nothing new (failed): Load more stays then.
    let allReqP = null;
    const loadAllRequests = () =>
      (allReqP ??= (async () => {
        for (let i = 0; i < 60 && session.alive; i++) {
          const l = lists.requests;
          if (!l || l.done) break;
          const before = l.items.length;
          const st = await loadPage("requests");
          if (st !== "ok" || (lists.requests.items.length === before && !lists.requests.done)) break;
          if (!lists.requests.done) await sleep(250);
        }
      })().finally(() => (allReqP = null)));

    // Returns true when it drew the list (so render may restore scroll).
    async function renderList(kind, tok, all, stopGrids) {
      let state = "ok";
      if (!lists[kind]?.items.length) state = await loadPage(kind);
      if (tok !== renderTok || !session.alive) return false;
      if (kind === "requests" && state === "ok" && reqPicky() && !lists.requests.done) {
        stopGrids();
        body.replaceChildren(h("div", { class: "fr-loading-all" }, ui.icon("clock", 18), h("span", { text: "Loading all requests..." })));
        await loadAllRequests();
        if (tok !== renderTok || !session.alive) return false;
      }
      stopGrids();
      if (state === "private") return body.replaceChildren(ui.empty("This list is private.", { icon: "lock" })), false;
      if (state === "error") return body.replaceChildren(ui.empty("Could not load. Try again.", { icon: "users", action: retry(() => render()) })), false;
      const l = lists[kind];
      let items = l.items.filter(matches);
      const picky = kind === "requests" && (rv.mutual || rv.verified || rv.followers);
      if (kind === "requests") {
        items = requestView(items, l);
        for (const t of l.tiles.values()) t.setSignals?.();
      }
      if (!items.length && (l.done || !query || picky)) {
        if (picky && l.items.length) {
          // filters hid everyone: say so, offer to clear, keep Load more
          const clear = ui.button("Show all", { variant: "soft", size: "sm", onClick: clearReqFilters });
          const waiting = (rv.followers && fcPending()) || (rv.verified && l.items.some((u) => u.vfAsked));
          body.replaceChildren(ui.empty(waiting ? "Checking..." : "No one matches.", { icon: waiting ? "clock" : "filter", action: waiting ? null : clear }));
          if (!l.done) body.append(h("div", { class: "fr-foot" }, loadMoreBtn(kind)));
          return true;
        }
        const msg = query ? "No one found." : kind === "requests" ? "No friend requests." : kind === "followers" ? "No followers yet." : "Not following anyone.";
        body.replaceChildren(ui.empty(msg, { icon: query ? "search" : kind === "requests" ? "userPlus" : "users" }));
        return false;
      }
      const grid = newGrid();
      const foot = h("div", { class: "fr-foot" });
      body.replaceChildren(grid, foot);
      fill(grid, items.map((u) => l.tiles.get(String(u.id))), all);
      if (kind === "requests" && needFollowers() && fcPending()) foot.append(h("span", { class: "fr-note", text: "Checking followers..." }));
      if (!l.done) foot.append(loadMoreBtn(kind));
      return true;
    }

    function loadMoreBtn(kind) {
      const btn = ui.button("Load more", { variant: "soft" });
      btn.addEventListener("click", async () => {
        btn.busy(true);
        const t = renderTok;
        await loadPage(kind);
        if (t === renderTok && tab === kind) render(true);
      });
      return btn;
    }

    // ---- requests: filter + sort, follower counts on demand
    // An unknown follower count is not 0: under "Over X followers" those
    // requests stay (with "Checking...") until the count is known.
    const isVerified = (u) => (u.verified !== undefined ? u.verified : !!u.hasVerifiedBadge);
    function requestView(items, l) {
      if (needFollowers()) for (const u of l.items) wantFollowers(u);
      if (rv.verified) wantVerified(l.items);
      const count = (u) => (typeof u.followers === "number" ? u.followers : -1);
      let out = items.filter((u) => (!rv.mutual || u.mutual?.length) && (!rv.verified || isVerified(u)) && (!rv.followers || typeof u.followers !== "number" || u.followers > rv.min));
      const order = new Map(l.items.map((u, i) => [u, i]));
      if (rv.sort === "mutual") out = [...out].sort((a, b) => (b.mutual?.length ?? 0) - (a.mutual?.length ?? 0) || order.get(a) - order.get(b));
      if (rv.sort === "followers") out = [...out].sort((a, b) => count(b) - count(a) || order.get(a) - order.get(b));
      return out;
    }
    // a count arrived: update its tile, and redraw (batched) when the
    // order or the filter depends on counts
    let redrawT = null;
    const redrawSoon = () => {
      clearTimeout(redrawT);
      redrawT = setTimeout(() => session.alive && tab === "requests" && render(true), fcPending() ? 700 : 60);
    };
    // A failed lookup leaves u.followers undefined and is asked again (after
    // 5 s, then 15 s). After 3 fails the tile offers Try again instead.
    function wantFollowers(u, urgent) {
      if (typeof u.followers === "number" || u.fcAsked || u.fcGaveUp || Date.now() < (u.fcRetryAt ?? 0)) return;
      u.fcAsked = true;
      followersCount(u.id, urgent).then((n) => {
        u.fcAsked = false;
        if (typeof n === "number") u.followers = n;
        else {
          u.fcFails = (u.fcFails ?? 0) + 1;
          u.fcGaveUp = u.fcFails >= 3;
          u.fcRetryAt = Date.now() + (u.fcFails === 1 ? 5000 : 15000);
          if (!u.fcGaveUp && session.alive) setTimeout(() => session.alive && tab === "requests" && needFollowers() && wantFollowers(u), u.fcRetryAt - Date.now() + 50);
        }
        if (!session.alive) return;
        lists.requests?.tiles.get(String(u.id))?.setSignals?.();
        if (tab !== "requests" || !needFollowers()) return;
        redrawSoon();
      });
    }
    // Verified marks for request senders (batched by ui.js). Absent = the
    // lookup failed: left undefined, so the next view asks again.
    function wantVerified(list) {
      if (!api.identity?.user) return;
      const ask = list.filter((u) => u.verified === undefined && !u.vfAsked && Date.now() >= (u.vfRetryAt ?? 0));
      if (!ask.length) return;
      for (const u of ask) u.vfAsked = true;
      api.identity.user.many(ask.map((u) => u.id)).then((m) => {
        let got = 0;
        for (const u of ask) {
          u.vfAsked = false;
          const v = m.get(String(u.id));
          if (v) (u.verified = !!v.verified), got++;
          else u.vfRetryAt = Date.now() + 20000; // busy: not again right away
        }
        if (got && session.alive && tab === "requests" && rv.verified) redrawSoon();
      });
    }
    function reqChanged() {
      if (tab === "requests") render(true);
    }
    function clearReqFilters() {
      rv.mutual = rv.verified = rv.followers = false;
      saveRv();
      reqBar.querySelectorAll(".cer-chip").forEach((c) => (c.classList.remove("is-active"), c.setAttribute("aria-pressed", "false")));
      reqChanged();
    }

    // A just-accepted friend shows up on the Friends tab right away.
    async function addFriend(u) {
      await friendsReady;
      if (!session.alive || !friends || friends.some((f) => String(f.id) === String(u.id))) return;
      const f = { id: u.id, name: u.name, displayName: u.displayName };
      const t = personTile(f, { menu });
      const p = await presenceOf([f.id]);
      if (!session.alive) return;
      if (p.has(String(f.id))) pres.set(String(f.id), p.get(String(f.id)));
      t.setPresence(p.get(String(f.id)), await gameNames(p));
      tiles.set(String(f.id), t);
      friends = [...friends, f];
    }

    // A friend request: Accept (primary) and a quiet Decline.
    function requestTile(u) {
      const t = personTile(u, { noStatus: true });
      t.classList.add("is-request");
      // why you might know them: mutual friends, then how many follow them
      const sig = h("span", { class: "fr-sig" });
      t.setSignals = () => {
        const m = u.mutual?.length ?? 0;
        const f = typeof u.followers === "number" ? u.followers : u.followers === undefined ? followersKnown(u.id) : undefined;
        if (f !== undefined && u.followers === undefined) u.followers = f;
        // count unknown while a followers sort/filter is on: say so (or offer
        // Try again after 3 fails), never show it as 0
        let fol = "";
        if (typeof f === "number") fol = h("span", { class: "fr-sig-followers", title: CER.fmt.full(f), text: CER.fmt.num(f) + (f === 1 ? " follower" : " followers") });
        else if (u.fcGaveUp && needFollowers())
          fol = h("button", {
            type: "button",
            class: "fr-sig-retry",
            text: "Try again",
            onClick: () => {
              u.fcGaveUp = false;
              u.fcFails = 0;
              u.fcRetryAt = 0;
              wantFollowers(u, true);
              t.setSignals();
            },
          });
        else if (needFollowers()) fol = h("span", { class: "fr-sig-wait", text: "Checking..." });
        sig.replaceChildren(m ? h("span", { class: "fr-sig-mutual", title: u.mutual.slice(0, 12).join(", "), text: m + (m === 1 ? " mutual friend" : " mutual friends") }) : "", fol);
      };
      t.setSignals();
      t.querySelector(".fr-link").after(sig);
      ui.whenVisible(t, () => wantFollowers(u, true));
      const accept = ui.button("Accept", { variant: "primary", size: "sm" });
      const decline = ui.button("", { icon: "x", variant: "soft", size: "sm", title: "Decline" });
      const settle = (text, accepted) => {
        t.actions.replaceChildren(h("span", { class: "fr-done", text }));
        t.classList.add("is-done");
        if (reqCount != null) setReqCount(reqCount - 1);
        if (accepted) addFriend(u);
      };
      const act = async (btn, other, verb, done) => {
        btn.busy(true);
        other.disabled = true;
        const res = await write(`${FR}/users/${u.id}/${verb}-friend-request`);
        if (res.ok) return settle(done, verb === "accept");
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
      reqBar.hidden = id !== "requests";
      const want = "#!/" + TAB_HASH[id];
      if (push && location.hash !== want) history.pushState(history.state, "", location.pathname + location.search + want);
      render();
    }
    session.onHash = () => {
      const id = tabFromHash();
      if (id !== tab) go(id, false);
    };
    window.addEventListener("hashchange", session.onHash);

    reqBar.hidden = tab !== "requests";
    render();
  }

  function skeletonGrid() {
    return h(
      "div",
      { class: "fr-grid" },
      Array.from({ length: 14 }, () => h("div", { class: "fr-tile fr-tile-sk" }, h("div", { class: "cer-sk fr-sk-av" }), h("div", { class: "cer-sk cer-sk-line" })))
    );
  }
})();
