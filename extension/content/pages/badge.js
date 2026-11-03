// CER badge page (/badges/{id}/{slug}). Built on CER.ui (content/ui.js).
// An achievement screen, art first: the badge, big, over its own blurred
// colors, with how rare it is and whether you have it. Under it the game it
// comes from (Play is the one big action: you win badges by playing), then
// the game's other badges. Data from the badges / games APIs only.

(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;

  // Roblox's own rarity words, by the share of players who have it
  const RARITY = [
    [90, "Freebie"],
    [80, "Cakewalk"],
    [50, "Easy"],
    [30, "Moderate"],
    [20, "Challenging"],
    [10, "Hard"],
    [5, "Extreme"],
    [1, "Insane"],
    [0, "Impossible"],
  ];
  const rarityWord = (pct) => RARITY.find(([min]) => pct >= min)?.[1] ?? "";
  // winRatePercentage is a fraction (0.002 = 0.2%)
  // won > 0 but rounds to 0: "<0.1%", never a plain 0%
  const pctText = (r, won) => {
    if (r == null) return "";
    const p = r * 100;
    if (p < 0.1 && (p > 0 || won > 0)) return "<0.1%";
    return (p < 10 ? p.toFixed(1).replace(/\.0$/, "") : Math.round(p)) + "%";
  };
  const badgesUrl = (U) => `https://badges.roblox.com/v1/universes/${U}/badges?limit=50&sortOrder=Asc`; // same URL as the game page: shared cache

  // big art: the badge's image asset at 420 (badge icons only come in 150)
  async function bigArt(badge) {
    const iconId = badge.displayIconImageId ?? badge.iconImageId;
    return (iconId && (await api.thumb("asset", iconId))) || (await api.thumb("badge", badge.id));
  }

  let runId = 0;
  ui.route("badge", async () => {
    const my = ++runId;
    const live = () => my === runId;
    const id = location.pathname.match(/^\/badges\/(\d+)/i)?.[1];
    if (!id) return ui.release();

    const { page } = ui.page("badge", "bx");
    const view = buildHero();
    const gameHost = h("div", { class: "bx-game" }, h("div", { class: "bx-game-sk" }));
    const moreHost = h("div", { class: "bx-more-host" });
    page.append(view.el, gameHost, moreHost);

    const mePromise = api.me().catch(() => null);
    const feats = (await CER.get()).features ?? {};
    const badge = await api.json(`https://badges.roblox.com/v1/badges/${id}`, { ttl: 300000 });
    if (!live()) return;
    if (!badge?.id) {
      view.fail("We could not find this badge.");
      gameHost.remove();
      return;
    }
    view.fill(badge);
    bigArt(badge).then((url) => live() && view.setArt(url));

    const U = badge.awardingUniverse?.id ? String(badge.awardingUniverse.id) : null;
    const gameP = U ? api.game(U) : Promise.resolve(null);
    const listP = U ? api.json(badgesUrl(U), { ttl: 300000 }) : Promise.resolve(null);

    // creator = the game's maker
    gameP.then((g) => live() && g?.creator && view.setCreator(g.creator));

    // game strip with the one Play
    if (U) buildGame(gameHost, badge, gameP, feats);
    else gameHost.remove();

    let ownedIds = null;
    // owned: a quick yes/no from inventory, plus one awarded-dates call (the
    // date, and the rail's badges too). awarded-dates has a tight per-account
    // limit: when it says no, one quiet retry follows a bit later.
    (async () => {
      const me = await mePromise;
      if (!live() || !me) return;
      let dated = false;
      api.json(`https://inventory.roblox.com/v1/users/${me.id}/items/Badge/${id}/is-owned`).then((has) => {
        if (live() && !dated && typeof has === "boolean") view.setOwned(has);
      });
      const list = (await listP)?.data ?? [];
      const ids = [id, ...list.map((b) => String(b.id)).filter((x) => x !== id)].slice(0, 50);
      const url = `https://badges.roblox.com/v1/users/${me.id}/badges/awarded-dates?badgeIds=${ids.join(",")}`;
      const apply = (own) => {
        dated = true;
        const got = new Map((own?.data ?? []).map((o) => [String(o.badgeId), o.awardedDate]));
        view.setOwned(got.get(id) ?? false);
        for (const [bid] of got) moreHost.querySelector(`[data-badge="${bid}"]`)?.classList.add("is-owned");
        ownedIds = got;
      };
      let own = await api.json(url);
      if (!live()) return;
      if (own) return apply(own);
      await api.sleep(6000);
      if (!live()) return;
      own = await api.json(url);
      if (live() && own) apply(own);
    })();

    // more badges from this game, when it scrolls near
    if (U)
      ui.whenVisible(moreHost, async () => {
        const list = (await listP)?.data;
        if (!live()) return;
        const others = (list ?? []).filter((b) => String(b.id) !== id && b.enabled !== false);
        if (!others.length) return moreHost.remove();
        const sec = ui.section("More badges from this game", { action: badge.awardingUniverse?.rootPlaceId && { label: "See all", href: `https://www.roblox.com/games/${badge.awardingUniverse.rootPlaceId}#!/badges` } });
        sec.body.append(ui.rail(others.map((b) => badgeTile(b, ownedIds?.has(String(b.id)))), { item: 150 }));
        moreHost.replaceChildren(sec);
      });
  });

  // ------------------------------------------------------------ hero
  function buildHero() {
    const bg = h("div", { class: "bx-bg" });
    const art = h("div", { class: "bx-art is-loading" });
    const eyebrow = h("div", { class: "bx-eyebrow" });
    const title = h("h1", { class: "bx-title" }, h("span", { class: "bx-sk bx-sk-title" }));
    const desc = h("div", { class: "bx-desc" });
    const stats = h("div", { class: "bx-stats" }, h("span", { class: "bx-sk bx-sk-line" }));
    const own = h("div", { class: "bx-own" });
    const body = h("div", { class: "bx-body" }, eyebrow, title, desc, stats, own);
    const el = h("section", { class: "bx-hero" }, bg, h("div", { class: "bx-shade" }), h("div", { class: "bx-inner" }, art, body));

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
      fill(b) {
        const name = b.displayName || b.name || "";
        title.replaceChildren(name);
        title.title = name;
        const d = (b.displayDescription ?? b.description ?? "").trim();
        if (d) desc.replaceChildren(ui.clamp(d, 3));
        const g = b.awardingUniverse;
        if (g?.rootPlaceId) eyebrow.replaceChildren(h("a", { class: "bx-game-link", href: `https://www.roblox.com/games/${g.rootPlaceId}` }, CER.cleanTitle(g.name ?? "", CER._featsCache ?? {})));

        const s = b.statistics ?? {};
        const bits = [];
        if (s.winRatePercentage != null) {
          const p = s.winRatePercentage * 100;
          bits.push(h("span", { class: "bx-rare", title: "Players who have it" }, h("b", { text: pctText(s.winRatePercentage, s.awardedCount) }), h("span", { class: "bx-word", text: rarityWord(p) })));
        }
        if (s.pastDayAwardedCount != null) bits.push(h("span", { title: fmt.full(s.pastDayAwardedCount) }, h("b", { text: fmt.num(s.pastDayAwardedCount) }), " won yesterday"));
        if (s.awardedCount != null) bits.push(h("span", { title: fmt.full(s.awardedCount) }, h("b", { text: fmt.num(s.awardedCount) }), " won ever"));
        stats.replaceChildren(...bits);
        if (b.enabled === false) own.replaceChildren(h("span", { class: "bx-off" }, ui.icon("lock", 16), "You can not win this now."));
      },
      setCreator(c) {
        const isGroup = c.type === "Group";
        const tag = ui.nameTag({
          type: isGroup ? "group" : "user",
          id: c.id,
          name: c.name ?? "",
          verified: c.hasVerifiedBadge,
          size: "sm",
          href: isGroup ? `https://www.roblox.com/communities/${c.id}` : `https://www.roblox.com/users/${c.id}/profile`,
          cls: "bx-creator",
        });
        eyebrow.append(h("span", { class: "bx-by" }, "by ", tag));
      },
      // date string or true = you have it, false = not yet, null = unknown
      setOwned(date) {
        if (date == null || own.querySelector(".bx-off")) return;
        el.classList.toggle("is-owned", !!date);
        own.replaceChildren(
          date
            ? h("span", { class: "bx-have", title: date === true ? null : new Date(date).toLocaleString() }, ui.icon("check", 17), h("span", { text: date === true ? "You have it" : "You got it " + fmt.date(date) }))
            : h("span", { class: "bx-not" }, "You do not have it yet")
        );
      },
      fail(text) {
        art.classList.remove("is-loading");
        art.classList.add("is-empty");
        title.replaceChildren(text);
        stats.replaceChildren();
      },
    };
  }

  // ------------------------------------------------------------ game strip
  async function buildGame(host, badge, gameP, feats) {
    const u = badge.awardingUniverse;
    const placeId = u.rootPlaceId;
    const name = CER.cleanTitle(u.name ?? "", feats);
    const meta = h("div", { class: "bx-game-meta" });
    const play = ui.button("Play", { icon: "play", variant: "primary", size: "lg", class: "bx-play", onClick: (e) => (e.preventDefault(), ui.play(placeId)) });
    const strip = h(
      "a",
      { class: "bx-game-card", href: `https://www.roblox.com/games/${placeId}`, title: u.name ?? "" },
      h("div", { class: "bx-game-art" }, ui.thumb("gameThumb", u.id, { alt: "" })),
      h("div", { class: "bx-game-text" }, h("div", { class: "bx-game-name", text: name }), meta),
      play
    );
    host.replaceChildren(strip);
    const g = await gameP;
    if (!g) return;
    meta.replaceChildren(
      h("span", { class: "bx-live" }, h("i", { class: "bx-dot" }), h("b", { text: fmt.full(g.playing ?? 0) }), " playing"),
      g.rating != null && h("span", {}, ui.icon("like", 14), h("b", { text: g.rating + "%" }))
    );
  }

  // ------------------------------------------------------------ rail tile
  function badgeTile(b, owned) {
    const r = b.statistics?.winRatePercentage;
    return h(
      "a",
      { class: "bx-tile" + (owned ? " is-owned" : ""), href: `https://www.roblox.com/badges/${b.id}`, "data-badge": b.id, title: b.displayName ?? b.name },
      h("div", { class: "bx-tile-art" }, ui.thumb("badge", b.id, { alt: "" }), h("span", { class: "bx-tile-check", title: "You have it" }, ui.icon("check", 14))),
      h("div", { class: "bx-tile-name", text: b.displayName ?? b.name }),
      r != null && h("div", { class: "bx-tile-sub", text: pctText(r, b.statistics?.awardedCount) })
    );
  }
})();
