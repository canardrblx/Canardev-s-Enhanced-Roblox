// CER favorites page (/users/{id}/favorites). Built on CER.ui (content/ui.js)
// and the item kit from pages/inventory.js (CER.invKit: tile, pager, walk).
// Data only from Roblox's APIs (games v2 favorites, catalog favorites).
//
//   head    (someone else) their headshot + name
//   tabs    Games · Items
//   Games   big game cards with Play, more load as you scroll
//   Items   chips by category, big item art grid

(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api } = CER;
  const h = ui.h;
  const TAG = "favorites";
  const RB = "https://www.roblox.com";

  ui.route(TAG, start);
  let runId = 0;

  // ---------------------------------------------------------------- sources
  const q = (c) => (c ? "&cursor=" + encodeURIComponent(c) : "");
  const STUDIO_TYPES = new Set([10, 13, 3, 40, 38, 62, 24]);
  const assetsOf = (uid, type) => async (c) => {
    const j = await api.json(`https://catalog.roblox.com/v1/favorites/users/${uid}/favorites/${type}/assets?limit=50${q(c)}`, { ttl: 120000 });
    if (!j || !Array.isArray(j.data)) return null;
    return {
      items: j.data.map((a) => ({
        kind: "asset",
        id: a.id,
        name: a.name,
        thumb: "asset",
        href: STUDIO_TYPES.has(type) ? `${RB}/library/${a.id}` : `${RB}/catalog/${a.id}`,
      })),
      cursor: j.nextPageCursor ?? "",
    };
  };
  const bundlesOf = (uid, type) => async (c) => {
    const j = await api.json(`https://catalog.roblox.com/v1/favorites/users/${uid}/favorites/${type}/bundles?itemsPerPage=50${q(c)}`, { ttl: 120000 });
    if (!j || !Array.isArray(j.favorites)) return null;
    return {
      items: j.favorites
        .map((f) => {
          const b = f.bundle ?? f;
          return b?.id ? { kind: "bundle", id: b.id, name: b.name, thumb: "bundle", href: `${RB}/bundles/${b.id}` } : null;
        })
        .filter(Boolean),
      cursor: j.moreFavorites && j.nextCursor ? j.nextCursor : "",
    };
  };
  const types = (uid, list) => list.map((t) => assetsOf(uid, t));
  const CATS = [
    { id: "accessories", label: "Accessories", streams: (u) => types(u, [8, 41, 42, 43, 44, 45, 46, 47]) },
    { id: "clothing", label: "Clothing", streams: (u) => types(u, [11, 12, 2, 64, 65, 66, 67, 68, 69, 72, 70, 71]) },
    { id: "bundles", label: "Bundles", streams: (u) => [bundlesOf(u, 1), bundlesOf(u, 3)] },
    { id: "faces", label: "Faces", streams: (u) => [bundlesOf(u, 4), assetsOf(u, 18)] },
    { id: "animations", label: "Animations", streams: (u) => [bundlesOf(u, 2)] },
    { id: "emotes", label: "Emotes", streams: (u) => [assetsOf(u, 61)] },
    { id: "gear", label: "Gear", streams: (u) => [assetsOf(u, 19)] },
    { id: "studio", label: "Studio", streams: (u) => types(u, [...STUDIO_TYPES]) },
  ];

  // ---------------------------------------------------------------- page
  async function start() {
    const id = location.pathname.match(/^\/users\/(\d+)\/favorites/i)?.[1];
    const kit = CER.invKit;
    if (!id || !kit) return ui.release();
    const run = ++runId;
    const meP = api.me();
    const userP = api.json("https://users.roblox.com/v1/users/" + id, { ttl: 600000 });

    // ---- shell right away
    const { page } = ui.page(TAG, "fav");
    const alive = () => run === runId && page.isConnected;
    const headHost = h("div", { class: "fav-head" }, h("div", { class: "inv-sk-title" }));
    const tabHost = h("div", { class: "fav-tabbar" });
    const body = h("div", { class: "fav-body" }, ui.grid(ui.skeleton("card", 8), { min: 280, gap: 20 }));
    page.append(headHost, tabHost, body);

    const me = await meP;
    if (!alive()) return;
    if (!me) {
      // only a real 401/403 means signed out; anything else is a hiccup
      if (CER.loggedOut) return ui.release();
      headHost.replaceChildren();
      tabHost.replaceChildren();
      body.replaceChildren(ui.empty("Could not load. Try again.", { icon: "refresh", action: ui.button("Try again", { variant: "soft", icon: "refresh", onClick: () => start() }) }));
      return;
    }
    const isSelf = String(me.id) === String(id);
    if (isSelf) {
      document.title = "Favorites - Roblox";
      headHost.replaceChildren(ui.header({ title: "Favorites" }));
    } else {
      const user = await userP;
      if (!alive()) return;
      document.title = (user?.displayName ?? "Favorites") + " - Roblox";
      headHost.replaceChildren(kit.personHead(id, user));
    }

    // ---- tabs (each panel built on first open)
    const panels = {};
    const builders = { games: gamesPanel, items: itemsPanel };
    const show = (tab) => {
      if (!builders[tab]) tab = "games";
      tabs.set(tab);
      for (const k in panels) panels[k].hidden = k !== tab;
      if (!panels[tab]) {
        panels[tab] = h("div", { class: "fav-panel" });
        body.appendChild(panels[tab]);
        builders[tab](panels[tab]);
      }
      try {
        history.replaceState(history.state, "", location.pathname + location.search + "#!/" + tab);
      } catch {
        /* sandboxed */
      }
    };
    const tabs = ui.tabs(
      [
        { id: "games", label: "Games" },
        { id: "items", label: "Items" },
      ],
      "games",
      show
    );
    tabHost.appendChild(tabs);
    body.replaceChildren();
    show(/items/i.test(location.hash) ? "items" : "games");

    function gamesPanel(panel) {
      let cursor = "";
      const next = async () => {
        let j = await api.json(`https://games.roblox.com/v2/users/${id}/favorite/games?limit=50&sortOrder=Desc${q(cursor)}`, { ttl: 120000 });
        if (!j) {
          await api.sleep(1500);
          j = await api.json(`https://games.roblox.com/v2/users/${id}/favorite/games?limit=50&sortOrder=Desc${q(cursor)}`, { ttl: 120000 });
        }
        if (!j || !Array.isArray(j.data)) return null;
        cursor = j.nextPageCursor ?? "";
        return { items: j.data.map((g) => ({ universeId: g.id, placeId: g.rootPlace?.id, name: g.name })), done: !cursor };
      };
      kit.pager(panel, next, {
        alive,
        cls: "fav-games",
        skel: "card",
        first: 8,
        emptyText: "No favorite games yet.",
        emptyIcon: "gamepad",
        failText: "Could not load games.",
        render: async (games) => {
          await ui.hydrateGames(games);
          return games.map((g) => ui.gameCard(g, { size: "lg" }));
        },
      });
    }

    function itemsPanel(panel) {
      const grid = h("div", { class: "fav-items" });
      const chips = ui.chips(CATS, "accessories", (cat) => load(cat));
      chips.classList.add("fav-chips");
      panel.append(chips, grid);
      const load = (cat) => {
        const c = CATS.find((x) => x.id === cat);
        const host = h("div", { class: "fav-cat" });
        grid.replaceChildren(host);
        kit.pager(host, kit.walk(c.streams(id), 24), { alive, first: 12, emptyText: "No favorites here yet.", emptyIcon: "heart", failText: "Could not load these items." });
      };
      load("accessories");
    }
  }
})();
