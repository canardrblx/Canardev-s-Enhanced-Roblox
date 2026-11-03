// CER home page. Built on CER.ui (content/ui.js). TEMP smoke test.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api } = CER;
  const h = ui.h;
  ui.route("home", async () => {
    const me = await api.me();
    if (!me) return ui.release();
    const { page } = ui.page("home");
    const games = await ui.hydrateGames(["82958998841721", "142823291", "606849621", "537413528", "6872265039"].map((placeId) => ({ placeId })));
    const top = games[0];
    page.append(
      ui.hero({ eyebrow: "Featured", eyebrowIcon: "sparkle", title: top.name, stats: [{ icon: "users", label: ui.fmt?.num?.(top.playing) ?? CER.fmt.num(top.playing) + " playing" }, { icon: "like", label: top.rating + "%" }], image: api.thumb("gameThumb", top.universeId), art: ui.thumb("gameThumb", top.universeId), actions: [ui.button("Play", { icon: "play", variant: "light", size: "lg", onClick: () => ui.play(top.placeId) })] }),
      ui.chips([{ id: "all", label: "All" }, { id: "obby", label: "Obby" }], "all", () => {}),
      (() => { const s = ui.section("Top games", { icon: "trophy", action: { href: "/charts" } }); s.body.append(ui.rail(games.map((g, i) => ui.gameCard(g, { rank: i + 1 })))); return s; })()
    );
    const friends = (await api.friends(me.id)).slice(0, 12);
    const pres = await api.presence(friends.map((f) => f.id));
    const s = ui.section("Friends", { icon: "users", count: friends.length });
    s.body.append(ui.rail(friends.map((f) => ui.userTile(f, { presence: pres.get(String(f.id)) })), { item: 100 }));
    page.append(s);
  });
})();
