// CER game page (/games/{placeId}/...). Built on CER.ui (content/ui.js).
// Original layout: a cinematic hero (blurred art backdrop, thumbnail gallery,
// title, creator, a huge Play button, favorite / vote / notify / share), a
// glass stat bar, then tabs: About, Servers, Store, Badges, More like this.
// Roblox is used for DATA (web APIs) and ACTIONS (its launcher, its purchase
// pages) only. Replaces gameredesign.js, serverbrowser.js and the Roblox-page
// parts of gamepage.js on pages we own.

(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;

  // things the previous page left running (gallery timer, listeners)
  let cleanups = [];
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

  // Tab id <-> the hash Roblox uses (so shared links like #!/game-instances work)
  const TAB_HASH = { about: "about", servers: "game-instances", store: "store", badges: "badges", more: "recommended" };
  const tabFromHash = () => {
    const key = location.hash.replace(/^#!?\/?/, "").toLowerCase();
    for (const [id, hash] of Object.entries(TAB_HASH)) if (hash === key) return id;
    return key === "servers" ? "servers" : "about";
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
  const safeUrl = (u) => {
    try {
      const x = new URL(u);
      return x.protocol === "https:" ? x.toString() : null;
    } catch {
      return null;
    }
  };
  const robux = (n) => h("span", { class: "gx-robux" }, ui.icon("robux", 15), h("span", { text: fmt.full(n) }));
  const genreOf = (info) => {
    const g = info?.genre_l1 || (info?.genre && info.genre !== "All" ? info.genre : "");
    return g ? g.replace(/\b\w/g, (c) => c.toUpperCase()) : "";
  };
  const avatarType = (t) => ({ MorphToR6: "R6 only", MorphToR15: "R15 only", PlayerChoice: "Player choice" })[t] ?? "";

  // ------------------------------------------------------------ route
  ui.route("game", async () => {
    runCleanups();
    const placeId = location.pathname.match(/^\/games\/(\d+)/i)?.[1];
    if (!placeId) return ui.release();

    const { page } = ui.page("game", "gx");
    const feats = (await CER.get()).features ?? {};
    const mePromise = api.me().catch(() => null);

    // ---- shell first (skeleton look), filled as data lands ----
    const hero = buildHeroShell(placeId);
    const statBar = h("div", { class: "gx-stats is-loading" }, Array.from({ length: 8 }, () => h("div", { class: "gx-stat" }, h("span", { class: "gx-stat-label cer-sk" }), h("span", { class: "gx-stat-value cer-sk" }))));
    hero.el.append(statBar);
    const tabsHost = h("div", { class: "gx-tabbar" });
    const panes = h("div", { class: "gx-panes" }, h("div", { class: "gx-pane" }, ui.skeleton("row", 4)));
    page.append(hero.el, tabsHost, panes);

    const universeId = await api.universeOf(placeId);
    if (!universeId) {
      hero.fail();
      statBar.remove();
      panes.replaceChildren(ui.empty("We could not find this game.", { icon: "gamepad", action: ui.button("Open Roblox's page", { variant: "soft", href: ui.nativeUrl() }) }));
      return;
    }
    const U = String(universeId);

    // fire everything the first screen needs at once
    const infoP = api.game(U);
    const galleryP = api.json(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${U}&countPerUniverse=25&defaults=true&size=768x432&format=Webp&isCircular=false`, { ttl: 600000 });
    const playP = api.json(`https://games.roblox.com/v1/games/multiget-playability-status?universeIds=${U}`, { ttl: 60000 });
    hero.setIcon(api.thumb("gameIcon", U));
    galleryP.then((j) => hero.setGallery(j, U));

    const info = await infoP;
    if (!info) {
      hero.fail();
      statBar.remove();
      panes.replaceChildren(ui.empty("This game did not load. Try again soon.", { icon: "refresh", action: ui.button("Try again", { variant: "soft", onClick: () => location.reload() }) }));
      return;
    }
    const ctx = { placeId, universeId: U, info, feats, mePromise, hero };
    hero.fill(info, feats);
    fillStats(statBar, info);
    playP.then((p) => hero.setPlayability(Array.isArray(p) ? p[0] : null, info));
    mePromise.then((me) => hero.wireSocial(me, U, info));

    // ---- tabs ----
    const counts = {};
    const built = {};
    const TABS = () => [
      { id: "about", label: "About", icon: "info" },
      { id: "servers", label: "Servers", icon: "server" },
      { id: "store", label: "Store", icon: "bag", count: counts.store },
      { id: "badges", label: "Badges", icon: "medal", count: counts.badges },
      { id: "more", label: "More like this", icon: "sparkle" },
    ];
    let active = tabFromHash();
    let tabs = null;
    const renderTabs = () => {
      tabs = ui.tabs(TABS(), active, (id) => show(id, true));
      tabsHost.replaceChildren(tabs);
    };
    const builders = { about: buildAbout, servers: buildServers, store: buildStore, badges: buildBadges, more: buildMore };
    const show = (id, fromClick) => {
      active = id;
      if (!built[id]) {
        built[id] = h("div", { class: "gx-pane", "data-tab": id });
        panes.append(built[id]);
        try {
          builders[id](built[id], ctx);
        } catch (e) {
          console.warn("[CER] game tab failed", id, e);
          built[id].replaceChildren(ui.empty("This part did not load.", { icon: "info" }));
        }
      }
      for (const [k, el] of Object.entries(built)) el.hidden = k !== id;
      if (fromClick) {
        history.replaceState(history.state, "", location.pathname + location.search + "#!/" + TAB_HASH[id]);
      }
    };
    panes.replaceChildren();
    renderTabs();
    show(active);
    // back/forward or a pasted #!/store link
    const onHash = () => {
      const id = tabFromHash();
      if (id !== active) {
        tabs?.set(id);
        show(id);
      }
    };
    window.addEventListener("hashchange", onHash);
    onCleanup(() => window.removeEventListener("hashchange", onHash));
    ctx.openTab = (id) => {
      tabs?.set(id);
      show(id, true);
      tabsHost.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    // counts for the Store / Badges tabs, once the first screen is idle
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 900));
    idle(async () => {
      const [passes, badges] = await Promise.all([loadPasses(U), loadBadges(U)]);
      let changed = false;
      if (passes?.items) {
        counts.store = passes.items.length;
        changed = true;
      }
      if (badges?.items) {
        counts.badges = badges.items.length;
        changed = true;
      }
      if (changed && page.isConnected) renderTabs();
    });
  });

  // ------------------------------------------------------------ hero
  function buildHeroShell(placeId) {
    const bgA = h("div", { class: "gx-bg" });
    const bgB = h("div", { class: "gx-bg" });
    let bgFront = bgA;
    const setBackdrop = (url) => {
      if (!url) return;
      const back = bgFront === bgA ? bgB : bgA;
      back.style.backgroundImage = `url("${String(url).replace(/"/g, "")}")`;
      back.classList.add("is-on");
      bgFront.classList.remove("is-on");
      bgFront = back;
    };

    const icon = h("div", { class: "gx-icon cer-sk" });
    const creator = h("div", { class: "gx-creator" }, h("span", { class: "gx-sk-line cer-sk", style: { width: "160px" } }));
    const title = h("h1", { class: "gx-title" }, h("span", { class: "gx-sk-line gx-sk-title cer-sk" }));
    const live = h("div", { class: "gx-live" }, h("span", { class: "gx-sk-line cer-sk", style: { width: "220px" } }));
    const note = h("p", { class: "gx-note", hidden: true });

    const playBtn = ui.button("Play", { icon: "play", variant: "light", size: "lg", class: "gx-play" });
    playBtn.addEventListener("click", () => playNow(placeId));
    const playSlot = h("div", { class: "gx-play-slot" }, playBtn);
    const optsBtn = ui.button("", { icon: "sliders", variant: "glass", size: "lg", title: "Join options", class: "gx-round", onClick: () => CER.openSettings?.("Join") });
    const social = h("div", { class: "gx-social" });
    const shareBtn = ui.button("", { icon: "link", variant: "glass", size: "lg", title: "Copy link", class: "gx-round", onClick: () => ui.copy(`https://www.roblox.com/games/${placeId}`, "Link copied!") });

    // gallery
    const slides = h("div", { class: "gx-slides" });
    const dots = h("div", { class: "gx-dots" });
    const prev = h("button", { type: "button", class: "gx-arrow is-prev", "aria-label": "Back" }, ui.icon("left", 22));
    const next = h("button", { type: "button", class: "gx-arrow is-next", "aria-label": "Next" }, ui.icon("right", 22));
    const counter = h("span", { class: "gx-counter" });
    const gallery = h("div", { class: "gx-gallery is-loading" }, slides, prev, next, dots, counter);

    const info = h(
      "div",
      { class: "gx-info" },
      h("div", { class: "gx-id" }, icon, h("div", { class: "gx-id-text" }, creator, title)),
      live,
      h("div", { class: "gx-actions" }, playSlot, social, shareBtn, optsBtn),
      note
    );
    const el = h("section", { class: "gx-hero" }, bgA, bgB, h("div", { class: "gx-shade" }), h("div", { class: "gx-hero-grid" }, info, gallery));

    // ---- gallery behaviour ----
    let urls = [];
    let idx = 0;
    let timer = null;
    const go = (i, user) => {
      if (!urls.length) return;
      idx = (i + urls.length) % urls.length;
      [...slides.children].forEach((s, k) => s.classList.toggle("is-on", k === idx));
      [...dots.children].forEach((d, k) => d.classList.toggle("is-on", k === idx));
      counter.textContent = urls.length > 1 ? `${idx + 1} / ${urls.length}` : "";
      // load the next slide early so the swap never shows a blank
      const nx = slides.children[(idx + 1) % urls.length]?.querySelector("img");
      if (nx && !nx.src) nx.src = nx.dataset.src;
      const cur = slides.children[idx]?.querySelector("img");
      if (cur && !cur.src) cur.src = cur.dataset.src;
      setBackdrop(urls[idx]);
      if (user) restart();
    };
    const restart = () => {
      clearInterval(timer);
      if (urls.length > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches)
        timer = setInterval(() => {
          if (!document.hidden && !gallery.matches(":hover") && el.isConnected) go(idx + 1);
        }, 7000);
    };
    prev.addEventListener("click", () => go(idx - 1, true));
    next.addEventListener("click", () => go(idx + 1, true));
    gallery.tabIndex = 0;
    gallery.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") go(idx - 1, true);
      if (e.key === "ArrowRight") go(idx + 1, true);
    });
    // swipe on touch screens
    let sx = null;
    gallery.addEventListener("pointerdown", (e) => (sx = e.pointerType === "mouse" ? null : e.clientX));
    gallery.addEventListener("pointerup", (e) => {
      if (sx != null && Math.abs(e.clientX - sx) > 40) go(idx + (e.clientX < sx ? 1 : -1), true);
      sx = null;
    });
    onCleanup(() => clearInterval(timer));

    const api_ = {
      el,
      setIcon(p) {
        Promise.resolve(p).then((url) => {
          icon.classList.remove("cer-sk");
          if (url) icon.replaceChildren(ui.img(url, { alt: "" }));
          else icon.classList.add("is-empty");
        });
      },
      async setGallery(j, U) {
        let list = (j?.data?.[0]?.thumbnails ?? []).filter((t) => t.state === "Completed" && t.imageUrl).map((t) => t.imageUrl);
        // a brand new upload can still be rendering; one quiet retry
        if (!list.length && j?.data?.[0]?.thumbnails?.some((t) => t.state === "Pending")) {
          await api.sleep(1500);
          const again = await api.json(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${U}&countPerUniverse=25&defaults=true&size=768x432&format=Webp&isCircular=false`);
          list = (again?.data?.[0]?.thumbnails ?? []).filter((t) => t.state === "Completed" && t.imageUrl).map((t) => t.imageUrl);
        }
        urls = [...new Set(list)];
        gallery.classList.remove("is-loading");
        if (!urls.length) {
          gallery.classList.add("is-empty");
          slides.replaceChildren(h("div", { class: "gx-slide is-on gx-slide-empty" }, ui.icon("image", 40)));
          return;
        }
        slides.replaceChildren(
          ...urls.map((u, i) => {
            const img = h("img", { alt: "", draggable: "false", decoding: "async", "data-src": u });
            img.addEventListener("load", () => img.classList.add("is-in"), { once: true });
            if (i === 0) img.src = u;
            return h("div", { class: "gx-slide" }, img);
          })
        );
        dots.replaceChildren(...urls.map((_, i) => h("button", { type: "button", class: "gx-dot", "aria-label": "Picture " + (i + 1), onClick: () => go(i, true) })));
        gallery.classList.toggle("is-single", urls.length < 2);
        go(0);
        restart();
      },
      fill(info, feats) {
        el.classList.add("is-ready");
        const c = info.creator ?? {};
        const isGroup = c.type === "Group";
        const href = isGroup ? `https://www.roblox.com/communities/${c.id}` : `https://www.roblox.com/users/${c.id}/profile`;
        const cIcon = h("span", { class: "gx-creator-pic" + (isGroup ? " is-group" : "") }, ui.thumb(isGroup ? "groupIcon" : "headshot", c.id, { alt: "" }));
        creator.replaceChildren(
          h(
            "a",
            { class: "gx-creator-link", href, title: c.name },
            cIcon,
            h("span", { class: "gx-creator-by", text: "By" }),
            h("span", { class: "gx-creator-name", text: c.name ?? "Unknown" }),
            c.hasVerifiedBadge && h("span", { class: "gx-verified", title: "Verified" }, ui.icon("verified", 16))
          )
        );
        const name = CER.cleanTitle(info.name ?? "", feats);
        title.replaceChildren(name);
        title.title = info.name ?? "";
        const kids = [];
        kids.push(h("span", { class: "gx-live-dot" }), h("b", { text: fmt.full(info.playing ?? 0) }), h("span", { text: "playing now" }));
        if (info.rating != null) kids.push(h("span", { class: "gx-live-sep" }), ui.icon("like", 15), h("b", { text: info.rating + "%" }), h("span", { text: "like it" }));
        const g = genreOf(info);
        if (g) kids.push(h("span", { class: "gx-live-sep" }), h("span", { class: "gx-genre", text: g }));
        live.replaceChildren(...kids);
      },
      fail() {
        el.classList.add("is-failed");
        title.replaceChildren("Game not found");
        creator.replaceChildren();
        live.replaceChildren();
        icon.classList.remove("cer-sk");
        gallery.classList.remove("is-loading");
        gallery.classList.add("is-empty");
        playBtn.remove();
      },
      // Paid access / not playable: swap the Play button for the right action
      setPlayability(p, info) {
        if (!p || p.isPlayable) return;
        const s = p.playabilityStatus;
        if (s === "PurchaseRequired") {
          const buy = ui.button(info.price ? "Buy to play" : "Buy access", { icon: "robux", variant: "light", size: "lg", class: "gx-play", href: ui.nativeUrl(location.href) });
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
        note.replaceChildren(ui.icon("info", 15), h("span", { text: msg ?? p.unplayableDisplayText ?? "You may not be able to play this." }));
      },
      // Favorite / Like / Dislike / Notify. Real API writes, only on click.
      async wireSocial(me, U, info) {
        if (!me) return; // logged out: only Play + Share
        let fav = !!info.isFavoritedByUser;
        let favCount = info.favoritedCount ?? 0;
        let vote = null; // true up, false down, null none
        let up = info.up ?? 0;
        let down = info.down ?? 0;
        let canVote = true;
        let voteWhy = "";
        let following = false;
        let canFollow = true;

        const favBtn = ui.button("", { icon: "star", variant: "glass", size: "lg", class: "gx-pill gx-fav", title: "Favorite" });
        const upBtn = ui.button("", { icon: "like", variant: "glass", size: "lg", class: "gx-pill gx-up", title: "Like" });
        const downBtn = ui.button("", { icon: "dislike", variant: "glass", size: "lg", class: "gx-pill gx-down", title: "Dislike" });
        const bellBtn = ui.button("", { icon: "bell", variant: "glass", size: "lg", class: "gx-round gx-bell", title: "Get updates" });
        const voteBox = h("div", { class: "gx-vote" }, upBtn, h("span", { class: "gx-vote-split" }), downBtn);
        const setCount = (btn, n) => {
          let s = btn.querySelector(".gx-count");
          if (!s) btn.append((s = h("span", { class: "gx-count" })));
          s.textContent = fmt.num(n);
        };
        const paint = () => {
          favBtn.classList.toggle("is-on", fav);
          favBtn.title = fav ? "Remove from favorites" : "Add to favorites";
          setCount(favBtn, favCount);
          upBtn.classList.toggle("is-on", vote === true);
          downBtn.classList.toggle("is-on", vote === false);
          setCount(upBtn, up);
          setCount(downBtn, down);
          bellBtn.classList.toggle("is-on", following);
          bellBtn.title = following ? "Stop updates" : "Get updates";
        };
        paint();
        social.replaceChildren(favBtn, voteBox, bellBtn);

        // current states (reads only)
        const [favNow, voteNow, followNow] = await Promise.all([
          api.json(`https://games.roblox.com/v1/games/${U}/favorites`),
          api.json(`https://games.roblox.com/v1/games/${U}/votes/user`),
          api.json(`https://followings.roblox.com/v1/users/${me.id}/universes/${U}/status`),
        ]);
        if (favNow) fav = !!favNow.isFavorited;
        if (voteNow) {
          vote = voteNow.userVote ?? null;
          canVote = voteNow.canVote !== false;
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
          favCount += to ? 1 : -1;
          paint();
          CER.toast(to ? "Added to favorites" : "Removed from favorites");
        });
        const castVote = async (want) => {
          if (!canVote) {
            const why = /play/i.test(voteWhy) ? "Play this game first, then you can vote." : "You can not vote on this game yet.";
            return CER.toast(why);
          }
          const to = vote === want ? null : want;
          const btn = want ? upBtn : downBtn;
          btn.busy(true);
          const ok = await write(`https://games.roblox.com/v1/games/${U}/user-votes`, "PATCH", { vote: to }, { bgFirst: true });
          btn.busy(false);
          if (!ok) return CER.toast("Could not vote. Try again.", "error");
          if (vote === true) up--;
          if (vote === false) down--;
          if (to === true) up++;
          if (to === false) down++;
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
    return api_;
  }

  // Glass stat bar at the bottom of the hero
  function fillStats(bar, info) {
    const pct = info.rating;
    const tot = (info.up ?? 0) + (info.down ?? 0);
    const stat = (label, value, opts = {}) =>
      h("div", { class: "gx-stat" + (opts.cls ? " " + opts.cls : ""), title: opts.title ?? null }, h("span", { class: "gx-stat-label", text: label }), h("span", { class: "gx-stat-value" }, value), opts.extra);
    const ratingBar =
      tot > 0
        ? h(
            "span",
            { class: "gx-ratio", title: `${fmt.full(info.up)} likes, ${fmt.full(info.down)} dislikes` },
            h("span", { class: "gx-ratio-up", style: { width: pct + "%" } })
          )
        : null;
    bar.classList.remove("is-loading");
    bar.replaceChildren(
      stat("Playing", fmt.num(info.playing ?? 0), { title: fmt.full(info.playing), cls: "is-live" }),
      stat("Visits", fmt.num(info.visits), { title: fmt.full(info.visits) }),
      stat("Favorites", fmt.num(info.favoritedCount), { title: fmt.full(info.favoritedCount) }),
      stat("Rating", pct != null ? pct + "%" : "New", { extra: ratingBar, cls: "is-rating", title: tot ? `${fmt.full(info.up)} likes, ${fmt.full(info.down)} dislikes` : null }),
      stat("Server size", fmt.full(info.maxPlayers)),
      stat("Genre", genreOf(info) || "All"),
      stat("Created", fmt.date(info.created), { title: new Date(info.created).toLocaleString() }),
      stat("Updated", fmt.ago(info.updated), { title: new Date(info.updated).toLocaleString() })
    );
  }

  // ------------------------------------------------------------ play
  async function playNow(placeId) {
    const s = await CER.get();
    const region = s.joinPrefs?.region;
    if (region && region !== "auto" && CER.REGIONS?.[region]) return regionJoin(placeId, region, CER.REGIONS[region]);
    ui.play(placeId);
  }

  // Preferred-region join (background.js probes servers one at a time).
  // Ported from gameredesign.js: live progress, a clear "you are NOT in X"
  // on any failure, and always a way to just join normally.
  function regionJoin(placeId, region, regionName) {
    const status = h("p", { class: "gx-region-sub", text: "Checking servers 0/15" });
    const bar = h("div", { class: "gx-region-bar" }, h("span", { style: { width: "0%" } }));
    let port = null;
    let settled = false;
    const m = ui.modal({
      title: "Finding a " + regionName + " server",
      body: h("div", { class: "gx-region" }, status, bar),
      actions: [{ label: "Cancel", variant: "ghost", onClick: (close) => close() }],
      onClose: () => {
        settled = true;
        try {
          port?.disconnect();
        } catch {
          /* gone */
        }
      },
    });
    const fail = (titleText, subText) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      m.el.querySelector(".cer-modal-head h3").textContent = titleText;
      status.textContent = subText;
      bar.remove();
      const acts = m.el.querySelector(".cer-modal-actions");
      acts.replaceChildren(
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
    const timeout = setTimeout(() => fail("Search took too long", "You are NOT joining " + regionName + "."), 22000);
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
      else if (msg.error === "notfound" && msg.detected === 0) fail("Region check failed", "We could not read any server's region. You are NOT in " + regionName + ".");
      else fail("No " + regionName + " server", `Checked ${msg.probed || 15} servers. You are NOT joining ${regionName}.`);
    });
    port.postMessage({ cer: "start", placeId, region });
  }

  // ------------------------------------------------------------ About
  function buildAbout(pane, ctx) {
    const { info, universeId: U, placeId } = ctx;
    const desc = (info.description ?? "").trim();
    const aboutCard = ui.card([h("h2", { class: "gx-h2", text: "About this game" }), desc ? ui.clamp(desc, 8) : h("p", { class: "gx-muted", text: "No description yet." })], { class: "gx-about" });
    const links = h("div", { class: "gx-links" });
    const linksCard = ui.card([h("h2", { class: "gx-h2", text: "Links" }), links], { class: "gx-links-card" });
    linksCard.hidden = true;

    const row = (label, value, extra) => h("div", { class: "gx-dl-row" }, h("dt", { text: label }), h("dd", {}, value, extra));
    const copyBtn = (text, msg) => ui.button("", { icon: "copy", variant: "ghost", size: "sm", title: "Copy", class: "gx-copy", onClick: () => ui.copy(text, msg) });
    const details = ui.card(
      [
        h("h2", { class: "gx-h2", text: "Details" }),
        h(
          "dl",
          { class: "gx-dl" },
          row("Made by", h("a", { class: "gx-a", href: info.creator?.type === "Group" ? `https://www.roblox.com/communities/${info.creator.id}` : `https://www.roblox.com/users/${info.creator?.id}/profile`, text: info.creator?.name ?? "" })),
          row("Genre", genreOf(info) || "All"),
          row("Server size", fmt.full(info.maxPlayers) + " players"),
          avatarType(info.universeAvatarType) && row("Avatars", avatarType(info.universeAvatarType)),
          info.price ? row("Price", robux(info.price)) : null,
          row("Created", fmt.date(info.created)),
          row("Updated", h("span", { title: new Date(info.updated).toLocaleString(), text: fmt.date(info.updated) + " (" + fmt.ago(info.updated) + ")" })),
          row("Place ID", h("span", { class: "gx-mono", text: placeId }), copyBtn(placeId, "Place ID copied!")),
          row("Universe ID", h("span", { class: "gx-mono", text: U }), copyBtn(U, "Universe ID copied!"))
        ),
      ],
      { class: "gx-details" }
    );
    const friendsBox = ui.card([h("h2", { class: "gx-h2" }, h("span", { class: "gx-live-dot" }), "Friends here")], { class: "gx-friends-card" });
    friendsBox.hidden = true;
    pane.append(ui.cols([aboutCard, linksCard], [friendsBox, details], { side: 360 }));

    // social links (needs login on Roblox's side; just hide when it fails)
    api.json(`https://games.roblox.com/v1/games/${U}/social-links/list`, { ttl: 600000 }).then((j) => {
      const items = (j?.data ?? []).map((l) => ({ ...l, url: safeUrl(l.url) })).filter((l) => l.url);
      if (!items.length) return;
      links.replaceChildren(...items.map((l) => h("a", { class: "gx-link-pill", href: l.url, target: "_blank", rel: "noopener noreferrer" }, ui.icon("external", 15), h("span", { text: l.title || l.type || "Link" }))));
      linksCard.hidden = false;
    });

    friendsHere(ctx).then((list) => {
      if (!list.length) return;
      friendsBox.append(
        h(
          "div",
          { class: "gx-friends" },
          list.slice(0, 8).map(({ friend, presence }) => ui.userTile(friend, { row: true, presence, sub: "Playing now" }))
        ),
        list.length > 8 && ui.link(`See all ${list.length}`, { onClick: () => ctx.openTab("servers") })
      );
      friendsBox.hidden = false;
    });
  }

  // Friends in this game right now: [{ friend, presence }] (shared promise per page)
  function friendsHere(ctx) {
    if (ctx._friendsP) return ctx._friendsP;
    ctx._friendsP = (async () => {
      const me = await ctx.mePromise;
      if (!me) return [];
      const friends = await api.friends(me.id).catch(() => []);
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
  // Public server browser, ported from serverbrowser.js: sorting, filters,
  // locally tracked "first seen" age per place, join best / by id, plus
  // ping, fps, player headshots (when Roblox sends tokens) and friends first.
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
  const short = (ms) => {
    const m = Math.floor(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const hr = Math.floor(m / 60);
    if (hr < 24) return hr + " hr ago";
    return Math.floor(hr / 24) + " d ago";
  };

  // player token -> headshot url, batched through thumbnails/v1/batch
  const tokenCache = new Map();
  async function headshotsFor(tokens) {
    const need = tokens.filter((t) => !tokenCache.has(t));
    for (let i = 0; i < need.length; i += 100) {
      const chunk = need.slice(i, i + 100);
      const res = await api.json("https://thumbnails.roblox.com/v1/batch", {
        method: "POST",
        body: chunk.map((t) => ({ requestId: t, token: t, type: "AvatarHeadShot", size: "48x48", format: "webp", isCircular: true })),
      });
      for (const it of res?.data ?? []) if (it.imageUrl) tokenCache.set(it.requestId, it.imageUrl);
      for (const t of chunk) if (!tokenCache.has(t)) tokenCache.set(t, null);
    }
    return tokens.map((t) => tokenCache.get(t)).filter(Boolean);
  }

  function buildServers(pane, ctx) {
    const { placeId } = ctx;
    let servers = [];
    let seen = {};
    let hadHistory = false; // first visit: every server is "new", so don't say it
    let sort = "most";
    let filter = "all";
    let order = "Desc"; // API order: Desc = fullest first, Asc = emptiest first
    let shown = 12;
    let seq = 0;
    let more = false; // more pages exist beyond what we loaded
    let loading = false;
    let loaded = null;
    let friendJobs = new Map(); // jobId -> [{friend, presence}]

    const count = h("span", { class: "cer-block-count", hidden: true });
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
        // big games have thousands of servers: ask Roblox for the right end of the list
        const want = v === "least" || filter === "empty" ? "Asc" : "Desc";
        if (want !== order) {
          order = want;
          load();
        } else render();
      }
    );
    const filters = ui.chips(
      [
        { id: "all", label: "All servers" },
        { id: "empty", label: "Almost empty" },
        { id: "full", label: "Almost full" },
      ],
      filter,
      (v) => {
        filter = v;
        shown = 12;
        const want = sort === "least" || v === "empty" ? "Asc" : "Desc";
        if (want !== order) {
          order = want;
          load();
        } else render();
      }
    );
    const refresh = ui.button("", { icon: "refresh", variant: "soft", title: "Refresh", onClick: () => load() });
    const best = ui.button("Join best server", { icon: "zap", variant: "primary", onClick: () => joinBest() });

    const idInput = h("input", { class: "cer-input-el", placeholder: "Paste a server ID to join", spellcheck: "false", autocomplete: "off" });
    const idJoin = () => {
      const id = idInput.value.trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return CER.toast("That server ID does not look right.", "error");
      ui.play(placeId, id);
    };
    idInput.addEventListener("keydown", (e) => e.key === "Enter" && idJoin());
    const idRow = h("div", { class: "gx-idrow" }, h("label", { class: "cer-input gx-idinput" }, ui.icon("server", 17), idInput), ui.button("Join", { variant: "soft", onClick: idJoin }));

    const friendsSec = ui.section("Friends' servers", { icon: "users", class: "gx-friend-servers" });
    friendsSec.hidden = true;
    const privSec = h("div", { class: "gx-private-host" });
    const list = h("div", { class: "gx-servers" });
    const sentinel = h("div", { class: "gx-sentinel" });
    const footer = h("div", { class: "gx-servers-foot" });

    const head = h(
      "div",
      { class: "gx-sv-head" },
      h("h2", { class: "cer-block-title" }, ui.icon("server", 20), h("span", { text: "Servers" }), count),
      h("div", { class: "gx-sv-tools" }, sortSel, refresh, best)
    );
    pane.append(friendsSec, privSec, h("section", { class: "cer-block" }, head, h("div", { class: "gx-sv-bar" }, filters, idRow), list, footer, sentinel));

    // auto "show more" when the bottom comes into view
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting) && !pane.hidden && servers.length && shown < filtered().length) {
          shown += 12;
          render();
        }
      },
      { rootMargin: "400px" }
    );
    io.observe(sentinel);
    onCleanup(() => io.disconnect());

    function filtered() {
      let rows = servers.slice();
      if (filter === "empty") rows = rows.filter((s) => s.playing <= Math.max(1, s.maxPlayers * 0.25));
      else if (filter === "full") rows = rows.filter((s) => s.playing >= s.maxPlayers * 0.75 && s.playing < s.maxPlayers);
      const age = (s) => seen[s.id] ?? Date.now();
      if (sort === "most") rows.sort((a, b) => b.playing - a.playing);
      else if (sort === "least") rows.sort((a, b) => a.playing - b.playing);
      else if (sort === "ping") rows.sort((a, b) => (a.ping ?? 9999) - (b.ping ?? 9999));
      else if (sort === "newest") rows.sort((a, b) => age(b) - age(a));
      else if (sort === "oldest") rows.sort((a, b) => age(a) - age(b));
      return rows;
    }

    function render() {
      if (!servers.length) return;
      const rows = filtered();
      count.hidden = false;
      count.textContent = fmt.num(servers.length) + (more ? "+" : "");
      if (!rows.length) {
        list.replaceChildren(ui.empty("No servers match. Try another filter.", { icon: "filter" }));
        footer.replaceChildren();
        return;
      }
      const visible = rows.slice(0, shown);
      list.replaceChildren(...visible.map(serverCard));
      footer.replaceChildren(
        shown < rows.length
          ? ui.button(`Show more (${fmt.full(rows.length - shown)})`, { variant: "soft", onClick: () => ((shown += 12), render()) })
          : h("span", { class: "gx-muted", text: loading ? "Loading more servers..." : `That is all ${fmt.full(rows.length)}.` })
      );
      fillHeads(visible);
    }

    async function fillHeads(visible) {
      const want = visible.filter((s) => s.playerTokens?.length);
      if (!want.length) return;
      await headshotsFor(want.flatMap((s) => s.playerTokens.slice(0, 6)));
      for (const s of want) {
        const host = list.querySelector(`[data-job="${s.id}"] .gx-heads`);
        if (!host) continue;
        const urls = s.playerTokens.slice(0, 6).map((t) => tokenCache.get(t)).filter(Boolean);
        host.replaceChildren(...urls.map((u) => h("span", { class: "gx-head" }, ui.img(u, { alt: "" }))), s.playing > urls.length && h("span", { class: "gx-head is-more", text: "+" + (s.playing - urls.length) }));
      }
    }

    function serverCard(s, opts = {}) {
      const pct = s.maxPlayers > 0 ? Math.min(100, Math.round((s.playing / s.maxPlayers) * 100)) : 0;
      const full = s.playing >= s.maxPlayers;
      const ping = s.ping != null ? Math.round(s.ping) : null;
      const tone = ping == null ? "" : ping <= 90 ? "good" : ping <= 180 ? "warn" : "bad";
      const friendsIn = opts.friends ?? friendJobs.get(s.id);
      const join = ui.button(full ? "Full" : "Join", { variant: full ? "soft" : "primary", size: "sm", icon: full ? null : "play", disabled: full, onClick: () => ui.play(placeId, s.id) });
      const copy = ui.button("", { icon: "copy", variant: "ghost", size: "sm", title: "Copy server ID", onClick: () => ui.copy(s.id, "Server ID copied!") });
      const heads = h("div", { class: "gx-heads" });
      if (friendsIn?.length) heads.append(...friendsIn.slice(0, 6).map(({ friend }) => h("a", { class: "gx-head is-friend", href: `https://www.roblox.com/users/${friend.id}/profile`, title: friend.displayName }, ui.thumb("headshot", friend.id, { alt: "" }))));
      return h(
        "div",
        { class: "gx-server" + (full ? " is-full" : "") + (friendsIn?.length ? " has-friends" : ""), "data-job": s.id },
        h(
          "div",
          { class: "gx-sv-top" },
          h("div", { class: "gx-sv-count" }, h("b", { text: s.playing ?? "?" }), h("span", { text: " / " + (s.maxPlayers ?? "?") })),
          h(
            "div",
            { class: "gx-sv-pills" },
            ping != null && h("span", { class: "gx-sv-pill is-" + tone, title: "Server ping" }, h("i", { class: "gx-signal" }), ping + " ms"),
            s.fps != null && h("span", { class: "gx-sv-pill", title: "Server speed" }, Math.round(s.fps) + " fps")
          )
        ),
        h("div", { class: "gx-sv-bar-track" }, h("span", { class: "gx-sv-fill", style: { width: pct + "%" } })),
        heads,
        h(
          "div",
          { class: "gx-sv-foot" },
          friendsIn?.length
            ? h("span", { class: "gx-sv-age" }, ui.icon("users", 14), friendsIn.map((x) => x.friend.displayName).slice(0, 2).join(", ") + (friendsIn.length > 2 ? ` +${friendsIn.length - 2}` : ""))
            : seen[s.id]
              ? h("span", { class: "gx-sv-age", title: "When you first saw this server" }, ui.icon("clock", 14), "Seen " + short(Date.now() - seen[s.id]))
              : h("span", { class: "gx-sv-age", title: "A server you have not seen before" }, hadHistory && h("span", { class: "gx-new", text: "New" })),
          copy,
          join
        )
      );
    }

    function hint(node) {
      list.replaceChildren(node);
      footer.replaceChildren();
    }

    // Page 1 renders as soon as it lands; up to 5 pages (500 servers) keep
    // loading in the background so sorting means something. Refresh cancels.
    function load() {
      const my = ++seq;
      loading = true;
      loaded = (async () => {
        shown = 12;
        servers = [];
        more = false;
        count.hidden = true;
        list.replaceChildren(...ui.skeleton("row", 10).map((x) => (x.classList.add("gx-sv-sk"), x)));
        footer.replaceChildren();
        seen = await readSeen(placeId);
        hadHistory = Object.keys(seen).length > 0;
        let cursor = "";
        for (let pg = 0; pg < 5; pg++) {
          if (my !== seq) return;
          const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&excludeFullGames=true&sortOrder=${order}${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`;
          let res = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            res = await fetch(url, { credentials: "include" }).catch(() => null);
            if (res?.status !== 429 || pg === 0) break;
            await api.sleep(2000);
          }
          if (my !== seq) return;
          if (!res || !res.ok) {
            if (pg === 0) {
              loading = false;
              hint(ui.empty(res?.status === 429 ? "Too many tries. Wait a moment." : "Servers did not load.", { icon: "server", action: ui.button("Try again", { variant: "soft", onClick: () => load() }) }));
              return;
            }
            more = true;
            break;
          }
          const body = await res.json().catch(() => null);
          if (!body?.data) break;
          const known = new Set(servers.map((s) => s.id));
          servers = servers.concat(body.data.filter((s) => !known.has(s.id)));
          cursor = body.nextPageCursor;
          more = !!cursor && pg === 4;
          if (!cursor) loading = false;
          render();
          if (!cursor) break;
          await api.sleep(250);
        }
        loading = false;
        if (my !== seq) return;
        if (!servers.length) {
          hint(ui.empty("Nobody is playing right now. Press Play to start a server!", { icon: "server" }));
          return;
        }
        render();
        const fresh = await markSeen(placeId, servers.map((s) => s.id));
        if (fresh && my === seq) {
          seen = fresh;
          render();
        }
      })();
      return loaded;
    }

    async function joinBest() {
      if (!loaded) load();
      best.busy(true);
      await loaded;
      best.busy(false);
      const settings = await CER.get();
      let open = servers.filter((s) => s.playing < s.maxPlayers);
      if (settings.joinPrefs?.avoidFriends && friendJobs.size) {
        const away = open.filter((s) => !friendJobs.has(s.id));
        if (away.length) open = away;
      }
      if (!open.length) return ui.play(placeId); // nothing open: let Roblox pick or start one
      // fullest server that still has room, then the lowest ping
      open.sort((a, b) => b.playing / b.maxPlayers - a.playing / a.maxPlayers || (a.ping ?? 999) - (b.ping ?? 999));
      ui.play(placeId, open[0].id);
    }

    // friends first: their servers from presence (jobId = presence.gameId)
    friendsHere(ctx).then((list_) => {
      friendJobs = new Map();
      for (const x of list_) {
        if (!x.presence.gameId || String(x.presence.placeId) !== String(placeId)) continue;
        if (!friendJobs.has(x.presence.gameId)) friendJobs.set(x.presence.gameId, []);
        friendJobs.get(x.presence.gameId).push(x);
      }
      if (!friendJobs.size) return;
      const cards = [...friendJobs.entries()].map(([job, fr]) => {
        const s = servers.find((x) => x.id === job) ?? { id: job, playing: null, maxPlayers: ctx.info.maxPlayers };
        return serverCard(s, { friends: fr });
      });
      friendsSec.body.append(h("div", { class: "gx-servers" }, cards));
      friendsSec.hidden = false;
      render();
    });

    // private servers, only when the game allows them
    buildPrivate(privSec, ctx);

    load();
  }

  // Private (VIP) servers: only shown when the game has them. Buying,
  // creating and settings stay on Roblox's own page (ui.nativeUrl).
  async function buildPrivate(host, ctx) {
    const { placeId, universeId: U } = ctx;
    const me = await ctx.mePromise;
    const [enabled, mine] = await Promise.all([
      api.json(`https://games.roblox.com/v1/private-servers/enabled-in-universe/${U}`, { ttl: 600000 }),
      me ? api.json(`https://games.roblox.com/v1/games/${placeId}/private-servers?limit=25`) : null,
    ]);
    const rows = mine?.data ?? [];
    if (!enabled?.privateServersEnabled && !ctx.info.createVipServersAllowed && !rows.length) return;
    ctx.hasPrivate = true;
    const native = ui.nativeUrl(`https://www.roblox.com/games/${placeId}#!/game-instances`);
    const card = h(
      "div",
      { class: "gx-private" },
      h("span", { class: "gx-private-icon" }, ui.icon("lock", 22)),
      h("div", { class: "gx-private-text" }, h("b", { text: "Private servers" }), h("span", { text: "Play with only the people you pick." })),
      ui.button(rows.length ? "Manage" : "Get one", { icon: "external", variant: "soft", href: native })
    );
    const body = h(
      "div",
      { class: "gx-private-list" },
      rows.map((s) =>
        h(
          "a",
          { class: "gx-private-row", href: native },
          s.owner?.id ? ui.avatar(s.owner.id, { size: 36 }) : h("span", { class: "gx-private-icon is-sm" }, ui.icon("lock", 16)),
          h("span", { class: "gx-private-name" }, h("b", { text: s.name || "Private server" }), h("span", { text: s.owner?.displayName ? "By " + s.owner.displayName : "" })),
          h("span", { class: "gx-muted", text: s.playing ? `${s.playing} / ${s.maxPlayers} playing` : "Nobody inside" }),
          ui.icon("right", 16)
        )
      )
    );
    host.append(h("section", { class: "cer-block" }, card, body));
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
          // older endpoint (background: its CORS refuses the page)
          if (token) return null;
          const old = await api.json(`https://games.roblox.com/v1/games/${U}/game-passes?limit=100&sortOrder=Asc`, { ttl: 120000, bg: true });
          if (!old?.data) return null;
          return { items: old.data.map((p) => ({ id: p.id, name: p.name, displayName: p.displayName ?? p.name, price: p.price, isForSale: p.price != null, isOwned: false })), next: null };
        })()
      );
    return passCache.get(key);
  }
  function buildStore(pane, ctx) {
    const sec = ui.section("Game passes", { icon: "ticket", sub: "Extra powers and items for this game." });
    const grid = ui.grid([], { min: 190, gap: 16, class: "gx-passes" });
    grid.append(...ui.skeleton("card", 6));
    const foot = h("div", { class: "gx-servers-foot" });
    sec.body.append(grid, foot);
    pane.append(sec);
    let first = true;
    const page_ = async (token) => {
      const r = await loadPasses(ctx.universeId, token);
      if (first) grid.replaceChildren();
      first = false;
      if (!r) {
        if (!grid.children.length) sec.body.replaceChildren(ui.empty("The store did not load.", { icon: "bag" }));
        return;
      }
      if (!r.items.length && !grid.children.length) {
        sec.body.replaceChildren(ui.empty("This game has no passes.", { icon: "ticket" }));
        return;
      }
      grid.append(...r.items.map(passCard));
      foot.replaceChildren(r.next ? ui.button("Show more", { variant: "soft", onClick: (e) => (e.currentTarget.busy?.(true), page_(r.next)) }) : "");
    };
    page_("");
  }
  function passCard(p) {
    const forSale = p.isForSale !== false && p.price != null;
    const base = p.userBasePriceInRobux && p.userBasePriceInRobux > p.price ? p.userBasePriceInRobux : null;
    return h(
      "a",
      { class: "gx-pass", href: `https://www.roblox.com/game-pass/${p.id}`, title: p.displayName ?? p.name },
      h("div", { class: "gx-pass-art" }, ui.thumb("pass", p.id, { alt: "" }), p.isOwned && h("span", { class: "gx-owned" }, ui.icon("check", 13), "Owned")),
      h("div", { class: "gx-pass-name", text: p.displayName ?? p.name }),
      h(
        "div",
        { class: "gx-pass-price" },
        forSale ? robux(p.price) : h("span", { class: "gx-muted", text: "Not for sale" }),
        forSale && base && h("s", { class: "gx-muted", text: fmt.full(base) })
      )
    );
  }

  // ------------------------------------------------------------ Badges
  const badgeCache = new Map();
  function loadBadges(U, cursor = "") {
    const key = U + "|" + cursor;
    if (!badgeCache.has(key))
      badgeCache.set(
        key,
        api.json(`https://badges.roblox.com/v1/universes/${U}/badges?limit=50&sortOrder=Asc${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, { ttl: 300000 }).then((j) => (j?.data ? { items: j.data, next: j.nextPageCursor || null } : null))
      );
    return badgeCache.get(key);
  }
  const difficulty = (r) => {
    if (r == null) return ["", "plain"];
    if (r >= 0.9) return ["Super easy", "good"];
    if (r >= 0.5) return ["Easy", "good"];
    if (r >= 0.2) return ["Medium", "accent"];
    if (r >= 0.05) return ["Hard", "warn"];
    if (r >= 0.01) return ["Very hard", "bad"];
    return ["Super rare", "bad"];
  };
  function buildBadges(pane, ctx) {
    const sec = ui.section("Badges", { icon: "medal", sub: "Win these by playing." });
    const list = h("div", { class: "gx-badges" }, ui.skeleton("row", 6));
    const foot = h("div", { class: "gx-servers-foot" });
    sec.body.append(list, foot);
    pane.append(sec);
    let first = true;
    let ownedTotal = 0;
    const ownedTag = h("span", { class: "cer-block-count", hidden: true });
    sec.head.querySelector(".cer-block-title").append(ownedTag);
    const page_ = async (cursor) => {
      const r = await loadBadges(ctx.universeId, cursor);
      if (first) list.replaceChildren();
      first = false;
      if (!r) {
        if (!list.children.length) sec.body.replaceChildren(ui.empty("Badges did not load.", { icon: "medal" }));
        return;
      }
      if (!r.items.length && !list.children.length) {
        sec.body.replaceChildren(ui.empty("This game has no badges.", { icon: "medal" }));
        return;
      }
      const cards = r.items.map(badgeCard);
      list.append(...cards);
      foot.replaceChildren(r.next ? ui.button("Show more", { variant: "soft", onClick: (e) => (e.currentTarget.busy?.(true), page_(r.next)) }) : "");
      // which of these you own: one call per 50 badges
      const me = await ctx.mePromise;
      if (!me) return;
      const ids = r.items.map((b) => b.id);
      const own = await api.json(`https://badges.roblox.com/v1/users/${me.id}/badges/awarded-dates?badgeIds=${ids.join(",")}`);
      for (const o of own?.data ?? []) {
        const el = list.querySelector(`[data-badge="${o.badgeId}"]`);
        if (!el) continue;
        el.classList.add("is-owned");
        el.querySelector(".gx-badge-tags").prepend(h("span", { class: "cer-badge is-good", title: new Date(o.awardedDate).toLocaleString() }, ui.icon("check", 13), h("span", { text: "You have it" })));
        ownedTotal++;
      }
      if (ownedTotal) {
        ownedTag.hidden = false;
        ownedTag.textContent = `${ownedTotal} owned`;
      }
    };
    page_("");
  }
  function badgeCard(b) {
    const r = b.statistics?.winRatePercentage;
    const [label, tone] = difficulty(r);
    const pct = r == null ? "" : r * 100 < 0.1 ? "<0.1%" : (r * 100).toFixed(r * 100 < 10 ? 1 : 0) + "%";
    return h(
      "a",
      { class: "gx-badge" + (b.enabled === false ? " is-off" : ""), href: `https://www.roblox.com/badges/${b.id}`, "data-badge": b.id, title: b.displayName ?? b.name },
      h("div", { class: "gx-badge-art" }, ui.thumb("badge", b.id, { alt: "" })),
      h(
        "div",
        { class: "gx-badge-main" },
        h("div", { class: "gx-badge-name", text: b.displayName ?? b.name }),
        (b.displayDescription ?? b.description) && h("div", { class: "gx-badge-desc", text: b.displayDescription ?? b.description }),
        h(
          "div",
          { class: "gx-badge-tags" },
          label && h("span", { class: "cer-badge is-" + tone, title: "Players who won it" }, h("span", { text: `${label} · ${pct}` })),
          b.statistics?.awardedCount != null && h("span", { class: "gx-muted", text: fmt.num(b.statistics.awardedCount) + " won" }),
          b.statistics?.pastDayAwardedCount ? h("span", { class: "gx-muted", text: fmt.num(b.statistics.pastDayAwardedCount) + " today" }) : null,
          b.enabled === false && h("span", { class: "cer-badge", text: "Turned off" })
        )
      )
    );
  }

  // ------------------------------------------------------------ More like this
  function buildMore(pane, ctx) {
    const { info } = ctx;
    const card = (g, sub) => ui.gameCard(g, { features: ctx.feats, sub });
    const recSec = ui.section("More like this", { icon: "sparkle", sub: "Games people also play." });
    const recGrid = ui.grid(ui.skeleton("card", 8), { min: 220, gap: 18 });
    recSec.body.append(recGrid);
    const c = info.creator ?? {};
    const byGroup = c.type === "Group";
    const makerSec = ui.section("More from " + (c.name ?? "this maker"), {
      icon: byGroup ? "users" : "user",
      action: { label: "See maker", href: byGroup ? `https://www.roblox.com/communities/${c.id}` : `https://www.roblox.com/users/${c.id}/profile` },
    });
    const makerGrid = ui.grid(ui.skeleton("card", 4), { min: 220, gap: 18 });
    makerSec.body.append(makerGrid);
    pane.append(recSec, makerSec);

    // Roblox's picks (this endpoint sometimes answers with an empty list)
    const recP = api.json(`https://games.roblox.com/v1/games/recommendations/game/${ctx.universeId}?maxRows=12`, { ttl: 600000 }).then((j) => {
      const games = (j?.games ?? []).filter((g) => String(g.universeId) !== ctx.universeId);
      if (!games.length) return (recSec.hidden = true), 0;
      recGrid.replaceChildren(...games.map((g) => card({ placeId: g.placeId, universeId: g.universeId, name: g.name, playing: g.playerCount, rating: fmt.pct(g.totalUpVotes, g.totalDownVotes) }, g.creatorName)));
      return games.length;
    });

    // the maker's other public games, busiest first
    const listUrl = byGroup
      ? `https://games.roblox.com/v2/groups/${c.id}/gamesV2?accessFilter=Public&limit=50&sortOrder=Desc`
      : `https://games.roblox.com/v2/users/${c.id}/games?accessFilter=Public&limit=50&sortOrder=Desc`;
    const makerP = (c.id ? api.json(listUrl, { ttl: 600000 }) : Promise.resolve(null)).then(async (j) => {
      const games = (j?.data ?? []).filter((g) => String(g.id) !== ctx.universeId).map((g) => ({ universeId: g.id, placeId: g.rootPlace?.id, name: g.name, visits: g.placeVisits }));
      if (!games.length) return (makerSec.hidden = true), 0;
      await ui.hydrateGames(games);
      games.sort((a, b) => (b.playing ?? 0) - (a.playing ?? 0) || (b.visits ?? 0) - (a.visits ?? 0));
      makerGrid.replaceChildren(...games.slice(0, 12).map((g) => card(g)));
      return games.length;
    });

    Promise.all([recP, makerP]).then(([a, b]) => {
      if (!a && !b) pane.append(ui.empty("No other games to show yet.", { icon: "sparkle" }));
    });
  }
})();
