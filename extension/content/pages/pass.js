// CER game pass page (/game-pass/{id}/{slug}). Built on CER.ui (content/ui.js).
// A store item screen, art first: the pass, big, over its own blurred
// colors, with its price and one Buy button. Buy opens Roblox's own page
// (ui.nativeUrl), because Roblox runs every purchase; CER never buys.
// Play for the pass's game sits in the hero too. Under it: its other passes.
// Data from the game-passes / inventory / games APIs only.

(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;

  // same URL as the game page's Store tab: shared cache
  const passesUrl = (U, token = "") => `https://apis.roblox.com/game-passes/v1/universes/${U}/game-passes?passView=Full&pageSize=50${token ? "&pageToken=" + encodeURIComponent(token) : ""}`;
  const robux = (n, cls = "") => h("span", { class: "px-robux " + cls }, ui.icon("robux", 18), h("span", { text: fmt.full(n) }));

  // every pass of a universe (a few pages at most), or null when it failed.
  // A failure is not kept: the next ask tries again.
  const passLists = new Map();
  function allPasses(U) {
    if (!passLists.has(U))
      passLists.set(
        U,
        (async () => {
          const out = [];
          let token = "";
          for (let page = 0; page < 4; page++) {
            const j = await api.json(passesUrl(U, token), { ttl: 120000 });
            if (!j?.gamePasses) return page ? out : null;
            out.push(...j.gamePasses);
            token = j.nextPageToken;
            if (!token) break;
          }
          return out;
        })().then((r) => {
          if (!r) passLists.delete(U);
          return r;
        })
      );
    return passLists.get(U);
  }

  // pass id -> universe id it belongs to (0 = looked, not found). Kept in
  // localStorage, one small map, so a pass is only ever searched for once.
  const MAP_KEY = "cer:passGames";
  const NOT_FOUND_FOR = 6 * 3600e3; // look again after 6 h
  const readMap = () => {
    try {
      return JSON.parse(localStorage.getItem(MAP_KEY) ?? "{}") || {};
    } catch {
      return {};
    }
  };
  const writeMap = (passId, U) => {
    try {
      const m = readMap();
      m[passId] = { U: U ? String(U) : 0, t: Date.now() };
      const keys = Object.keys(m);
      if (keys.length > 300) keys.sort((a, b) => m[a].t - m[b].t).slice(0, keys.length - 300).forEach((k) => delete m[k]);
      localStorage.setItem(MAP_KEY, JSON.stringify(m));
    } catch {
      /* storage off */
    }
  };

  // Which game a pass is for. No API answers that directly, so: the game
  // you came from first, then the maker's public games (most visited first),
  // two at a time, 8 at most. A failed request stops the search (and is not
  // remembered), so a busy API does not turn into 16 more requests.
  async function findGame(passId, creator, live) {
    const hit = readMap()[passId];
    if (hit?.U) return { U: hit.U, list: await allPasses(hit.U) };
    if (hit && hit.U === 0 && Date.now() - hit.t < NOT_FOUND_FOR) return null;
    const has = (list) => list?.some((p) => String(p.id) === String(passId));
    const fromPlace = document.referrer.match(/roblox\.com\/games\/(\d+)/i)?.[1];
    if (fromPlace) {
      const U = await api.universeOf(fromPlace);
      if (U) {
        const list = await allPasses(String(U));
        if (has(list)) return writeMap(passId, U), { U: String(U), list };
      }
    }
    if (!creator?.id || !live()) return null;
    const url = creator.type === "Group" ? `https://games.roblox.com/v2/groups/${creator.id}/gamesV2?accessFilter=Public&limit=50&sortOrder=Desc` : `https://games.roblox.com/v2/users/${creator.id}/games?accessFilter=Public&limit=50&sortOrder=Desc`;
    const res = await api.json(url, { ttl: 600000 });
    if (!res?.data) return null; // failed: try again next visit
    const games = res.data
      .filter((g) => String(g.id) !== String(fromPlace ?? ""))
      .sort((a, b) => (b.placeVisits ?? 0) - (a.placeVisits ?? 0))
      .slice(0, 8);
    for (let i = 0; i < games.length && live(); i += 2) {
      const pair = games.slice(i, i + 2);
      const lists = await Promise.all(pair.map((g) => allPasses(String(g.id))));
      const at = lists.findIndex(has);
      if (at >= 0) {
        writeMap(passId, pair[at].id);
        return { U: String(pair[at].id), list: lists[at] };
      }
      if (lists.some((l) => l == null)) return null; // busy: stop, nothing remembered
    }
    if (live()) writeMap(passId, 0);
    return null;
  }

  // Roblox descriptions often carry "=== LIMITED TIME! ===" banner marks
  const cleanDesc = (d) =>
    String(d ?? "")
      .replace(/[=~*]{3,}|-{4,}/g, " ")
      .split("\n")
      .map((l) => l.replace(/[ \t]{2,}/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  // big art: the pass's image asset at 420 (pass thumbnails only come in 150)
  async function bigArt(info, id) {
    const iconId = info.IconImageAssetId;
    return (iconId && (await api.thumb("asset", iconId))) || (await api.thumb("pass", id));
  }

  let runId = 0;
  ui.route("pass", start);
  async function start() {
    const my = ++runId;
    const live = () => my === runId;
    const id = location.pathname.match(/^\/game-pass\/(\d+)/i)?.[1];
    if (!id) return ui.release();

    const { page } = ui.page("pass", "px");
    const view = buildHero();
    const moreHost = h("div", { class: "px-more-host" });
    page.append(view.el, moreHost);

    const mePromise = api.me().catch(() => null);
    const feats = (await CER.get()).features ?? {};
    const info = await api.json(`https://apis.roblox.com/game-passes/v1/game-passes/${id}/product-info`, { ttl: 60000 });
    if (!live()) return;
    if (!info?.TargetId) {
      view.fail("This pass did not load.", () => start().catch(() => ui.release()));
      moreHost.remove();
      return;
    }
    const c = info.Creator ?? {};
    const creator = { id: c.CreatorTargetId ?? c.Id, name: c.Name, type: c.CreatorType === "Group" ? "Group" : "User", verified: c.HasVerifiedBadge };
    view.fill(info, creator);
    bigArt(info, id).then((url) => live() && view.setArt(url));

    // owned (one inventory check)
    mePromise.then(async (me) => {
      if (!me || !live()) return;
      const has = await api.json(`https://inventory.roblox.com/v1/users/${me.id}/items/GamePass/${id}/is-owned`);
      if (live() && typeof has === "boolean") view.setOwned(has);
    });

    // the game (its name + Play go in the hero) and its other passes
    const found = await findGame(id, creator, live);
    if (!live()) return;
    if (!found) return moreHost.remove();
    const gameP = api.game(found.U);
    gameP.then((g) => live() && g && view.setGame(g, feats));
    const mine = found.list?.find((p) => String(p.id) === id);
    if (mine?.isOwned) view.setOwned(true);

    ui.whenVisible(moreHost, async () => {
      const g = await gameP;
      if (!live()) return;
      // things you can buy first, then owned, then off sale
      const rank = (p) => (p.isOwned ? 1 : p.isForSale !== false && p.price != null ? 0 : 2);
      const others = (found.list ?? []).filter((p) => String(p.id) !== id).sort((a, b) => rank(a) - rank(b));
      if (!others.length) return moreHost.remove();
      const placeId = g?.rootPlaceId;
      const sec = ui.section("More passes from this game", { action: placeId && { label: "See all", href: `https://www.roblox.com/games/${placeId}#!/store` } });
      sec.body.append(ui.rail(others.map(passTile), { item: 170 }));
      moreHost.replaceChildren(sec);
    });
  }

  // ------------------------------------------------------------ hero
  // Short: art left; game + maker, title, price or status and the buttons
  // right. Play sits next to Buy, so there is no second game bar.
  function buildHero() {
    const bg = h("div", { class: "px-bg" });
    const art = h("div", { class: "px-art is-loading" });
    const eyebrow = h("div", { class: "px-eyebrow" });
    const gameSlot = h("span", { class: "px-game-slot" });
    const bySlot = h("span", { class: "px-by" });
    eyebrow.append(gameSlot, bySlot);
    const title = h("h1", { class: "px-title" }, h("span", { class: "px-sk px-sk-title" }));
    const desc = h("div", { class: "px-desc" });
    const buy = h("div", { class: "px-buy" }, h("span", { class: "px-sk px-sk-btn" }));
    const body = h("div", { class: "px-body" }, eyebrow, title, buy, desc);
    const el = h("section", { class: "px-hero cer-on-art" }, bg, h("div", { class: "px-shade" }), h("div", { class: "px-inner" }, art, body));
    let state = { owned: null, info: null, placeId: null };

    const paintBuy = () => {
      const i = state.info;
      if (!i) return;
      const price = i.PriceInRobux;
      const base = i.UserBasePriceInRobux;
      const forSale = i.IsForSale !== false && price != null;
      // owned: Play is the one big action; else Buy is, and Play stays quiet
      const play =
        state.placeId &&
        ui.button("Play", { icon: "play", variant: state.owned ? "primary" : "soft", size: "lg", class: "px-play", onClick: () => ui.play(state.placeId) });
      el.classList.toggle("is-owned", !!state.owned);
      if (state.owned) return buy.replaceChildren(h("span", { class: "px-have", text: "You own this" }), play || "");
      if (!forSale) return buy.replaceChildren(h("span", { class: "px-off", text: "Not for sale" }), play || "");
      buy.replaceChildren(
        h(
          "div",
          { class: "px-price" },
          robux(price, "is-big"),
          base != null && base > price && h("s", { class: "px-was", title: "Price without Roblox Plus" }, fmt.full(base))
        ),
        // Roblox's own page runs the purchase (its confirm, its Robux check)
        ui.button("Buy", { icon: "bag", variant: "primary", size: "lg", class: "px-buy-btn", href: ui.nativeUrl(location.href), title: "Buy on Roblox" }),
        play || ""
      );
    };

    return {
      el,
      setArt(url) {
        art.classList.remove("is-loading");
        if (!url) return art.classList.add("is-empty");
        const img = h("img", { src: url, alt: "", draggable: "false", decoding: "async" });
        img.addEventListener("load", () => img.classList.add("is-in"), { once: true });
        art.replaceChildren(img);
        bg.style.backgroundImage = `url("${String(url).replace(/"/g, "")}")`;
        el.classList.add("has-image");
      },
      fill(i, creator) {
        const name = i.Name ?? "";
        title.replaceChildren(name);
        title.title = name;
        const d = cleanDesc(i.Description);
        if (d) desc.replaceChildren(ui.clamp(d, 2));
        const isGroup = creator.type === "Group";
        if (creator.id)
          bySlot.replaceChildren(
            "by ",
            ui.nameTag({
              type: isGroup ? "group" : "user",
              id: creator.id,
              name: creator.name ?? "",
              verified: creator.verified,
              size: "sm",
              href: isGroup ? `https://www.roblox.com/communities/${creator.id}` : `https://www.roblox.com/users/${creator.id}/profile`,
              cls: "px-creator",
            })
          );
        state.info = i;
        paintBuy();
      },
      setGame(g, feats) {
        if (!g?.rootPlaceId) return;
        gameSlot.replaceChildren(h("a", { class: "px-game-link", href: `https://www.roblox.com/games/${g.rootPlaceId}` }, CER.cleanTitle(g.name ?? "", feats)));
        state.placeId = g.rootPlaceId;
        paintBuy();
      },
      setOwned(owned) {
        if (state.owned === true) return; // a yes from any source wins
        state.owned = owned;
        paintBuy();
      },
      fail(text, retry) {
        art.classList.remove("is-loading");
        art.classList.add("is-empty");
        title.replaceChildren(text);
        buy.replaceChildren(
          ui.button("Try again", { icon: "refresh", variant: "primary", size: "lg", onClick: retry }),
          h("a", { class: "px-native-link", href: ui.nativeUrl(location.href), text: "Open on Roblox" })
        );
      },
    };
  }

  // ------------------------------------------------------------ rail tile
  function passTile(p) {
    const forSale = p.isForSale !== false && p.price != null;
    return h(
      "a",
      { class: "px-tile" + (forSale || p.isOwned ? "" : " is-off"), href: `https://www.roblox.com/game-pass/${p.id}`, title: p.displayName ?? p.name },
      h("div", { class: "px-tile-art" }, ui.thumb("pass", p.id, { alt: "" })),
      h("div", { class: "px-tile-name", text: p.displayName ?? p.name }),
      p.isOwned ? h("div", { class: "px-tile-own", text: "Owned" }) : forSale ? robux(p.price, "is-small") : h("div", { class: "px-tile-sub", text: "Not for sale" })
    );
  }
})();
