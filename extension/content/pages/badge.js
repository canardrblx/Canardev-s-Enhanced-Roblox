// CER badge page (/badges/{id}/{slug}). Built on CER.ui (content/ui.js).
// An achievement screen, art first: a short hero with the badge, how rare it
// is, whether you have it and Play (you win badges by playing). Under it the
// game's other badges. Data from the badges / games APIs only.

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

  // Roblox descriptions often carry "=== LIMITED TIME! ===" banner marks
  const cleanDesc = (d) =>
    String(d ?? "")
      .replace(/[=~*]{3,}|-{4,}/g, " ")
      .split("\n")
      .map((l) => l.replace(/[ \t]{2,}/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  let runId = 0;
  ui.route("badge", start);
  async function start() {
    const my = ++runId;
    const live = () => my === runId;
    const id = location.pathname.match(/^\/badges\/(\d+)/i)?.[1];
    if (!id) return ui.release();

    const { page } = ui.page("badge", "bx");
    const view = buildHero();
    const moreHost = h("div", { class: "bx-more-host" });
    page.append(view.el, moreHost);

    const mePromise = api.me().catch(() => null);
    const feats = (await CER.get()).features ?? {};
    const badge = await api.json(`https://badges.roblox.com/v1/badges/${id}`, { ttl: 300000 });
    if (!live()) return;
    if (!badge?.id) {
      view.fail("This badge did not load.", () => start().catch(() => ui.release()));
      moreHost.remove();
      return;
    }
    view.fill(badge, feats);
    bigArt(badge).then((url) => live() && view.setArt(url));

    const U = badge.awardingUniverse?.id ? String(badge.awardingUniverse.id) : null;
    const gameP = U ? api.game(U) : Promise.resolve(null);
    let listP = U ? api.json(badgesUrl(U), { ttl: 300000 }) : Promise.resolve(null);

    // creator = the game's maker
    gameP.then((g) => live() && g?.creator && view.setCreator(g.creator));

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
    const fillMore = async () => {
      const list = (await listP)?.data;
      if (!live()) return;
      if (!list) {
        // failed, not empty: say so and let them ask again
        moreHost.replaceChildren(
          ui.empty("Could not load.", {
            icon: "medal",
            action: ui.button("Try again", {
              variant: "soft",
              onClick: () => {
                listP = api.json(badgesUrl(U), { ttl: 300000 });
                fillMore();
              },
            }),
          })
        );
        return;
      }
      const others = list.filter((b) => String(b.id) !== id && b.enabled !== false);
      if (!others.length) return moreHost.remove();
      const sec = ui.section("More badges from this game", { action: badge.awardingUniverse?.rootPlaceId && { label: "See all", href: `https://www.roblox.com/games/${badge.awardingUniverse.rootPlaceId}#!/badges` } });
      sec.body.append(ui.rail(others.map((b) => badgeTile(b, ownedIds?.has(String(b.id)))), { item: 150 }));
      moreHost.replaceChildren(sec);
    };
    if (U) ui.whenVisible(moreHost, fillMore);
    else moreHost.remove();
  }

  // ------------------------------------------------------------ hero
  // Short: art left; game + maker, title, the one stat (how rare), whether
  // you have it and Play right. No second game bar.
  function buildHero() {
    const bg = h("div", { class: "bx-bg" });
    const art = h("div", { class: "bx-art is-loading" });
    const eyebrow = h("div", { class: "bx-eyebrow" });
    const title = h("h1", { class: "bx-title" }, h("span", { class: "bx-sk bx-sk-title" }));
    const desc = h("div", { class: "bx-desc" });
    const stats = h("div", { class: "bx-stats" }, h("span", { class: "bx-sk bx-sk-line" }));
    const own = h("span", { class: "bx-own" });
    const actions = h("div", { class: "bx-actions" }, own);
    const body = h("div", { class: "bx-body" }, eyebrow, title, stats, actions, desc);
    const el = h("section", { class: "bx-hero cer-on-art" }, bg, h("div", { class: "bx-shade" }), h("div", { class: "bx-inner" }, art, body));

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
      fill(b, feats) {
        const name = b.displayName || b.name || "";
        title.replaceChildren(name);
        title.title = name;
        const d = cleanDesc(b.displayDescription ?? b.description);
        if (d) desc.replaceChildren(ui.clamp(d, 2));
        const g = b.awardingUniverse;
        if (g?.rootPlaceId) {
          eyebrow.replaceChildren(h("a", { class: "bx-game-link", href: `https://www.roblox.com/games/${g.rootPlaceId}` }, CER.cleanTitle(g.name ?? "", feats)));
          // you win badges by playing: Play is the one big action
          actions.prepend(ui.button("Play", { icon: "play", variant: "primary", size: "lg", class: "bx-play", onClick: () => ui.play(g.rootPlaceId) }));
        }

        // one stat: how many players have it
        const s = b.statistics ?? {};
        stats.replaceChildren(
          s.winRatePercentage != null
            ? h("span", { class: "bx-rare", title: "Players who have it" }, h("b", { text: pctText(s.winRatePercentage, s.awardedCount) }), h("span", { class: "bx-word", text: rarityWord(s.winRatePercentage * 100) }))
            : ""
        );
        if (b.enabled === false) own.replaceChildren(h("span", { class: "bx-off", text: "You can not win this now." }));
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
            ? h("span", { class: "bx-have", title: date === true ? null : new Date(date).toLocaleString(), text: date === true ? "You have it" : "You got it " + fmt.date(date) })
            : h("span", { class: "bx-not", text: "You do not have it yet" })
        );
      },
      fail(text, retry) {
        art.classList.remove("is-loading");
        art.classList.add("is-empty");
        title.replaceChildren(text);
        stats.replaceChildren();
        actions.replaceChildren(
          ui.button("Try again", { icon: "refresh", variant: "primary", size: "lg", onClick: retry }),
          h("a", { class: "bx-native-link", href: ui.nativeUrl(location.href), text: "Open on Roblox" })
        );
      },
    };
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
