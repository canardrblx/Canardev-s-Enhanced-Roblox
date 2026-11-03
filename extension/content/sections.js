// Home-section manager. Discovers every section in the home feed, remembers
// them for the settings list, and applies visibility prefs. NEW sections
// default to HIDDEN — except Friends, Continue Playing, and our own sections.
// A dismissible "Where are my recommendations?" note at the bottom explains
// the empty feed and opens settings.

(async function () {
  if (typeof CER === "undefined") return;
  // CER's own home page (pages/home.js) owns /home now: no Roblox feed to manage
  if ((await CER.takeover) === "home") return;

  function defaultVisible(title) {
    return /^friends/i.test(title) || /continue/i.test(title);
  }

  // The feed root is the container whose children are the section wrappers.
  // Scoping all searches to it is what keeps us away from the sidebar's
  // "Friends" nav item (the bug that hid the whole sidebar).
  function getFeedRoot() {
    return document.querySelector(".home-sort-header-container")?.parentElement?.parentElement ?? null;
  }

  // Strip badge junk (e.g. a Friends header reads "Friends11 online" when the
  // online-count badge text gets concatenated). No real home sort is named with
  // "online" or a bare count, so drop those.
  function cleanSectionTitle(raw) {
    let t = (raw ?? "").trim().replace(/\s+/g, " ");
    t = t.replace(/\s*\d*\s*online\b.*$/i, ""); // "Friends11 online" -> "Friends"
    t = t.replace(/\s*\(\d+\)\s*$/, ""); // "Friends (11)" -> "Friends"
    return t.trim().slice(0, 60);
  }

  // Find [{ title, el }] for everything that reads as a home-feed section.
  function findSections() {
    const found = [];
    const feedRoot = getFeedRoot();

    // scope to the feed so a stray .home-sort-header-container elsewhere (a
    // widget, the sidebar) can't get registered as a home section
    for (const header of (feedRoot || document).querySelectorAll(".home-sort-header-container")) {
      const wrapper = header.parentElement;
      // continue.js hid this one and shows its own row (registered below as a
      // .cer-section) — touching its display would bring the old row back
      if (wrapper?.dataset.cerReplaced) continue;
      const raw = header.querySelector('[class*="textIconRowText"]')?.textContent ?? header.textContent;
      const title = cleanSectionTitle(raw);
      if (wrapper && title) found.push({ title, el: wrapper });
    }

    // our own injected sections
    for (const section of document.querySelectorAll(".cer-section")) {
      const title = section.querySelector(".cer-section-title")?.textContent?.trim();
      if (title) found.push({ title, el: section });
    }

    // the Friends carousel isn't a game sort — find its header INSIDE the
    // feed only and climb to the feed-root child that contains it
    if (feedRoot) {
      const friendsHeader = [...feedRoot.querySelectorAll("span, h2")].find((s) =>
        /^friends(\s*\(\d+\))?$/i.test(s.textContent.trim())
      );
      if (friendsHeader && !found.some((f) => f.el.contains(friendsHeader))) {
        let el = friendsHeader;
        while (el.parentElement && el.parentElement !== feedRoot) el = el.parentElement;
        if (el.parentElement === feedRoot) found.push({ title: "Friends", el });
      }
    }

    return found;
  }

  let applying = false;
  let applyAgain = false;
  async function applyPrefs() {
    if (!location.pathname.startsWith("/home")) return; // SPA-safe guard
    if (document.getElementById("cer-app")?.dataset.page === "home") return; // ours, not Roblox's feed
    if (applying) {
      applyAgain = true; // a wave landed mid-apply — run once more after
      return;
    }
    applying = true;
    try {
      const settings = await CER.get();
      const sections = findSections();

      // register new sections: remember the title, assign the default pref
      const known = new Set(settings.knownSections);
      const prefs = { ...settings.sectionPrefs };
      let changed = false;

      // one-time purge of junk keys stored by older versions (badge text like
      // "Friends11 online", stray counts) so they stop cluttering the settings UI
      const isJunk = (t) => /online/i.test(t) || /^\d/.test(t) || /^\s*$/.test(t);
      for (const t of [...known]) {
        if (isJunk(t)) { known.delete(t); changed = true; }
      }
      for (const t of Object.keys(prefs)) {
        if (isJunk(t)) { delete prefs[t]; changed = true; }
      }
      for (const { title } of sections) {
        if (!known.has(title)) {
          known.add(title);
          changed = true;
        }
        if (!(title in prefs)) {
          prefs[title] = defaultVisible(title) ? "show" : "hide";
          changed = true;
        }
      }
      if (changed) await CER.set({ knownSections: [...known].sort(), sectionPrefs: prefs });

      for (const { title, el } of sections) {
        el.style.display = prefs[title] === "hide" ? "none" : "";
      }

      // the "Add Friends" tile in the friends row (scope to the feed so we don't
      // scan the whole document every debounce tick during lazy-load)
      for (const tile of (getFeedRoot() || document).querySelectorAll(".friends-carousel-tile")) {
        if (/add friends/i.test(tile.textContent)) {
          tile.style.display = settings.features.hideAddFriends ? "none" : "";
        }
      }

      // drop the "See All" buttons — the section title itself is the link now
      for (const header of (getFeedRoot() || document).querySelectorAll(".container-header")) {
        const seeAll = [...header.querySelectorAll("a, button")].find((a) => /see all/i.test(a.textContent));
        if (seeAll) seeAll.style.display = "none";
        if (/^friends/i.test(header.textContent.trim()) && !header.dataset.cerTitleLink) {
          header.dataset.cerTitleLink = "1";
          const title = header.querySelector("h2, h3, .container-header-text") ?? header;
          title.style.cursor = "pointer";
          title.title = "See all friends";
          title.addEventListener("click", () => (location.href = "https://www.roblox.com/users/friends"));
        }
      }

      maintainNotice(settings, sections, prefs);
      // prefs are applied — lift the anti-flash veil (see theme.js)
      if (sections.length) document.documentElement.classList.remove("cer-sections-pending");
    } finally {
      applying = false;
      if (applyAgain) {
        applyAgain = false;
        schedule();
      }
    }
  }

  // "Where are my recommendations?" — bottom of the feed, click opens the
  // Roblox UI tab, ✕ hides it permanently
  function maintainNotice(settings, sections, prefs) {
    const existing = document.querySelector(".cer-recs-notice");
    const anyHidden = sections.some(({ title }) => prefs[title] === "hide");
    const feedRoot = getFeedRoot();

    if (settings.uiState.recsNoticeHidden || !anyHidden || !feedRoot) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const notice = CER.el("div", "cer-recs-notice");
    const text = CER.el("button", "cer-recs-notice-text", "Where are my recommendations?");
    text.addEventListener("click", () => CER.openSettings?.("Roblox UI"));
    notice.appendChild(text);

    const hide = CER.el("button", "cer-recs-notice-hide", "×");
    hide.title = "Hide this permanently";
    hide.addEventListener("click", async () => {
      notice.remove();
      const cur = await CER.get();
      await CER.set({ uiState: { ...cur.uiState, recsNoticeHidden: true } });
    });
    notice.appendChild(hide);
    feedRoot.appendChild(notice);
  }

  // re-apply when the feed lazy-loads more sections or settings change.
  // Debounced, but capped: a plain 400 ms debounce kept restarting while the
  // feed streamed in, so the pending veil (and hidden sections) lingered.
  let timer = null;
  let burstStart = 0;
  function schedule() {
    const now = performance.now();
    if (!timer) burstStart = now;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      applyPrefs();
    }, Math.max(0, Math.min(150, burstStart + 400 - now)));
  }
  const observer = new MutationObserver(() => {
    if (location.pathname.startsWith("/home")) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  CER.onSettingsChanged(() => applyPrefs());
  CER.onNavigate(() => applyPrefs());

  await applyPrefs();
})();
