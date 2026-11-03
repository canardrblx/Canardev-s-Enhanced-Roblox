// CER inventory page (/users/{id}/inventory). Built on CER.ui (content/ui.js).
// Roblox is only a data source here (inventory v2, catalog bundles, badges,
// game passes, collectibles). Nothing is read from its page DOM.
//
// A shelf of things you own: art first, little text.
//   head    (someone else) their headshot + name, quiet Trade link
//   chips   Accessories · Clothing · Bundles · Faces · Animations · Emotes ·
//           Gear · Limiteds · Badges · Passes · Places · Studio
//   grid    big item art, more pages load as you scroll
//
// Also used by favorites.js: CER.invKit (item tile + lazy pager + stream walk).
// Worth promoting to ui.js as ui.itemTile / ui.pager.

(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;
  const TAG = "inventory";
  const RB = "https://www.roblox.com";

  // ---------------------------------------------------------------- kit
  // Item tile. it: { kind: "asset"|"bundle"|"badge"|"pass"|"place", id, name,
  //   href, thumb (thumb kind), round, value (R$), serial }
  function itemTile(it) {
    const copies = h("span", { class: "inv-item-copies", hidden: true });
    const art = h(
      "div",
      { class: "inv-item-art" },
      ui.thumb(it.thumb, it.thumbId ?? it.id, { alt: "" }),
      it.serial && h("span", { class: "inv-item-serial", text: "#" + fmt.full(it.serial) }),
      copies
    );
    const tile = h(
      "a",
      { class: "inv-item" + (it.round ? " is-round" : ""), href: it.href, title: it.name ?? "" },
      art,
      h("span", { class: "inv-item-name", text: it.name ?? "" }),
      it.value != null && h("span", { class: "inv-item-value" }, ui.icon("robux", 13), h("span", { text: fmt.num(it.value) }))
    );
    tile.setCopies = (n) => {
      copies.textContent = "x" + n;
      copies.hidden = n < 2;
    };
    return tile;
  }

  // Walks a list of paged streams in order, as one long list.
  // stream(cursor) → { items, cursor } | null (failed). Returns next() that
  // gives { items, done } | null, about `min` items per call.
  function walk(streams, min = 30) {
    let i = 0;
    let cursor = "";
    return async () => {
      const out = [];
      while (i < streams.length) {
        let r = await streams[i](cursor);
        // busy (429, catalog often is): two more tries, slower each time
        for (let k = 1; !r && k <= 2; k++) {
          await api.sleep(1500 * k);
          r = await streams[i](cursor);
        }
        if (r?.private) return out.length ? { items: out, done: true } : r;
        if (!r) return out.length ? { items: out, done: false } : null;
        out.push(...r.items);
        if (r.cursor) cursor = r.cursor;
        else (i++, (cursor = ""));
        if (out.length >= min) break;
      }
      return { items: out, done: i >= streams.length };
    };
  }

  // Lazy grid: loads a page, then the next one when the end scrolls near.
  // next() → { items, done } | null. alive() stops work for an old page.
  function pager(host, next, opts = {}) {
    const grid = h("div", { class: "inv-grid" + (opts.cls ? " " + opts.cls : "") });
    const foot = h("div", { class: "inv-foot" });
    host.replaceChildren(grid, foot);
    let busy = false;
    let count = 0;
    const seen = new Map();
    const skel = () => ui.skeleton(opts.skel ?? "tile", opts.first && !count ? opts.first : 6);
    const load = async () => {
      if (busy || !grid.isConnected) return;
      busy = true;
      const sk = [skel()].flat();
      grid.append(...sk);
      const r = await next();
      sk.forEach((s) => s.remove());
      busy = false;
      if (!grid.isConnected || (opts.alive && !opts.alive())) return;
      if (r?.private) return opts.onPrivate ? opts.onPrivate() : host.replaceChildren(ui.empty("This is private.", { icon: "lock" }));
      if (!r) {
        if (!count) return host.replaceChildren(ui.empty(opts.failText ?? "Could not load this.", { icon: "info", action: ui.button("Try again", { variant: "soft", onClick: () => pager(host, next, opts) }) }));
        foot.replaceChildren(ui.button("Load more", { variant: "soft", onClick: load }));
        return;
      }
      let items = r.items;
      if (!opts.render) {
        // copies of one item (limiteds, re-buys) show once, with "x3"
        items = items.filter((it) => {
          const k = it.kind + ":" + it.id;
          const prev = seen.get(k);
          if (!prev) return seen.set(k, it), true;
          prev.copies = (prev.copies ?? 1) + 1;
          prev.tile?.setCopies(prev.copies);
          return false;
        });
      }
      const tiles = (opts.render ? await opts.render(items) : items.map((it) => (it.tile = itemTile(it)))).filter(Boolean);
      if (!grid.isConnected) return;
      grid.append(...tiles);
      count += tiles.length;
      if (r.done) {
        foot.replaceChildren();
        if (!count) host.replaceChildren(ui.empty(opts.emptyText ?? "Nothing here yet.", { icon: opts.emptyIcon ?? "box" }));
        return;
      }
      const sentinel = h("div", { class: "inv-sentinel" });
      foot.replaceChildren(sentinel);
      ui.whenVisible(sentinel, load);
    };
    load();
  }

  // ---------------------------------------------------------------- sources
  // GET that also says WHY it failed: 401/403 here means the owner hid
  // their items (api.json only gives null). OK answers are cached briefly.
  const cache = new Map();
  async function getJ(url, ttl = 120000) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < ttl) return { ok: true, j: hit.j };
    for (let i = 0; i < 3; i++) {
      let r;
      try {
        r = await fetch(url, { credentials: "include" });
      } catch {
        return { ok: false, status: 0 };
      }
      if (r.status === 429 && i < 2) {
        await api.sleep(700 * (i + 1));
        continue;
      }
      const j = await r.json().catch(() => null);
      if (r.ok && j) {
        cache.set(url, { t: Date.now(), j });
        return { ok: true, j };
      }
      return { ok: false, status: r.status, private: r.status === 403 || r.status === 401 };
    }
    return { ok: false, status: 429 };
  }
  const page = async (url, map, ttl = 120000) => {
    const r = await getJ(url, ttl);
    if (r.private) return { private: true };
    const j = r.j;
    return j && Array.isArray(j.data) ? { items: j.data.map(map).filter(Boolean), cursor: j.nextPageCursor ?? "" } : null;
  };
  const q = (c) => (c ? "&cursor=" + encodeURIComponent(c) : "");

  const STUDIO = new Set(["Model", "Decal", "Audio", "MeshPart", "Plugin", "Video", "Animation"]);
  const asset = (a) => ({
    kind: "asset",
    id: a.assetId,
    name: a.name ?? a.assetName,
    thumb: "asset",
    href: a.assetType === "Place" ? `${RB}/games/${a.assetId}` : STUDIO.has(a.assetType) ? `${RB}/library/${a.assetId}` : `${RB}/catalog/${a.assetId}`,
    serial: a.serialNumber,
  });
  const invTypes = (uid, types) => (c) => page(`https://inventory.roblox.com/v2/users/${uid}/inventory?assetTypes=${types}&limit=50&sortOrder=Desc${q(c)}`, asset);
  const bundle = (b) => ({ kind: "bundle", id: b.id, name: b.name, thumb: "bundle", href: `${RB}/bundles/${b.id}` });
  const bundles = (uid, type) => (c) => page(`https://catalog.roblox.com/v1/users/${uid}/bundles/${type}?limit=50&sortOrder=Desc${q(c)}`, bundle, 300000);
  const badges = (uid) => (c) =>
    page(`https://badges.roblox.com/v1/users/${uid}/badges?limit=50&sortOrder=Desc${q(c)}`, (b) => ({ kind: "badge", id: b.id, name: b.displayName ?? b.name, thumb: "badge", round: true, href: `${RB}/badges/${b.id}` }), 300000);
  const limiteds = (uid) => (c) =>
    page(`https://inventory.roblox.com/v1/users/${uid}/assets/collectibles?limit=50&sortOrder=Desc${q(c)}`, (a) => ({
      ...asset({ assetId: a.assetId, name: a.name }),
      serial: a.serialNumber,
      value: a.recentAveragePrice ?? null,
    }));
  // game passes page by the last id, not a cursor
  const passes = (uid) => async (c) => {
    const r = await getJ(`https://apis.roblox.com/game-passes/v1/users/${uid}/game-passes?count=50${c ? "&exclusiveStartId=" + c : ""}`, 300000);
    if (r.private) return { private: true };
    const j = r.j;
    if (!j || !Array.isArray(j.gamePasses)) return null;
    const list = j.gamePasses;
    return {
      items: list.map((p) => ({ kind: "pass", id: p.gamePassId, name: p.name, thumb: "pass", href: `${RB}/game-pass/${p.gamePassId}` })),
      cursor: list.length >= 50 ? String(list[list.length - 1].gamePassId) : "",
    };
  };

  const ACCESSORIES = "Hat,HairAccessory,FaceAccessory,NeckAccessory,ShoulderAccessory,FrontAccessory,BackAccessory,WaistAccessory";
  const CLOTHING = "TShirt,Shirt,Pants,TShirtAccessory,ShirtAccessory,PantsAccessory,JacketAccessory,SweaterAccessory,ShortsAccessory,DressSkirtAccessory,LeftShoeAccessory,RightShoeAccessory";
  const CATS = [
    { id: "accessories", label: "Accessories", streams: (u) => [invTypes(u, ACCESSORIES)] },
    { id: "clothing", label: "Clothing", streams: (u) => [invTypes(u, CLOTHING)] },
    { id: "bundles", label: "Bundles", streams: (u) => [bundles(u, 1), bundles(u, 3)] },
    { id: "faces", label: "Faces", streams: (u) => [bundles(u, 4), invTypes(u, "Face")] },
    { id: "animations", label: "Animations", streams: (u) => [bundles(u, 2)] },
    { id: "emotes", label: "Emotes", streams: (u) => [invTypes(u, "EmoteAnimation")] },
    { id: "gear", label: "Gear", streams: (u) => [invTypes(u, "Gear")] },
    { id: "limiteds", label: "Limiteds", streams: (u) => [limiteds(u)] },
    { id: "badges", label: "Badges", streams: (u) => [badges(u)], round: true },
    { id: "passes", label: "Passes", streams: (u) => [passes(u)] },
    { id: "places", label: "Places", streams: (u) => [invTypes(u, "Place")] },
    { id: "studio", label: "Studio", streams: (u) => [invTypes(u, [...STUDIO].join(","))] },
  ];

  // Header for someone else's page: their headshot + name (links to profile).
  function personHead(id, user, extra) {
    const url = `${RB}/users/${id}/profile`;
    return h(
      "header",
      { class: "inv-person" },
      h("a", { href: url, class: "inv-person-avatar", title: user?.displayName ?? "" }, ui.avatar(id, { size: 56 })),
      h("div", { class: "inv-person-text" }, ui.nameTag({ type: "user", id, name: user?.displayName ?? user?.name ?? "", sub: user?.name ? "@" + user.name : null, verified: user?.hasVerifiedBadge, size: "lg", href: url })),
      extra && h("div", { class: "inv-person-tools" }, extra)
    );
  }

  CER.invKit = { itemTile, walk, pager, personHead, page, q };

  ui.route(TAG, start);

  let runId = 0;

  // ---------------------------------------------------------------- page
  async function start() {
    const id = location.pathname.match(/^\/users\/(\d+)\/inventory/i)?.[1];
    if (!id) return ui.release();
    const run = ++runId;
    const meP = api.me();
    const userP = api.json("https://users.roblox.com/v1/users/" + id, { ttl: 600000 });

    // ---- shell right away
    const { page } = ui.page(TAG, "inv");
    const alive = () => run === runId && page.isConnected;
    const headHost = h("div", { class: "inv-head" }, h("div", { class: "inv-sk-title" }));
    const chipHost = h("div", { class: "inv-chiprow" });
    const body = h("div", { class: "inv-body" }, ui.grid(ui.skeleton("tile", 18), { min: 160, gap: 16 }));
    page.append(headHost, chipHost, body);

    const me = await meP;
    if (!alive()) return;
    if (!me) return ui.release();
    const isSelf = String(me.id) === String(id);
    // hidden items: whole page says so (from can-view, or a 403 on a list)
    let isPrivate = false;
    const showPrivate = () => {
      if (isPrivate || !alive()) return;
      isPrivate = true;
      chipHost.replaceChildren();
      body.replaceChildren(ui.empty("This inventory is private.", { icon: "lock" }));
    };
    if (!isSelf) api.json(`https://inventory.roblox.com/v1/users/${id}/can-view-inventory`, { ttl: 300000 }).then((j) => j?.canView === false && showPrivate());

    if (isSelf) {
      document.title = "Inventory - Roblox";
      headHost.replaceChildren(ui.header({ title: "Inventory" }));
    } else {
      const user = await userP;
      if (!alive()) return;
      document.title = (user?.displayName ?? "Inventory") + " - Roblox";
      const tradeSlot = h("span", { class: "inv-slot" });
      headHost.replaceChildren(personHead(id, user, tradeSlot));
      // quiet Trade link, only when Roblox says a trade is possible
      api.json(`https://trades.roblox.com/v1/users/${id}/can-trade-with`, { ttl: 300000 }).then((j) => {
        if (j?.canTrade && alive()) tradeSlot.append(ui.button("Trade", { icon: "box", variant: "soft", href: ui.nativeUrl(`${RB}/users/${id}/trade`) }));
      });
    }

    if (isPrivate) return;

    // ---- chips + grid
    const fromHash = location.hash.toLowerCase().match(/^#!?\/?([a-z-]+)/)?.[1];
    let active = CATS.find((c) => c.id === fromHash)?.id ?? "accessories";
    const show = (cat) => {
      active = cat;
      try {
        history.replaceState(history.state, "", location.pathname + location.search + "#!/" + cat);
      } catch {
        /* sandboxed */
      }
      const c = CATS.find((x) => x.id === cat);
      const host = h("div", { class: "inv-panel" });
      body.replaceChildren(host);
      pager(host, walk(c.streams(id)), {
        alive,
        first: 18,
        failText: "Could not load these items.",
        onPrivate: showPrivate,
      });
    };
    const chips = ui.chips(CATS, active, show);
    chips.classList.add("inv-chips");
    chipHost.replaceChildren(chips);
    show(active);
  }
})();
