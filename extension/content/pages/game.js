// CER game page (/games/{placeId}/...). Built on CER.ui (content/ui.js).
// A game-launcher page, art first: the game's own pictures fill a big stage
// with the title, one huge Play button and a few quiet icon buttons on top.
// Under it: a short description, then Servers / Store / Badges / More.
// Roblox is used for DATA (web APIs) and ACTIONS (its launcher, its purchase
// pages) only. Replaces gameredesign.js, serverbrowser.js and the Roblox-page
// parts of gamepage.js on pages we own.

(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;

  // things the previous page left running (gallery timer, observers)
  const cleanups = [];
  const onCleanup = (fn) => cleanups.push(fn);
  const runCleanups = () => {
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch {
        /* keep going */
      }
    }
  };

  // Tab id <-> the hash Roblox uses (shared links like #!/game-instances keep working)
  const TAB_HASH = { servers: "game-instances", store: "store", badges: "badges", more: "recommended" };
  const tabFromHash = () => {
    const key = location.hash.replace(/^#!?\/?/, "").toLowerCase();
    for (const [id, hash] of Object.entries(TAB_HASH)) if (hash === key || id === key) return id;
    return "servers";
  };

  // ------------------------------------------------------------ helpers
  // Writes: page fetch (with CSRF) first, background worker when the page's
  // CORS preflight is refused. Resolves true on success.
  async function write(url, method, body, { bgFirst = false } = {}) {
    if (!bgFirst) {
      const r = await CER.robloxWrite(url, method, body ?? {}).catch(() => null);
      if (r) return r.ok;
    }
    const b = await CER.bgFetch(url, method, body ?? {});
    return !!b?.ok;
  }
  const robux = (n) => h("span", { class: "gx-robux" }, ui.icon("robux", 15), h("span", { text: fmt.full(n) }));
  const genreOf = (info) => {
    const g = info?.genre_l1 || (info?.genre && info.genre !== "All" ? info.genre : "");
    return g ? g.replace(/\b\w/g, (c) => c.toUpperCase()) : "";
  };
  const thumbsUrl = (U) => `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${U}&countPerUniverse=25&defaults=true&size=768x432&format=Webp&isCircular=false`;
  // plain bold title, no icon / count / subtitle
  const section = (title, opts = {}) => ui.section(title, { action: opts.action, tools: opts.tools, class: opts.class });

  // ------------------------------------------------------------ pins
  // Same storage key and shape as pages/home.js ("Pinned" rail):
  // [{ universeId: number, placeId, name, at }], newest first, max 40.
  const PIN_KEY = "pinnedGames";
  const MAX_PINS = 40;
  async function readPins() {
    try {
      const o = await CER.ext.storage.local.get(PIN_KEY);
      return Array.isArray(o?.[PIN_KEY]) ? o[PIN_KEY].filter((p) => p?.universeId) : [];
    } catch {
      return [];
    }
  }
  // → true pinned, false unpinned, null nothing changed
  async function togglePin(g) {
    const list = await readPins(); // fresh read: Home may have changed it
    const on = !list.some((p) => String(p.universeId) === String(g.universeId));
    if (on && list.length >= MAX_PINS) {
      CER.toast("Too many pins. Unpin one first.", "error");
      return null;
    }
    const next = on ? [{ universeId: g.universeId, placeId: g.placeId, name: g.name, at: Date.now() }, ...list] : list.filter((p) => String(p.universeId) !== String(g.universeId));
    try {
      await CER.ext.storage.local.set({ [PIN_KEY]: next });
    } catch {
      CER.toast("Could not save. Reload the page.", "error");
      return null;
    }
    return on;
  }

  // Small "more" button with a pop-up list of rarely used tools.
  // items: [{ icon, label, onClick }]
  function moreMenu(items) {
    const btn = ui.button("", { icon: "more", variant: "glass", title: "More", class: "gx-qbtn" });
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    const list = h(
      "div",
      { class: "gx-menu", role: "menu", hidden: true },
      items.map((it) =>
        h("button", { type: "button", class: "gx-menu-item", role: "menuitem", onClick: () => (close(), it.onClick()) }, ui.icon(it.icon, 17), h("span", { text: it.label }))
      )
    );
    const el = h("div", { class: "gx-more" }, btn, list);
    const outside = (e) => !el.contains(e.target) && close();
    const onKey = (e) => e.key === "Escape" && (close(), btn.focus());
    function open() {
      list.hidden = false;
      btn.classList.add("is-open");
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", onKey);
    }
    function close() {
      list.hidden = true;
      btn.classList.remove("is-open");
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", onKey);
    }
    btn.addEventListener("click", () => (list.hidden ? open() : close()));
    onCleanup(close);
    return { el, close };
  }

  // ------------------------------------------------------------ route
  // Each visit gets a run id; work from an older visit (SPA navigation)
  // stops at its next await instead of building into the new page.
  let runId = 0;
  ui.route("game", start);
  async function start() {
    runCleanups();
    const my = ++runId;
    const live = () => my === runId;
    const placeId = location.pathname.match(/^\/games\/(\d+)/i)?.[1];
    if (!placeId) return ui.release();
    // shared private server invite (/games/ID?privateServerLinkCode=...)
    const linkCode = new URLSearchParams(location.search).get("privateServerLinkCode");
    const priv = linkCode && /^[\w-]{1,200}$/.test(linkCode) ? { linkCode } : null;

    const { page } = ui.page("game", "gx");
    const mePromise = api.me().catch(() => null);

    // shell first (shimmer), filled as data lands
    const stage = buildStage(placeId, priv, start);
    const about = h("div", { class: "gx-about" });
    const tabsHost = h("div", { class: "gx-tabbar" });
    const panes = h("div", { class: "gx-panes" });
    page.append(stage.el, about, tabsHost, panes);

    const feats = (await CER.get()).features ?? {};
    if (!live()) return;
    const universeId = await api.universeOf(placeId);
    if (!live()) return;
    if (!universeId) {
      // usually a busy API, not a missing game: Play still works by place id
      stage.fail("This game did not load.");
      return;
    }
    const U = String(universeId);

    const infoP = api.game(U);
    const playP = api.json(`https://games.roblox.com/v1/games/multiget-playability-status?universeIds=${U}`, { ttl: 60000 });
    api.json(thumbsUrl(U), { ttl: 600000 }).then((j) => live() && stage.setGallery(j, U));

    const info = await infoP;
    if (!live()) return;
    if (!info) {
      stage.fail("This game did not load.");
      return;
    }
    const ctx = { placeId, universeId: U, info, feats, mePromise, live };
    stage.fill(info, feats);
    stage.wirePin(U, info);
    playP.then((p) => live() && stage.setPlayability(Array.isArray(p) ? p[0] : null, info));
    mePromise.then((me) => live() && stage.wireSocial(me, U, info));
    friendsHere(ctx).then((list) => live() && stage.setFriends(list));

    // short description, no card, no title
    const desc = (info.description ?? "").trim();
    if (desc) about.append(ui.clamp(desc, 3));
    else about.remove();

    // ---- tabs ----
    const TABS = [
      { id: "servers", label: "Servers" },
      { id: "store", label: "Store" },
      { id: "badges", label: "Badges" },
      { id: "more", label: "More like this" },
    ];
    const builders = { servers: buildServers, store: buildStore, badges: buildBadges, more: buildMore };
    const built = {};
    let active = tabFromHash();
    const show = (id, fromClick) => {
      active = id;
      if (!built[id]) {
        built[id] = h("div", { class: "gx-pane", "data-tab": id });
        panes.append(built[id]);
        try {
          builders[id](built[id], ctx);
        } catch (e) {
          console.warn("[CER] game tab failed", id, e);
          built[id].replaceChildren(ui.empty("This part did not load."));
        }
      }
      for (const [k, el] of Object.entries(built)) el.hidden = k !== id;
      if (fromClick) history.replaceState(history.state, "", location.pathname + location.search + "#!/" + TAB_HASH[id]);
    };
    const tabs = ui.tabs(TABS, active, (id) => show(id, true));
    tabsHost.append(tabs);
    show(active);
    const onHash = () => {
      const id = tabFromHash();
      if (id !== active) {
        tabs.set(id);
        show(id);
      }
    };
    window.addEventListener("hashchange", onHash);
    onCleanup(() => window.removeEventListener("hashchange", onHash));
  }

  // ------------------------------------------------------------ stage (hero)
  // The art is the hero: the game's pictures fill the stage, slowly
  // crossfading. Title, Play and the quiet buttons sit on the art.
  function buildStage(placeId, priv, retry) {
    let uni = null; // universe id, once known (Report needs it)
    const ambient = h("div", { class: "gx-ambient" });
    const slides = h("div", { class: "gx-slides" });
    const strip = h("div", { class: "gx-strip" });
    const prev = h("button", { type: "button", class: "gx-arrow is-prev", "aria-label": "Back" }, ui.icon("left", 22));
    const next = h("button", { type: "button", class: "gx-arrow is-next", "aria-label": "Next" }, ui.icon("right", 22));

    const creator = h("div", { class: "gx-creator" });
    const title = h("h1", { class: "gx-title" }, h("span", { class: "gx-sk gx-sk-title" }));
    const meta = h("div", { class: "gx-meta" }, h("span", { class: "gx-sk gx-sk-line" }));
    const note = h("p", { class: "gx-note", hidden: true });

    // an invite link's Play goes to that private server
    const playBtn = ui.button(priv ? "Join private server" : "Play", { icon: "play", variant: "light", size: "lg", class: "gx-play" });
    playBtn.addEventListener("click", () => (priv ? playPrivate(placeId, priv) : playNow(placeId)));
    const playSlot = h("div", { class: "gx-play-slot" }, playBtn);
    const social = h("div", { class: "gx-quiet" });
    const quiet = (icon, title, onClick) => ui.button("", { icon, variant: "glass", title, class: "gx-qbtn", onClick });
    // Pin to Home: local only (same "pinnedGames" list home.js reads)
    const pinBtn = quiet("pin", "Pin to Home");
    pinBtn.hidden = true;
    // rarely used tools live in one small menu instead of two more circles
    const more = moreMenu([
      { icon: "link", label: "Copy link", onClick: () => ui.copy(`https://www.roblox.com/games/${placeId}`, "Link copied!") },
      { icon: "sliders", label: "Join options", onClick: () => CER.openSettings?.("Join") },
      // Roblox's own report flow, in a new tab
      ui.reportUrl && {
        icon: ui.ICONS?.flag ? "flag" : "shield",
        label: "Report",
        onClick: () => {
          const url = ui.reportUrl("game", placeId);
          if (url) window.open(url, "_blank", "noopener");
        },
      },
    ].filter(Boolean));

    const overlay = h(
      "div",
      { class: "gx-overlay" },
      creator,
      title,
      meta,
      h("div", { class: "gx-actions" }, playSlot, pinBtn, social, more.el),
      note
    );
    const stageEl = h("div", { class: "gx-stage cer-on-art is-loading", tabindex: "0" }, slides, h("div", { class: "gx-shade" }), prev, next, overlay, strip);
    const el = h("section", { class: "gx-hero" }, ambient, stageEl);

    // ---- gallery ----
    let urls = [];
    let idx = 0;
    let timer = null;
    const go = (i, user) => {
      if (!urls.length) return;
      idx = (i + urls.length) % urls.length;
      [...slides.children].forEach((s, k) => s.classList.toggle("is-on", k === idx));
      [...strip.children].forEach((s, k) => s.classList.toggle("is-on", k === idx));
      for (const k of [idx, (idx + 1) % urls.length]) {
        const img = slides.children[k]?.querySelector("img");
        if (img && !img.src) img.src = img.dataset.src; // next one loads early, no blank swap
      }
      ambient.style.backgroundImage = `url("${String(urls[idx]).replace(/"/g, "")}")`;
      if (user) restart();
    };
    const restart = () => {
      clearInterval(timer);
      if (urls.length > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches)
        timer = setInterval(() => {
          if (!el.isConnected) return clearInterval(timer); // page left
          if (!document.hidden && !stageEl.matches(":hover")) go(idx + 1);
        }, 7000);
    };
    prev.addEventListener("click", () => go(idx - 1, true));
    next.addEventListener("click", () => go(idx + 1, true));
    stageEl.addEventListener("keydown", (e) => {
      if (e.target !== stageEl) return;
      if (e.key === "ArrowLeft") go(idx - 1, true);
      if (e.key === "ArrowRight") go(idx + 1, true);
    });
    let sx = null; // swipe on touch screens
    stageEl.addEventListener("pointerdown", (e) => (sx = e.pointerType === "mouse" ? null : e.clientX));
    stageEl.addEventListener("pointerup", (e) => {
      if (sx != null && Math.abs(e.clientX - sx) > 40) go(idx + (e.clientX < sx ? 1 : -1), true);
      sx = null;
    });
    onCleanup(() => clearInterval(timer));

    return {
      el,
      async setGallery(j, U) {
        const pick = (r) => (r?.data?.[0]?.thumbnails ?? []).filter((t) => t.state === "Completed" && t.imageUrl).map((t) => t.imageUrl);
        let list = pick(j);
        if (!list.length && j?.data?.[0]?.thumbnails?.some((t) => t.state === "Pending")) {
          await api.sleep(1500); // fresh upload still rendering: one quiet retry
          list = pick(await api.json(thumbsUrl(U)));
        }
        urls = [...new Set(list)];
        stageEl.classList.remove("is-loading");
        if (!urls.length) return stageEl.classList.add("is-empty");
        slides.replaceChildren(
          ...urls.map((u, i) => {
            const img = h("img", { alt: "", draggable: "false", decoding: "async", "data-src": u });
            img.addEventListener("load", () => img.classList.add("is-in"), { once: true });
            if (i === 0) img.src = u;
            return h("div", { class: "gx-slide" }, img);
          })
        );
        stageEl.classList.toggle("is-single", urls.length < 2);
        if (urls.length > 1)
          strip.replaceChildren(
            ...urls.map((u, i) =>
              h("button", { type: "button", class: "gx-thumb", "aria-label": "Picture " + (i + 1), onClick: () => go(i, true) }, h("img", { src: u, alt: "", loading: "lazy", draggable: "false" }))
            )
          );
        go(0);
        restart();
      },
      fill(info, feats) {
        const c = info.creator ?? {};
        const href = c.type === "Group" ? `https://www.roblox.com/communities/${c.id}` : `https://www.roblox.com/users/${c.id}/profile`;
        creator.replaceChildren(
          c.id
            ? ui.nameTag({ type: c.type === "Group" ? "group" : "user", id: c.id, name: c.name ?? "", verified: !!c.hasVerifiedBadge, size: "sm", href, cls: "gx-creator-link" })
            : h("span", { class: "gx-creator-link", text: c.name ?? "" })
        );
        title.replaceChildren(CER.cleanTitle(info.name ?? "", feats));
        title.title = info.name ?? "";
        // one quiet line of real info: playing, rating, server size, genre
        const bits = [h("span", { class: "gx-live" }, h("i", { class: "gx-dot" }), h("b", { text: fmt.full(info.playing ?? 0) }), " playing")];
        if (info.rating != null) bits.push(h("span", { title: `${fmt.full(info.up)} likes, ${fmt.full(info.down)} dislikes` }, ui.icon("like", 15), h("b", { text: info.rating + "%" })));
        // (server size is on every server card already, so not repeated here)
        const g = genreOf(info);
        if (g) bits.push(h("span", { text: g }));
        meta.replaceChildren(...bits);
      },
      // games API down: Play still works (place id from the URL), plus a
      // retry and Roblox's own page
      fail(text) {
        stageEl.classList.remove("is-loading");
        stageEl.classList.add("is-empty");
        title.replaceChildren(text);
        meta.replaceChildren();
        pinBtn.remove();
        more.el.remove();
        social.replaceChildren(
          ui.button("Try again", { icon: "refresh", variant: "glass", class: "gx-retry", onClick: () => retry?.().catch?.(() => ui.release()) }),
          h("a", { class: "gx-native-link", href: ui.nativeUrl(location.href), text: "Open on Roblox" })
        );
      },
      // Pin / Unpin: reads and writes the same list as Home's Pinned rail
      wirePin(U, info) {
        uni = U;
        let on = false;
        const paint = () => {
          pinBtn.classList.toggle("is-on", on);
          pinBtn.title = on ? "Unpin from Home" : "Pin to Home";
          pinBtn.setAttribute("aria-label", pinBtn.title);
          pinBtn.setAttribute("aria-pressed", on ? "true" : "false");
        };
        readPins().then((list) => {
          on = list.some((p) => String(p.universeId) === U);
          paint();
          pinBtn.hidden = false;
        });
        pinBtn.addEventListener("click", async () => {
          pinBtn.busy(true);
          const r = await togglePin({ universeId: Number(U), placeId: info.rootPlaceId ?? Number(placeId), name: info.name ?? null });
          pinBtn.busy(false);
          if (r == null) return;
          on = r;
          paint();
          CER.toast(on ? "Pinned to Home" : "Unpinned");
        });
        // pinned or unpinned in another tab (Home)
        const onChange = (ch, area) => {
          if ((area && area !== "local") || !ch[PIN_KEY]) return;
          const next = Array.isArray(ch[PIN_KEY].newValue) ? ch[PIN_KEY].newValue : [];
          on = next.some((p) => String(p?.universeId) === U);
          paint();
        };
        try {
          CER.ext.storage.onChanged.addListener(onChange);
          onCleanup(() => CER.ext.storage.onChanged.removeListener(onChange));
        } catch {
          /* context invalidated */
        }
      },
      setFriends(list) {
        if (!list.length) return;
        meta.append(
          h(
            "span",
            { class: "gx-friends", title: list.map((x) => x.friend.displayName).join(", ") },
            h("span", { class: "gx-faces" }, list.slice(0, 3).map((x) => ui.avatar(x.friend.id, { size: 22 }))),
            h("b", { text: list.length }),
            list.length === 1 ? " friend here" : " friends here"
          )
        );
      },
      // Paid access / not playable: swap Play for the right action
      setPlayability(p, info) {
        if (!p || p.isPlayable) return;
        const s = p.playabilityStatus;
        if (s === "PurchaseRequired") {
          const buy = ui.button("Buy to play", { icon: "robux", variant: "light", size: "lg", class: "gx-play", href: ui.nativeUrl(location.href) });
          if (info.price) buy.append(h("span", { class: "gx-play-price", text: fmt.full(info.price) }));
          playSlot.replaceChildren(buy);
          return;
        }
        if (s === "GuestProhibited") {
          playSlot.replaceChildren(ui.button("Log in to play", { icon: "user", variant: "light", size: "lg", class: "gx-play", href: "https://www.roblox.com/login?returnUrl=" + encodeURIComponent(location.pathname) }));
          return;
        }
        const msg = {
          UnderReview: "This game is being checked.",
          ContextualPlayabilityRegionalAvailability: "Not open in your country.",
          InsufficientPermissionFriendsOnly: "Only the maker's friends can play.",
          InsufficientPermissionGroupOnly: "Only group members can play.",
          DeviceRestricted: "Not open on this device.",
          UniverseRootPlaceIsPrivate: "This game is private.",
          PlaceHasNoPublishedVersion: "This game is not out yet.",
          AccountRestricted: "Your account can not play this.",
          ContextualPlayabilityAgeGated: "Not open for your age.",
          ContextualPlayabilityUnverifiedSeventeenPlusUser: "You need to verify your age.",
        }[s];
        note.hidden = false;
        note.textContent = msg ?? p.unplayableDisplayText ?? "You can not play this right now.";
        playBtn.disabled = true; // Roblox says not playable: no launch, no region search
        playBtn.title = note.textContent;
      },
      // Favorite / Like / Dislike / Notify: small icon buttons, real API
      // writes, only ever on click.
      async wireSocial(me, U, info) {
        if (!me) return; // logged out: Play + Share only
        let fav = !!info.isFavoritedByUser;
        let vote = null; // true up, false down, null none
        let canVote = true;
        let voteWhy = "";
        let following = false;
        let canFollow = true;
        const favBtn = quiet("star", "Favorite");
        const upBtn = quiet("like", "Like");
        const downBtn = quiet("dislike", "Dislike");
        const bellBtn = quiet("bell", "Get updates");
        const paint = () => {
          favBtn.classList.toggle("is-on", fav);
          favBtn.title = fav ? "Remove from favorites" : "Add to favorites";
          upBtn.classList.toggle("is-on", vote === true);
          downBtn.classList.toggle("is-on", vote === false);
          for (const b of [upBtn, downBtn]) b.classList.toggle("is-locked", !canVote);
          bellBtn.classList.toggle("is-on", following);
          bellBtn.title = following ? "Stop updates" : "Get updates";
        };
        paint();
        social.replaceChildren(favBtn, upBtn, downBtn, bellBtn);

        const [favNow, voteNow, followNow] = await Promise.all([
          api.json(`https://games.roblox.com/v1/games/${U}/favorites`),
          api.json(`https://games.roblox.com/v1/games/${U}/votes/user`),
          api.json(`https://followings.roblox.com/v1/users/${me.id}/universes/${U}/status`),
        ]);
        if (favNow) fav = !!favNow.isFavorited;
        if (voteNow) {
          canVote = voteNow.canVote !== false;
          // unplayed games answer { canVote: false, userVote: false }: that is NOT a dislike
          vote = canVote ? (voteNow.userVote ?? null) : null;
          voteWhy = voteNow.reasonForNotVoteable ?? "";
        }
        if (followNow) {
          following = !!(followNow.IsFollowing ?? followNow.isFollowing);
          canFollow = (followNow.CanFollow ?? followNow.canFollow) !== false || following;
        }
        paint();

        favBtn.addEventListener("click", async () => {
          const to = !fav;
          favBtn.busy(true);
          const ok = await write(`https://games.roblox.com/v1/games/${U}/favorites`, "POST", { isFavorited: to });
          favBtn.busy(false);
          if (!ok) return CER.toast("Could not save. Try again.", "error");
          fav = to;
          paint();
          CER.toast(to ? "Added to favorites" : "Removed from favorites");
        });
        const castVote = async (want) => {
          if (!canVote) return CER.toast(/play/i.test(voteWhy) ? "Play this game first, then you can vote." : "You can not vote on this game yet.");
          const to = vote === want ? null : want;
          const btn = want ? upBtn : downBtn;
          btn.busy(true);
          // Roblox's own game page votes with this request; vote=null removes a vote
          const asset = info.rootPlaceId ?? placeId;
          let ok = await write(`https://apis.roblox.com/voting-api/vote/asset/${asset}?vote=${to}`, "POST", {});
          if (!ok && to !== null) ok = await write(`https://games.roblox.com/v1/games/${U}/user-votes`, "PATCH", { vote: to }, { bgFirst: true });
          btn.busy(false);
          if (!ok) return CER.toast("Could not vote. Try again.", "error");
          vote = to;
          paint();
        };
        upBtn.addEventListener("click", () => castVote(true));
        downBtn.addEventListener("click", () => castVote(false));
        bellBtn.addEventListener("click", async () => {
          if (!canFollow) return CER.toast("You follow too many games.");
          const to = !following;
          bellBtn.busy(true);
          const ok = await write(`https://followings.roblox.com/v1/users/${me.id}/universes/${U}`, to ? "POST" : "DELETE", {});
          bellBtn.busy(false);
          if (!ok) return CER.toast("Could not save. Try again.", "error");
          following = to;
          paint();
          CER.toast(to ? "You will get updates" : "Updates turned off");
        });
      },
    };
  }

  // ------------------------------------------------------------ play
  async function playNow(placeId) {
    const s = await CER.get();
    const region = s.joinPrefs?.region;
    if (region && region !== "auto" && CER.REGIONS?.[region]) return regionJoin(placeId, region, CER.REGIONS[region]);
    ui.play(placeId);
  }
  // Private server: an invite link code or a server's access code.
  // bridge.js has no private-server message yet, so with no ack CER.launch
  // falls back to the same roblox:// start link Roblox uses (accessCode /
  // linkCode params) after 500 ms.
  function playPrivate(placeId, { accessCode, linkCode }) {
    const q = new URLSearchParams({ placeId: String(placeId) });
    if (accessCode) q.set("accessCode", accessCode);
    if (linkCode) q.set("linkCode", linkCode);
    CER.launch({ cer: "join-private", placeId, accessCode: accessCode ?? null, linkCode: linkCode ?? null }, "roblox://experiences/start?" + q);
  }

  // Preferred-region join (background.js probes servers one at a time).
  // Ported from gameredesign.js: live progress, a clear "you are NOT in X"
  // on any failure, and always a way to just join normally.
  function regionJoin(placeId, region, regionName) {
    const status = h("p", { class: "gx-region-sub", text: "Checking servers 0/15" });
    const bar = h("div", { class: "gx-region-bar" }, h("span", { style: { width: "0%" } }));
    let port = null;
    let settled = false;
    let timeout = null;
    const m = ui.modal({
      title: "Finding a " + regionName + " server",
      body: h("div", { class: "gx-region" }, status, bar),
      actions: [{ label: "Cancel", variant: "ghost", onClick: (close) => close() }],
      onClose: () => {
        settled = true;
        clearTimeout(timeout);
        stop();
      },
    });
    // closing the port is what stops the background search
    const stop = () => {
      try {
        port?.disconnect();
      } catch {
        /* gone */
      }
    };
    const fail = (titleText, subText) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stop();
      m.el.querySelector(".cer-modal-head h3").textContent = titleText;
      status.textContent = subText;
      bar.remove();
      m.el.querySelector(".cer-modal-actions").replaceChildren(
        ui.button("Cancel", { variant: "ghost", onClick: m.close }),
        ui.button("Join any server", { variant: "primary", icon: "play", onClick: () => (m.close(), ui.play(placeId)) })
      );
    };
    try {
      port = CER.ext.runtime.connect({ name: "region-join" });
    } catch {
      port = null;
    }
    if (!port) {
      m.close();
      return ui.play(placeId);
    }
    // worst case in background.js: 1 list call + 15 probes, 500 ms apart
    timeout = setTimeout(() => fail("Search took too long", "You are NOT joining " + regionName + "."), 60000);
    port.onDisconnect?.addListener?.(() => fail("Search stopped", "You are NOT joining " + regionName + "."));
    port.onMessage.addListener((msg) => {
      if (settled) return;
      if (msg.progress != null) {
        const total = msg.total || 15;
        status.textContent = `Checking servers ${msg.progress}/${total}`;
        bar.firstChild.style.width = Math.round((msg.progress / total) * 100) + "%";
        return;
      }
      if (!msg.done) return;
      if (msg.ok && msg.jobId) {
        settled = true;
        clearTimeout(timeout);
        status.textContent = "Found one! Opening Roblox.";
        bar.firstChild.style.width = "100%";
        ui.play(placeId, msg.jobId);
        setTimeout(m.close, 1400);
      } else if (msg.error === "empty") {
        settled = true;
        clearTimeout(timeout);
        m.close();
        ui.play(placeId);
      } else if (msg.error === "cooldown") fail("Please wait", "Too many searches. Wait a few minutes. You are NOT in " + regionName + ".");
      else if (msg.error === "busy") fail("Please wait", "Another search is running. You are NOT in " + regionName + ".");
      else if (msg.error === "notfound" && msg.detected === 0) fail("Region check failed", "We could not read any server's region. You are NOT in " + regionName + ".");
      else if (msg.error === "notfound") fail("No " + regionName + " server", `Checked ${msg.probed || 15} servers. You are NOT joining ${regionName}.`);
      else fail("Search failed", "You are NOT joining " + regionName + ".");
    });
    port.postMessage({ cer: "start", placeId, region });
  }

  // Friends in this game right now: [{ friend, presence }] (one promise per page)
  function friendsHere(ctx) {
    if (ctx._friendsP) return ctx._friendsP;
    ctx._friendsP = (async () => {
      const me = await ctx.mePromise;
      if (!me) return [];
      const friends = (await api.friends(me.id).catch(() => null)) ?? [];
      if (!friends.length) return [];
      const pres = await api.presence(friends.map((f) => f.id));
      const out = [];
      for (const f of friends) {
        const p = pres.get(String(f.id));
        if (p?.userPresenceType === 2 && (String(p.universeId) === ctx.universeId || String(p.rootPlaceId) === String(ctx.info.rootPlaceId) || String(p.placeId) === ctx.placeId)) out.push({ friend: f, presence: p });
      }
      return out;
    })().catch(() => []);
    return ctx._friendsP;
  }

  // ------------------------------------------------------------ Servers
  // Public server browser, ported from serverbrowser.js: sorting, locally
  // tracked "first seen" per place (Newest / Oldest sort), join best / by id,
  // plus ping, player headshots (when Roblox sends tokens) and friends first.
  const WEEK = 6.048e8;
  const AGE_INDEX = "serverFirstSeenIdx";
  async function readSeen(placeId) {
    try {
      const key = "serverFirstSeen:" + placeId;
      const { [key]: seen = {} } = await CER.ext.storage.local.get(key);
      return seen;
    } catch {
      return {};
    }
  }
  async function markSeen(placeId, ids) {
    const AGE_KEY = "serverFirstSeen:" + placeId;
    try {
      const got = await CER.ext.storage.local.get([AGE_KEY, AGE_INDEX, "serverFirstSeen"]);
      const seen = got[AGE_KEY] ?? {};
      const now = Date.now();
      for (const id of ids) if (!seen[id]) seen[id] = now;
      let entries = Object.entries(seen).filter(([, t]) => now - t <= WEEK);
      if (entries.length > 1000) entries = entries.sort((a, b) => b[1] - a[1]).slice(0, 1000);
      const fresh = Object.fromEntries(entries);
      const index = got[AGE_INDEX] ?? {};
      index[placeId] = now;
      const drop = [];
      for (const [pid, t] of Object.entries(index)) {
        if (now - t > WEEK) {
          delete index[pid];
          drop.push("serverFirstSeen:" + pid);
        }
      }
      if (got.serverFirstSeen) drop.push("serverFirstSeen"); // old one-big-map format
      await CER.ext.storage.local.set({ [AGE_KEY]: fresh, [AGE_INDEX]: index });
      if (drop.length) await CER.ext.storage.local.remove(drop);
      return fresh;
    } catch {
      return null;
    }
  }

  // player token -> headshot url, batched through thumbnails/v1/batch.
  // A token is asked for once: while its batch is in flight, later calls
  // wait for that same request instead of sending it again.
  const tokenCache = new Map();
  const tokenWait = new Map(); // token -> in-flight batch promise
  async function headshotsFor(tokens) {
    const need = [...new Set(tokens)].filter((t) => !tokenCache.has(t) && !tokenWait.has(t));
    for (let i = 0; i < need.length; i += 100) {
      const chunk = need.slice(i, i + 100);
      const p = api
        .json("https://thumbnails.roblox.com/v1/batch", {
          method: "POST",
          body: chunk.map((t) => ({ requestId: t, token: t, type: "AvatarHeadShot", size: "48x48", format: "webp", isCircular: true })),
        })
        .then((res) => {
          for (const it of res?.data ?? []) if (it.imageUrl) tokenCache.set(it.requestId, it.imageUrl);
          for (const t of chunk) {
            if (!tokenCache.has(t)) tokenCache.set(t, null);
            tokenWait.delete(t);
          }
        });
      for (const t of chunk) tokenWait.set(t, p);
    }
    await Promise.all(new Set(tokens.map((t) => tokenWait.get(t)).filter(Boolean)));
  }

  // One page of public servers. This endpoint has one of Roblox's tightest
  // limits, so: one page per ask, and one retry about 2 s after a 429.
  // full: also list full servers (used when every open one is gone).
  // → { data, next, status } (data null when it failed)
  async function serverPage(placeId, order, cursor, full) {
    const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&sortOrder=${order}${full ? "" : "&excludeFullGames=true"}${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`;
    let res = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(url, { credentials: "include" }).catch(() => null);
      if (res?.status !== 429 || attempt) break;
      await api.sleep(2000);
    }
    const body = res?.ok ? await res.json().catch(() => null) : null;
    if (!Array.isArray(body?.data)) return { data: null, next: null, status: res?.status ?? 0 };
    return { data: body.data, next: body.nextPageCursor || null, status: res.status };
  }

  const MAX_SERVERS = 500; // 5 pages at most, and only when asked for
  const REFRESH_GAP = 5000;

  function buildServers(pane, ctx) {
    const { placeId } = ctx;
    let servers = [];
    let seen = {};
    let sort = "most";
    let order = "Desc"; // API order: Desc = fullest first, Asc = emptiest first
    let full = false; // true = every open server was gone, so full ones are listed
    let cursor = null; // next page, null = we have them all
    let shown = 12;
    let seq = 0;
    let loaded = null; // page 1 of the current list
    let paging = null; // a later page in flight
    let lastLoad = 0;
    let drawn = []; // server ids on screen, in order
    let friendJobs = new Map(); // jobId -> [{ friend, presence }]

    const sortSel = ui.select(
      [
        { id: "most", label: "Most players" },
        { id: "least", label: "Fewest players" },
        { id: "ping", label: "Best ping" },
        { id: "newest", label: "Newest" },
        { id: "oldest", label: "Oldest" },
      ],
      sort,
      (v) => {
        sort = v;
        shown = 12;
        // a whole list sorts here; a cut-off one asks Roblox for the right end
        const want = v === "least" ? "Asc" : v === "most" ? "Desc" : order;
        if (want !== order && cursor) {
          order = want;
          return load();
        }
        render();
        // ping / age sorts mean more with more servers: one more page
        if ((v === "ping" || v === "newest" || v === "oldest") && servers.length < 200) more();
      }
    );
    const byId = ui.button("", { icon: "hash", variant: "ghost", title: "Join by server ID", onClick: () => joinByIdModal(placeId) });
    const refresh = ui.button("", {
      icon: "refresh",
      variant: "ghost",
      title: "Refresh",
      onClick: () => {
        if (Date.now() - lastLoad < REFRESH_GAP) return CER.toast("Wait a moment.");
        load();
      },
    });
    const best = ui.button("Join best", { variant: "soft", title: "Join the fullest server with room", onClick: () => joinBest() });

    const friendsSec = section("Friends here");
    friendsSec.hidden = true;
    const privHost = h("div", { class: "gx-private-host" });
    const note = h("p", { class: "gx-sv-note", hidden: true });
    const list = h("div", { class: "gx-servers" });
    const footer = h("div", { class: "gx-foot" });
    const sentinel = h("div", { class: "gx-sentinel" });
    // no "Servers" title: the tab already says it
    const tools = h("div", { class: "gx-tools" }, sortSel, byId, refresh, h("span", { class: "gx-grow" }), best);
    const main = h("div", { class: "gx-main" }, tools, note, list, footer, sentinel);
    pane.append(friendsSec, main, privHost);

    // show more of what is loaded when the bottom comes into view
    // (a new page is only fetched on a Show more click)
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting) && !pane.hidden && shown < servers.length) {
          shown += 12;
          render();
        }
      },
      { rootMargin: "400px" }
    );
    io.observe(sentinel);
    onCleanup(() => io.disconnect());

    function sorted() {
      const rows = servers.slice();
      const age = (s) => seen[s.id] ?? Date.now();
      if (sort === "most") rows.sort((a, b) => b.playing - a.playing);
      else if (sort === "least") rows.sort((a, b) => a.playing - b.playing);
      else if (sort === "ping") rows.sort((a, b) => (a.ping ?? 9999) - (b.ping ?? 9999));
      else if (sort === "newest") rows.sort((a, b) => age(b) - age(a));
      else if (sort === "oldest") rows.sort((a, b) => age(a) - age(b));
      return rows;
    }

    // Cards already on screen stay; only new ones are added (and only new
    // ones ask for player heads). A changed order rebuilds the list.
    function render() {
      if (!servers.length) return;
      const rows = sorted();
      const visible = rows.slice(0, shown);
      const same = drawn.length && drawn.length <= visible.length && drawn.every((id, i) => visible[i].id === id) && list.querySelector(".gx-server");
      const fresh = same ? visible.slice(drawn.length) : visible;
      if (same) list.append(...fresh.map((s) => serverCard(s)));
      else list.replaceChildren(...fresh.map((s) => serverCard(s)));
      drawn = visible.map((s) => s.id);
      paintFoot(rows.length);
      if (fresh.length) fillHeads(fresh);
    }
    function paintFoot(total = servers.length) {
      const can = shown < total || (cursor && servers.length < MAX_SERVERS);
      footer.replaceChildren(
        paging
          ? h("span", { class: "gx-muted", text: "Loading more..." })
          : can
            ? ui.button("Show more", { variant: "soft", onClick: showMore })
            : ""
      );
    }
    async function showMore() {
      if (shown >= servers.length) await more();
      shown += 12;
      render();
    }

    async function fillHeads(visible) {
      const want = visible.filter((s) => s.playerTokens?.length);
      if (!want.length) return;
      await headshotsFor(want.flatMap((s) => s.playerTokens.slice(0, 5)));
      for (const s of want) {
        const host = list.querySelector(`[data-job="${s.id}"] .gx-heads`);
        if (!host) continue;
        // keep friend faces (links) first, fill the rest with player heads
        host.querySelectorAll(".gx-head:not(.is-friend)").forEach((x) => x.remove());
        const room = Math.max(0, 5 - host.children.length);
        const urls = s.playerTokens.slice(0, room).map((t) => tokenCache.get(t)).filter(Boolean);
        host.append(...urls.map((u) => h("span", { class: "gx-head" }, ui.img(u, { alt: "" }))));
      }
    }

    function serverCard(s, friendsIn = friendJobs.get(s.id)) {
      const pct = s.maxPlayers > 0 ? Math.min(100, Math.round((s.playing / s.maxPlayers) * 100)) : 0;
      const full = s.playing != null && s.maxPlayers > 0 && s.playing >= s.maxPlayers;
      const ping = s.ping != null ? Math.round(s.ping) : null;
      const tone = ping == null ? "" : ping <= 90 ? "good" : ping <= 180 ? "warn" : "bad";
      const heads = h("div", { class: "gx-heads" });
      if (friendsIn?.length)
        heads.append(...friendsIn.slice(0, 5).map(({ friend }) => h("a", { class: "gx-head is-friend", href: `https://www.roblox.com/users/${friend.id}/profile`, title: friend.displayName }, ui.thumb("headshot", friend.id, { alt: "" }))));
      return h(
        "div",
        { class: "gx-server" + (full ? " is-full" : "") + (friendsIn?.length ? " has-friends" : ""), "data-job": s.id },
        h(
          "div",
          { class: "gx-sv-top" },
          s.playing == null
            ? h(
                "span",
                { class: "gx-sv-who" },
                (friendsIn ?? []).map(({ friend }) =>
                  ui.nameTag({ type: "user", id: friend.id, name: friend.displayName || friend.name || "", verified: friend.hasVerifiedBadge, size: "md", href: `https://www.roblox.com/users/${friend.id}/profile` })
                )
              )
            : h("span", { class: "gx-sv-count" }, h("b", { text: s.playing }), "/" + (s.maxPlayers ?? "?")),
          ping != null && h("span", { class: "gx-ping is-" + tone, title: "Ping" }, ping + " ms")
        ),
        s.playing != null && h("div", { class: "gx-sv-track" }, h("span", { style: { width: pct + "%" } })),
        h(
          "div",
          { class: "gx-sv-foot" },
          heads,
          ui.button("", { icon: "copy", variant: "ghost", size: "sm", title: "Copy server ID", class: "gx-sv-copy", onClick: () => ui.copy(s.id, "Server ID copied!") }),
          ui.button(full ? "Full" : "Join", { variant: full ? "soft" : "primary", size: "sm", disabled: full, onClick: () => ui.play(placeId, s.id) })
        )
      );
    }

    function addPage(data) {
      const known = new Set(servers.map((s) => s.id));
      servers = servers.concat(data.filter((s) => s?.id && !known.has(s.id)));
    }
    async function remember() {
      const my = seq;
      const fresh = await markSeen(placeId, servers.map((s) => s.id));
      if (fresh && my === seq) seen = fresh;
    }

    // Page 1 only. More pages come on Show more, an age or ping sort, or
    // Join best. Refresh starts over (at most once every 5 s).
    function load() {
      const my = ++seq;
      lastLoad = Date.now();
      paging = null;
      loaded = (async () => {
        shown = 12;
        servers = [];
        cursor = null;
        full = false;
        drawn = [];
        note.hidden = true;
        list.replaceChildren(...ui.skeleton("row", 8).map((x) => (x.classList.add("gx-sv-sk"), x)));
        footer.replaceChildren();
        seen = await readSeen(placeId);
        let r = await serverPage(placeId, order, "", false);
        if (my !== seq || !ctx.live()) return;
        // no open server: maybe they are all full, not empty
        if (r.data && !r.data.length && !r.next) {
          const all = await serverPage(placeId, order, "", true);
          if (my !== seq || !ctx.live()) return;
          if (all.data?.length) full = true;
          if (!all.data || full) r = all;
        }
        if (!r.data) {
          list.replaceChildren(ui.empty(r.status === 429 ? "Too many tries. Wait a moment." : "Servers did not load.", { icon: "server", action: ui.button("Try again", { variant: "soft", onClick: () => load() }) }));
          return;
        }
        addPage(r.data);
        cursor = r.next;
        if (!servers.length) {
          list.replaceChildren(ui.empty("Nobody is playing. Press Play to start a server!", { icon: "server" }));
          return;
        }
        if (full) {
          note.textContent = "All servers are full.";
          note.hidden = false;
        }
        render();
        renderFriends();
        remember();
      })();
      return loaded;
    }

    // the next page of the current list (one at a time)
    function more() {
      if (paging) return paging;
      if (!cursor || servers.length >= MAX_SERVERS) return Promise.resolve(false);
      const my = seq;
      paging = (async () => {
        const r = await serverPage(placeId, order, cursor, full);
        if (my !== seq || !ctx.live()) return false;
        paging = null;
        if (!r.data) {
          paintFoot();
          CER.toast("Could not load more. Try again.", "error");
          return false; // cursor kept: Show more tries the same page again
        }
        addPage(r.data);
        cursor = r.next;
        render();
        renderFriends();
        remember();
        return true;
      })();
      paintFoot(); // "Loading more..."
      return paging;
    }

    async function joinBest() {
      if (!loaded) load();
      best.busy(true);
      await loaded;
      const settings = await CER.get();
      const pick = () => {
        let open = servers.filter((s) => s.playing < s.maxPlayers);
        if (settings.joinPrefs?.avoidFriends && friendJobs.size) {
          const away = open.filter((s) => !friendJobs.has(s.id));
          if (away.length) open = away;
        }
        return open;
      };
      let open = pick();
      // nothing open in what we have: look at up to 2 more pages
      for (let i = 0; !open.length && i < 2 && (await more()); i++) open = pick();
      best.busy(false);
      if (!open.length) return ui.play(placeId); // nothing open: Roblox picks or starts one
      // fullest server that still has room, then the lowest ping
      open.sort((a, b) => b.playing / b.maxPlayers - a.playing / a.maxPlayers || (a.ping ?? 999) - (b.ping ?? 999));
      ui.play(placeId, open[0].id);
    }

    // friends first: their servers come from presence (presence.gameId = jobId)
    friendsHere(ctx).then((fr) => {
      if (!ctx.live()) return;
      friendJobs = new Map();
      for (const x of fr) {
        if (!x.presence.gameId || String(x.presence.placeId) !== String(placeId)) continue;
        if (!friendJobs.has(x.presence.gameId)) friendJobs.set(x.presence.gameId, []);
        friendJobs.get(x.presence.gameId).push(x);
      }
      if (!friendJobs.size) return;
      friendsSec.hidden = false;
      renderFriends();
      drawn = []; // friend faces go on the cards: rebuild them once
      render();
    });
    // friend cards use the real server row once the list has it
    function renderFriends() {
      if (!friendJobs.size) return;
      friendsSec.body.replaceChildren(
        h(
          "div",
          { class: "gx-servers" },
          [...friendJobs.entries()].map(([job, f]) => serverCard(servers.find((x) => x.id === job) ?? { id: job, playing: null, maxPlayers: null }, f))
        )
      );
    }

    buildPrivate(privHost, ctx);
    load();
  }

  function joinByIdModal(placeId) {
    const input = h("input", { class: "cer-input-el", placeholder: "Server ID", spellcheck: "false", autocomplete: "off" });
    const go = (close) => {
      const id = input.value.trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return CER.toast("That server ID does not look right.", "error");
      close();
      ui.play(placeId, id);
    };
    const m = ui.modal({
      title: "Join a server",
      body: h("label", { class: "cer-input" }, ui.icon("server", 17), input),
      actions: [
        { label: "Cancel", variant: "ghost" },
        { label: "Join", variant: "primary", onClick: go },
      ],
    });
    input.addEventListener("keydown", (e) => e.key === "Enter" && go(m.close));
    requestAnimationFrame(() => input.focus());
  }

  // Private (VIP) servers: one row each, only when the game has them.
  // Every server you can join is a Join button here; only buying one
  // ("Get one") stays on Roblox's own page.
  async function buildPrivate(host, ctx) {
    const { placeId, universeId: U } = ctx;
    const me = await ctx.mePromise;
    const [enabled, mine] = await Promise.all([
      api.json(`https://games.roblox.com/v1/private-servers/enabled-in-universe/${U}`, { ttl: 600000 }),
      me ? api.json(`https://games.roblox.com/v1/games/${placeId}/private-servers?limit=25`) : null,
    ]);
    if (!ctx.live()) return;
    const rows = mine?.data ?? [];
    const canBuy = !!(enabled?.privateServersEnabled || ctx.info.createVipServersAllowed);
    const failed = !!me && !mine && enabled?.privateServersEnabled !== false;
    if (!canBuy && !rows.length && !failed) return;
    const sec = section("Private servers", { action: canBuy && { label: "Get one", href: ui.nativeUrl(`https://www.roblox.com/games/${placeId}#!/game-instances`) } });
    if (failed)
      sec.body.append(
        ui.empty("Could not load.", {
          icon: "server",
          action: ui.button("Try again", { variant: "soft", onClick: () => (host.replaceChildren(), buildPrivate(host, ctx)) }),
        })
      );
    else if (rows.length)
      sec.body.append(
        h(
          "div",
          { class: "gx-private" },
          rows.map((s) =>
            h(
              "div",
              { class: "gx-private-row" + (s.accessCode ? "" : " is-off") },
              s.owner?.id ? ui.avatar(s.owner.id, { size: 32 }) : null,
              h("b", { text: s.name || "Private server" }),
              s.owner?.id && ui.nameTag({ type: "user", id: s.owner.id, name: s.owner.displayName || s.owner.name || "", verified: s.owner.hasVerifiedBadge, size: "sm", cls: "gx-private-owner" }),
              h("span", { class: "gx-muted", text: s.playing ? `${s.playing}/${s.maxPlayers}` : "" }),
              s.accessCode && ui.button("Join", { variant: "primary", size: "sm", onClick: () => playPrivate(placeId, { accessCode: s.accessCode }) })
            )
          )
        )
      );
    host.replaceChildren(sec);
  }

  // ------------------------------------------------------------ Store
  const passCache = new Map();
  function loadPasses(U, token = "") {
    const key = U + "|" + token;
    if (!passCache.has(key))
      passCache.set(
        key,
        (async () => {
          const j = await api.json(`https://apis.roblox.com/game-passes/v1/universes/${U}/game-passes?passView=Full&pageSize=50${token ? "&pageToken=" + encodeURIComponent(token) : ""}`, { ttl: 120000 });
          if (j?.gamePasses) return { items: j.gamePasses, next: j.nextPageToken || null };
          if (token) return null;
          // older endpoint (background: its CORS refuses the page)
          const old = await api.json(`https://games.roblox.com/v1/games/${U}/game-passes?limit=100&sortOrder=Asc`, { ttl: 120000, bg: true });
          if (!old?.data) return null;
          return { items: old.data.map((p) => ({ id: p.id, name: p.name, displayName: p.displayName ?? p.name, price: p.price, isForSale: p.price != null })), next: null };
        })().then((r) => {
          if (!r) passCache.delete(key); // failures are retried next time
          return r;
        })
      );
    return passCache.get(key);
  }
  // first page failed: say so (not "no items") and let them rebuild the tab
  function failed(pane, ctx, builder, icon) {
    return ui.empty("Could not load.", {
      icon,
      action: ui.button("Try again", {
        variant: "soft",
        onClick: () => {
          for (const k of [...passCache.keys()]) if (k.startsWith(ctx.universeId + "|")) passCache.delete(k);
          pane.replaceChildren();
          builder(pane, ctx);
        },
      }),
    });
  }
  function buildStore(pane, ctx) {
    const grid = ui.grid(ui.skeleton("card", 6), { min: 170, gap: 22, class: "gx-passes" });
    const foot = h("div", { class: "gx-foot" });
    pane.append(grid, foot);
    let first = true;
    const more = async (token) => {
      const r = await loadPasses(ctx.universeId, token);
      if (!r && !first) {
        // a later page failed: keep what is shown, let them try again
        foot.querySelector(".cer-btn")?.busy?.(false);
        return CER.toast("Could not load more. Try again.", "error");
      }
      if (first) grid.replaceChildren();
      first = false;
      if (!r) return pane.replaceChildren(failed(pane, ctx, buildStore, "bag"));
      if (!r.items.length && !grid.children.length) return pane.replaceChildren(ui.empty("No passes in this game.", { icon: "bag" }));
      // things you can buy first, then owned, then off sale
      const rank = (p) => (p.isOwned ? 1 : p.isForSale !== false && p.price != null ? 0 : 2);
      grid.append(...r.items.slice().sort((a, b) => rank(a) - rank(b)).map(passCard));
      foot.replaceChildren(r.next ? ui.button("Show more", { variant: "soft", onClick: (e) => (e.currentTarget.busy?.(true), more(r.next)) }) : "");
    };
    more("");
  }
  function passCard(p) {
    const forSale = p.isForSale !== false && p.price != null;
    return h(
      "a",
      { class: "gx-pass" + (forSale || p.isOwned ? "" : " is-off"), href: `https://www.roblox.com/game-pass/${p.id}`, title: p.displayName ?? p.name },
      h("div", { class: "gx-pass-art" }, ui.thumb("pass", p.id, { alt: "" })),
      h("div", { class: "gx-pass-name", text: p.displayName ?? p.name }),
      p.isOwned ? h("div", { class: "gx-owned" }, ui.icon("check", 15), "Owned") : forSale ? robux(p.price) : h("div", { class: "gx-muted", text: "Not for sale" })
    );
  }

  // ------------------------------------------------------------ Badges
  function loadBadges(U, cursor = "") {
    return api.json(`https://badges.roblox.com/v1/universes/${U}/badges?limit=50&sortOrder=Asc${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, { ttl: 300000 }).then((j) => (j?.data ? { items: j.data, next: j.nextPageCursor || null } : null));
  }
  function buildBadges(pane, ctx) {
    const list = h("div", { class: "gx-badges" }, ui.skeleton("row", 6));
    const foot = h("div", { class: "gx-foot" });
    pane.append(list, foot);
    let first = true;
    const more = async (cursor) => {
      const r = await loadBadges(ctx.universeId, cursor);
      if (!r && !first) {
        foot.querySelector(".cer-btn")?.busy?.(false);
        return CER.toast("Could not load more. Try again.", "error");
      }
      if (first) list.replaceChildren();
      first = false;
      if (!r) return pane.replaceChildren(failed(pane, ctx, buildBadges, "medal"));
      if (!r.items.length && !list.children.length) return pane.replaceChildren(ui.empty("No badges in this game.", { icon: "medal" }));
      list.append(...r.items.filter((b) => b.enabled !== false).map(badgeRow));
      foot.replaceChildren(r.next ? ui.button("Show more", { variant: "soft", onClick: (e) => (e.currentTarget.busy?.(true), more(r.next)) }) : "");
      // which of these you have: one call per 50 badges
      const me = await ctx.mePromise;
      if (!me) return;
      // tight per-account limit (see badge.js): one quiet retry 6 s later,
      // and nothing is marked when both fail
      const url = `https://badges.roblox.com/v1/users/${me.id}/badges/awarded-dates?badgeIds=${r.items.map((b) => b.id).join(",")}`;
      let own = await api.json(url);
      if (!own && ctx.live()) {
        await api.sleep(6000);
        if (ctx.live() && list.isConnected) own = await api.json(url);
      }
      if (!own || !ctx.live()) return;
      for (const o of own.data ?? []) {
        const el = list.querySelector(`[data-badge="${o.badgeId}"]`);
        if (!el) continue;
        el.classList.add("is-owned");
        el.querySelector(".gx-badge-side").replaceChildren(h("span", { class: "gx-owned", title: new Date(o.awardedDate).toLocaleDateString() }, ui.icon("check", 15), "You have it"));
      }
    };
    more("");
  }
  function badgeRow(b) {
    const r = b.statistics?.winRatePercentage;
    const pct = r == null ? "" : r * 100 < 0.1 ? "<0.1%" : (r * 100).toFixed(r * 100 < 10 ? 1 : 0) + "%";
    return h(
      "a",
      { class: "gx-badge", href: `https://www.roblox.com/badges/${b.id}`, "data-badge": b.id, title: b.displayName ?? b.name },
      h("div", { class: "gx-badge-art" }, ui.thumb("badge", b.id, { alt: "" })),
      h("div", { class: "gx-badge-main" }, h("div", { class: "gx-badge-name", text: b.displayName ?? b.name }), (b.displayDescription ?? b.description) && h("div", { class: "gx-badge-desc", text: b.displayDescription ?? b.description })),
      h("div", { class: "gx-badge-side" }, pct && h("span", { class: "gx-rarity", title: "Players who have it" }, pct))
    );
  }

  // ------------------------------------------------------------ More like this
  // Roblox's picks; that endpoint sometimes answers with an empty list, so
  // the maker's other games fill in.
  function buildMore(pane, ctx) {
    const { info } = ctx;
    const grid = ui.grid(ui.skeleton("card", 8), { min: 230, gap: 20 });
    pane.append(grid);
    const card = (g) => ui.gameCard(g, { features: ctx.feats });
    (async () => {
      const j = await api.json(`https://games.roblox.com/v1/games/recommendations/game/${ctx.universeId}?maxRows=12`, { ttl: 600000 });
      let games = (j?.games ?? []).filter((g) => String(g.universeId) !== ctx.universeId).map((g) => ({ placeId: g.placeId, universeId: g.universeId, name: g.name, playing: g.playerCount, rating: fmt.pct(g.totalUpVotes, g.totalDownVotes) }));
      if (!games.length && info.creator?.id) {
        const c = info.creator;
        const url = c.type === "Group" ? `https://games.roblox.com/v2/groups/${c.id}/gamesV2?accessFilter=Public&limit=50&sortOrder=Desc` : `https://games.roblox.com/v2/users/${c.id}/games?accessFilter=Public&limit=50&sortOrder=Desc`;
        const mine = await api.json(url, { ttl: 600000 });
        games = (mine?.data ?? []).filter((g) => String(g.id) !== ctx.universeId).map((g) => ({ universeId: g.id, placeId: g.rootPlace?.id, name: g.name }));
        if (games.length) {
          await ui.hydrateGames(games);
          games.sort((a, b) => (b.playing ?? 0) - (a.playing ?? 0));
          games = games.slice(0, 12);
        }
      }
      if (!games.length) return pane.replaceChildren(ui.empty("Nothing to show yet.", { icon: "sparkle" }));
      grid.replaceChildren(...games.map(card));
    })();
  }
})();
