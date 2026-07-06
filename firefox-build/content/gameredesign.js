// Game page redesign (beta) — a full hero takeover modeled on the home
// profile card: big thumbnail banner, game icon + title + creator row with
// the Play button on the right, stat chips, an Expand bar revealing the
// description, and Roblox's native About/Store/Servers tabs (restyled as
// pills) kept below for full functionality.

(async function () {
  if (typeof CER === "undefined") return;
  const settings = await CER.get();
  if (!settings.features.gamePageRedesign) return;

  const placeId = location.pathname.match(/\/games\/(\d+)/)?.[1];
  if (!placeId) return;

  document.body.classList.add("cer-game-redesign");

  let universeId = document.querySelector("#game-detail-meta-data")?.dataset?.universeId;
  if (!universeId) {
    try {
      const res = await fetch("https://apis.roblox.com/universes/v1/places/" + placeId + "/universe");
      universeId = String((await res.json()).universeId);
    } catch {
      return;
    }
  }

  // all the data the hero needs, in parallel
  const j = (url) => fetch(url, { credentials: "include" }).then((r) => r.json()).catch(() => null);
  const [infoRes, votesRes, thumbs, icons] = await Promise.all([
    j("https://games.roblox.com/v1/games?universeIds=" + universeId),
    j("https://games.roblox.com/v1/games/votes?universeIds=" + universeId),
    CER.getGameThumbs([universeId]),
    CER.getGameIcons([universeId]),
  ]);
  const info = infoRes?.data?.[0];
  if (!info) return;
  const votes = votesRes?.data?.[0];
  const votesPct =
    votes && votes.upVotes + votes.downVotes > 0
      ? Math.round((votes.upVotes / (votes.upVotes + votes.downVotes)) * 100)
      : null;

  // native top area: the row holding the media carousel + info column
  const titleBox = await CER.waitFor(() => document.querySelector(".game-title-container"), 20000).catch(() => null);
  if (!titleBox) return;
  const infoCol = titleBox.parentElement;
  let topRow = infoCol?.parentElement;
  // never hide a container that holds the tab strip OR the tab panes —
  // hiding the panes made the tabs look dead (they switched invisibly)
  if (topRow?.querySelector(".rbx-tabs-horizontal, .tab-content")) topRow = null;

  // ---- hero ----

  const hero = CER.el("div", "cer-profile cer-gp-hero");

  const banner = CER.el("div", "cer-profile-banner cer-gp-banner");
  if (thumbs[universeId]) banner.style.backgroundImage = `url("${thumbs[universeId]}")`;
  hero.appendChild(banner);

  const row = CER.el("div", "cer-profile-row");
  const iconImg = CER.el("img", "cer-gp-icon");
  iconImg.src = icons[universeId] ?? "";
  iconImg.alt = info.name;
  row.appendChild(iconImg);

  const names = CER.el("div", "cer-profile-names");
  names.appendChild(CER.el("div", "cer-profile-display", CER.cleanTitle(info.name, settings.features)));
  const creatorLink = CER.el("a", "cer-profile-user");
  creatorLink.textContent = "By " + (info.creator?.name ?? "unknown");
  creatorLink.href =
    info.creator?.type === "Group"
      ? "https://www.roblox.com/communities/" + info.creator.id
      : "https://www.roblox.com/users/" + (info.creator?.id ?? "") + "/profile";
  names.appendChild(creatorLink);
  row.appendChild(names);

  const actions = CER.el("div", "cer-profile-actions");
  const play = CER.el("button", "btn-common-play-game-lg btn-primary-md cer-gp-play");
  play.appendChild(CER.el("span", "icon-common-play"));
  // launch via Roblox's own GameLauncher only (the extra roblox:// deep link
  // opened the app a SECOND time)
  const normalJoin = () => window.postMessage({ cer: "join-multiplayer", placeId }, location.origin);
  const joinInstance = (jobId) => window.postMessage({ cer: "join-instance", placeId, jobId }, location.origin);

  play.addEventListener("click", async () => {
    const settings = await CER.get();
    const region = settings.joinPrefs?.region;
    if (!region || region === "auto" || !CER.REGIONS?.[region]) return normalJoin();
    regionSearchModal(region, CER.REGIONS[region]);
  });

  // Centered, blocking modal that shows live search progress (0/15, 1/15, ...)
  // and, on failure, makes it clear you are NOT joining the chosen region.
  function regionSearchModal(region, regionName) {
    const backdrop = CER.el("div", "cer-update-backdrop");
    const pop = CER.el("div", "cer-update-pop");
    const title = CER.el("div", "cer-update-title", "Finding a " + regionName + " server");
    const sub = CER.el("div", "cer-update-sub", "Checking servers 0/15");
    pop.append(title, sub);
    backdrop.appendChild(pop);
    document.body.appendChild(backdrop);

    let port = null;
    try { port = CER.ext.runtime.connect({ name: "region-join" }); } catch {}
    if (!port) { backdrop.remove(); return normalJoin(); }

    port.onMessage.addListener((m) => {
      if (m.progress != null) {
        sub.textContent = "Checking servers " + m.progress + "/" + (m.total || 15);
        return;
      }
      if (!m.done) return;
      if (m.ok && m.jobId) {
        title.textContent = "Joining a " + regionName + " server";
        sub.textContent = "Opening Roblox";
        joinInstance(m.jobId);
        setTimeout(() => backdrop.remove(), 1600);
      } else if (m.error === "empty") {
        backdrop.remove();
        normalJoin(); // game has no servers at all — just start one
      } else {
        const probeBroken = m.error === "notfound" && m.detected === 0;
        title.textContent = probeBroken ? "Region check failed" : "No " + regionName + " server found";
        sub.textContent =
          m.error === "cooldown"
            ? "Too many searches. Wait a few minutes. You are NOT in " + regionName + "."
            : probeBroken
            ? "Couldn't read any server's region. The region probe returned nothing (tell the developer)."
            : "Checked " + (m.probed || 15) + " servers, none in " + regionName + ". You are NOT joining " + regionName + ".";
        const actions = CER.el("div", "cer-update-actions");
        const anyway = CER.el("button", "cer-update-btn cer-update-go", "Join a normal server");
        anyway.addEventListener("click", () => { backdrop.remove(); normalJoin(); });
        const cancel = CER.el("button", "cer-update-btn cer-update-cancel cer-update-cancel-ready", "Cancel");
        cancel.addEventListener("click", () => backdrop.remove());
        actions.append(anyway, cancel);
        pop.appendChild(actions);
      }
    });
    port.postMessage({ cer: "start", placeId, region });
  }
  const gear = CER.el("button", "btn-common-play-game-lg btn-primary-md cer-join-btn");
  gear.title = "Join options";
  gear.appendChild(CER.gearIcon());
  gear.addEventListener("click", () => CER.openSettings?.("Join"));
  actions.appendChild(play);
  actions.appendChild(gear);
  row.appendChild(actions);
  hero.appendChild(row);

  // stat chips
  const chips = CER.el("div", "cer-gp-chips");
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : "—");
  const stats = [
    [fmt(info.playing), "Active"],
    [votesPct != null ? votesPct + "%" : "—", "Rating"],
    [fmt(info.visits), "Visits"],
    [fmt(info.favoritedCount), "Favorites"],
    [fmt(info.maxPlayers), "Server Size"],
  ];
  if (info.genre && info.genre !== "All") stats.push([info.genre, "Genre"]);
  for (const [value, label] of stats) {
    const chip = CER.el("span", "cer-gp-chip");
    chip.appendChild(CER.el("b", "", String(value)));
    chip.appendChild(CER.el("span", "", " " + label));
    chips.appendChild(chip);
  }
  hero.appendChild(chips);

  // Favorite / Like / Dislike / Notify. Clean custom buttons that proxy-click
  // Roblox's own controls (kept off-screen), so all the voting and favoriting
  // logic stays native — lifting the native bar itself rendered as a broken
  // black strip, and the vote write API rejects the page's CORS preflight.
  const fmtVotes = (n) =>
    n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n || 0);
  const up = votes?.upVotes ?? 0;
  const down = votes?.downVotes ?? 0;

  // stroke SVG icons that fill + turn the button accent when active
  const svgIcon = (paths) =>
    `<svg class="cer-gp-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const IC = {
    star: svgIcon('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>'),
    up: svgIcon('<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>'),
    down: svgIcon('<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>'),
    bell: svgIcon('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  };

  const social = CER.el("div", "cer-gp-social2");
  const favBtn = CER.el("button", "cer-gp-sbtn cer-gp-fav");
  favBtn.innerHTML = `<span class="cer-gp-sicon">${IC.star}</span><span class="cer-gp-slabel">Favorite</span>`;
  const likeBtn = CER.el("button", "cer-gp-sbtn cer-gp-like");
  likeBtn.innerHTML = `<span class="cer-gp-sicon">${IC.up}</span><span>${fmtVotes(up)}</span>`;
  const dislikeBtn = CER.el("button", "cer-gp-sbtn cer-gp-dislike");
  dislikeBtn.innerHTML = `<span class="cer-gp-sicon">${IC.down}</span><span>${fmtVotes(down)}</span>`;
  const notifyBtn = CER.el("button", "cer-gp-sbtn cer-gp-notify");
  notifyBtn.innerHTML = `<span class="cer-gp-sicon">${IC.bell}</span><span>Notify</span>`;
  const ratio = CER.el("div", "cer-gp-ratio");
  const pct = up + down > 0 ? Math.round((up / (up + down)) * 100) : 0;
  ratio.innerHTML = `<div class="cer-gp-ratio-fill" style="width:${pct}%"></div>`;
  ratio.title = pct + "% liked";
  social.append(favBtn, likeBtn, dislikeBtn, ratio, notifyBtn);
  hero.appendChild(social);

  // stash Roblox's real controls off-screen and proxy every click through them
  const nativeHost = CER.el("div", "cer-gp-native-hide");
  hero.appendChild(nativeHost);
  const clickNative = (sel) =>
    (nativeHost.querySelector(sel) || document.querySelector(".favorite-follow-vote-share " + sel))?.click();
  CER.waitFor(() => document.querySelector(".favorite-follow-vote-share"), 15000)
    .then((bar) => bar && nativeHost.appendChild(bar))
    .catch(() => {});

  // .cer-gp-on = filled icon + accent button
  favBtn.addEventListener("click", () => {
    clickNative(".favorite-button");
    const on = favBtn.classList.toggle("cer-gp-on");
    favBtn.querySelector(".cer-gp-slabel").textContent = on ? "Favorited" : "Favorite";
  });
  likeBtn.addEventListener("click", () => {
    clickNative(".upvote");
    if (likeBtn.classList.toggle("cer-gp-on")) dislikeBtn.classList.remove("cer-gp-on");
  });
  dislikeBtn.addEventListener("click", () => {
    clickNative(".downvote");
    if (dislikeBtn.classList.toggle("cer-gp-on")) likeBtn.classList.remove("cer-gp-on");
  });
  notifyBtn.addEventListener("click", () => {
    clickNative(".game-follow-button-container .foundation-web-button, .game-follow-button-container [role='button'], .game-follow-button-container button, .game-follow-button-container");
    notifyBtn.classList.toggle("cer-gp-on");
  });

  // initial active states — favorite from the API (reliable); like/dislike/notify
  // from Roblox's own controls once they render (best-effort)
  fetch(`https://games.roblox.com/v1/games/${universeId}/favorites`, { credentials: "include" })
    .then((r) => r.json())
    .then((d) => {
      if (d?.isFavorited) {
        favBtn.classList.add("cer-gp-on");
        favBtn.querySelector(".cer-gp-slabel").textContent = "Favorited";
      }
    })
    .catch(() => {});
  CER.waitFor(() => nativeHost.querySelector(".voting-panel, .game-follow-button-container"), 15000)
    .then(() => {
      if (nativeHost.querySelector(".upvote.selected, .upvote.active, .upvote.voted, .upvote [class*='selected']")) likeBtn.classList.add("cer-gp-on");
      if (nativeHost.querySelector(".downvote.selected, .downvote.active, .downvote.voted, .downvote [class*='selected']")) dislikeBtn.classList.add("cer-gp-on");
      if (/notifying|following/i.test(nativeHost.querySelector(".game-follow-button-container")?.textContent || "")) notifyBtn.classList.add("cer-gp-on");
    })
    .catch(() => {});

  // relative timestamps ("5 hours ago") for the Created / Updated pills
  function relTime(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    for (const [sec, name] of [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]]) {
      const v = Math.floor(s / sec);
      if (v >= 1) return v + " " + name + (v > 1 ? "s" : "") + " ago";
    }
    return "just now";
  }
  // Created / Updated shown as pills that sit inline with the tab pills below
  // (no Expand bar, no duplicate description, no copy-ID clutter).
  const datePills = CER.el("div", "cer-gp-datepills");
  for (const [iso, label] of [
    [info.updated, "updated"],
    [info.created, "created"],
  ]) {
    if (!iso) continue;
    const chip = CER.el("span", "cer-gp-datepill");
    chip.title = new Date(iso).toLocaleString();
    chip.textContent = relTime(iso) + " " + label;
    datePills.appendChild(chip);
  }

  // ---- swap it in ----

  if (topRow) {
    topRow.parentElement.insertBefore(hero, topRow);
    topRow.style.display = "none";
  } else {
    infoCol.parentElement.insertBefore(hero, infoCol);
    infoCol.style.display = "none";
    const media = document.querySelector('[class*="carousel"], [class*="game-media"]');
    if (media && !media.contains(hero)) media.style.display = "none";
  }

  // native description would be a duplicate now
  const nativeDesc = document.querySelector('[class*="game-description"], .description-content');
  if (nativeDesc) nativeDesc.closest(".section-content")?.classList.add("cer-native-desc-hidden");

  // ---- our pill tab bar (About / Store / Servers / Events) ----
  // Native panes keep working — the native tab strip is hidden and switched
  // through the URL hash it already listens to.

  function findSectionByHeading(re) {
    const h = [...document.querySelectorAll("h1, h2, h3")].find((e) => re.test(e.textContent.trim()));
    if (!h) return null;
    let el = h;
    for (let i = 0; i < 3 && el.parentElement; i++) {
      if (el.parentElement.querySelectorAll("h1, h2, h3").length > 1 && i > 0) break;
      el = el.parentElement;
    }
    return el;
  }

  // tab bar row: pills on the left, the created/updated date pills on the right
  const tabRow = CER.el("div", "cer-gp-tabrow");
  const tabBar = CER.el("div", "cer-gp-tabs");
  tabRow.appendChild(tabBar);
  tabRow.appendChild(datePills);
  hero.insertAdjacentElement("afterend", tabRow);

  // switching tabs = clicking the real (hidden) native tab link — the hash
  // alone doesn't wake their router
  function clickNativeTab(key) {
    const link =
      document.querySelector(`#tab-${key} a, li[id*="${key}"] a`) ??
      [...document.querySelectorAll(".rbx-tabs-horizontal a")].find((a) =>
        (a.getAttribute("href") ?? "").includes(key)
      );
    if (link) link.click();
    else location.hash = "#!/" + key; // last resort
  }

  const TABS = [
    ["About", "about"],
    ["Store", "store"],
    ["Servers", "game-instances"],
    ["Events", "about"],
  ];
  let activeTab = null;
  let eventsBlock = null;
  let hiddenForEvents = [];

  function setEventsMode(on) {
    if (!eventsBlock) eventsBlock = findSectionByHeading(/^events$/i);
    if (!eventsBlock) return;
    if (on) {
      // show only the events block inside the about pane
      const pane = eventsBlock.parentElement;
      hiddenForEvents = [...pane.children].filter((c) => c !== eventsBlock && c.style.display !== "none");
      for (const c of hiddenForEvents) c.classList.add("cer-gp-hidden");
      eventsBlock.classList.remove("cer-gp-hidden");
    } else {
      for (const c of hiddenForEvents) c.classList.remove("cer-gp-hidden");
      hiddenForEvents = [];
      eventsBlock.classList.add("cer-gp-hidden");
    }
  }

  for (const [label, key] of TABS) {
    const tab = CER.el("button", "cer-tab", label);
    tab.addEventListener("click", () => {
      activeTab?.classList.remove("cer-tab-active");
      activeTab = tab;
      tab.classList.add("cer-tab-active");
      clickNativeTab(key);
      setEventsMode(label === "Events");
    });
    tabBar.appendChild(tab);
    if (label === "About") {
      activeTab = tab;
      tab.classList.add("cer-tab-active");
    }
  }

  // sync the active pill to the URL hash — landing on #!/game-instances (or
  // #!/store) must highlight that tab, not default to About
  function syncPillFromHash() {
    const key = location.hash.replace(/^#!?\/?/, "") || "about";
    const idx = TABS.findIndex(([, k]) => k === key);
    if (idx < 0) return;
    const tab = tabBar.querySelectorAll(".cer-tab")[idx];
    if (!tab || tab === activeTab) return;
    activeTab?.classList.remove("cer-tab-active");
    activeTab = tab;
    tab.classList.add("cer-tab-active");
    setEventsMode(TABS[idx][0] === "Events");
  }
  syncPillFromHash();
  window.addEventListener("hashchange", syncPillFromHash);

  // after the lazy content settles, match Events mode to whatever tab is active
  // — an unconditional setEventsMode(false) here would override landing on
  // #!/events (bookmarked/shared Events links)
  setTimeout(() => {
    const idx = [...tabBar.querySelectorAll(".cer-tab")].indexOf(activeTab);
    setEventsMode(idx >= 0 && TABS[idx][0] === "Events");
  }, 800);

  // "People Also Join" / recommendations load lazily and re-render — keep them
  // gone. Also move the social-links block under the maturity label and put
  // Report Abuse beneath it (reorder via flex order on their shared column).
  function tidyAbout() {
    findSectionByHeading(/people also join|recommended/i)?.classList.add("cer-gp-hidden");
    // :not([...]) markers keep the 300ms-debounced re-scan from re-testing every
    // link/social block on the whole page each time the About tab mutates
    for (const el of document.querySelectorAll("[class*='social-link']:not([data-cer-social]), .game-social-links-container:not([data-cer-social])")) {
      el.dataset.cerSocial = "1";
      el.classList.add("cer-gp-social");
    }
    for (const el of document.querySelectorAll("a:not([data-cer-report])")) {
      el.dataset.cerReport = "1";
      if (/report abuse/i.test(el.textContent.trim())) el.closest("div,li,span")?.classList.add("cer-gp-report");
    }
  }
  tidyAbout();
  let tidyTimer = null;
  new MutationObserver(() => {
    clearTimeout(tidyTimer);
    tidyTimer = setTimeout(tidyAbout, 300);
  }).observe(document.body, { childList: true, subtree: true });
})();
