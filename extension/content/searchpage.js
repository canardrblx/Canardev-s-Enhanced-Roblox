// Tag search + discover result pages so the CSS can give Roblox's native result
// cards the CER look (rounded corners, themed surfaces, centered titles) without
// restyling those same card classes everywhere else on the site.
(function () {
  if (typeof CER === "undefined") return;
  // RETIRED on pages CER owns: pages/search.js builds its own results page
  // there. This only still styles Roblox's native search (?cer=native, or the
  // searchPage feature turned off).
  let owned = false;
  const refreshOwned = async () => {
    try {
      const s = await CER.get();
      owned = CER.pageFor?.(location.pathname, location.search, s.features)?.tag === "search";
    } catch {
      owned = false;
    }
  };
  function mark() {
    const p = location.pathname;
    const on = !owned && (p.startsWith("/search") || p.startsWith("/discover"));
    if (!document.body) return;
    document.body.classList.toggle("cer-search-page", on);
    // the people (users) results page keeps its title + search bar in a .top-row
    // that holds no filters, so a users-only class lets the CSS hide that whole
    // row without disturbing the games /discover filter + sort controls.
    document.body.classList.toggle("cer-search-users", on && p.startsWith("/search/users"));
    // communities has a no-keyword landing page (a tip banner + top search bar +
    // curated rows) that a class lets us clean up separately from the results.
    document.body.classList.toggle("cer-search-communities", on && p.startsWith("/search/communities"));
  }
  // People (users) search: give each result card the profile/home hero look — a
  // full-body avatar render across the top. Roblox only ships a small circular
  // headshot in the card, so we fetch the full-body render (the same thumbnail
  // the profile/home hero uses) and hide the native headshot via CSS. The real
  // profile picture is never restyled, only replaced by the render.
  // Fetch full-body renders + headshots, retrying ids Roblox still reports as
  // "Pending" (a fresh render), like CER.getGameThumbs does for games.
  async function userThumbs(kind, ids, size) {
    const out = {};
    let todo = ids;
    for (let attempt = 0; attempt < 3 && todo.length; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1200));
      const res = await fetch(
        "https://thumbnails.roblox.com/v1/users/" + kind + "?userIds=" + todo.join(",") + "&size=" + size + "&format=Png&isCircular=false",
        { credentials: "include" }
      ).catch(() => null);
      if (!res || !res.ok) break;
      const body = await res.json().catch(() => ({}));
      const pending = [];
      for (const e of body.data || []) {
        if (e.imageUrl) out[e.targetId] = e.imageUrl;
        else if (e.state === "Pending") pending.push(e.targetId);
      }
      todo = pending;
    }
    return out;
  }

  function enhancePeople() {
    if (owned || !location.pathname.startsWith("/search/users")) return;
    const pending = [];
    for (const card of document.querySelectorAll(".avatar-card-container")) {
      const link = card.querySelector("a[href*='/users/']");
      const m = link && link.href.match(/\/users\/(\d+)/);
      if (!m) continue;
      const id = m[1];
      // React can reuse a card for a different user on a new search — the
      // stored id (not just "done") decides whether this card is up to date
      if (card.dataset.cerBody === id) continue;
      const reused = !!card.dataset.cerBody;
      card.dataset.cerBody = id;
      let body, head;
      if (reused) {
        body = card.querySelector(".cer-people-body");
        head = card.querySelector(".cer-people-head");
        // clear the old user's pictures while the new ones load
        body?.removeAttribute("src");
        head?.removeAttribute("src");
      }
      if (!body || !head) {
        // full-body render across the top
        const banner = CER.el("div", "cer-people-banner");
        body = CER.el("img", "cer-people-body");
        body.loading = "lazy";
        banner.appendChild(body);
        card.insertBefore(banner, card.firstChild);
        // headshot (the profile picture) + names in a row overlapping the banner
        const meta = CER.el("div", "cer-people-meta");
        head = CER.el("img", "cer-people-head");
        head.loading = "lazy";
        meta.appendChild(head);
        const cap = card.querySelector(".avatar-card-caption");
        if (cap) meta.appendChild(cap);
        banner.after(meta);
        // clicking the avatar / headshot / name opens the profile (the native card
        // has no obvious way in now); the Add-friend button is separate so it still
        // works on its own. Reads the card's CURRENT user id.
        const go = () => { location.href = "https://www.roblox.com/users/" + card.dataset.cerBody + "/profile"; };
        banner.style.cursor = "pointer";
        meta.style.cursor = "pointer";
        banner.addEventListener("click", go);
        meta.addEventListener("click", go);
      }
      pending.push({ id, card, body, head });
    }
    if (!pending.length) return;
    const ids = [...new Set(pending.map((p) => p.id))];
    Promise.all([userThumbs("avatar", ids, "420x420"), userThumbs("avatar-headshot", ids, "150x150")])
      .then(([bm, hm]) => {
        pending.forEach((p) => {
          if (p.card.dataset.cerBody !== p.id) return; // reused again meanwhile
          if (bm[p.id]) p.body.src = bm[p.id];
          if (hm[p.id]) p.head.src = hm[p.id];
        });
      })
      .catch(() => {});
  }

  // Cards stream in (async render + infinite scroll), so re-run on DOM changes,
  // debounced — but only while on the people results page. This used to watch
  // the whole document on every page of the site.
  let peopleTimer = null;
  let peopleObs = null;
  function schedulePeople() {
    if (CER.alive && !CER.alive()) return;
    clearTimeout(peopleTimer);
    peopleTimer = setTimeout(enhancePeople, 150);
  }
  function syncPeopleWatch() {
    const on = !owned && location.pathname.startsWith("/search/users");
    if (on && !peopleObs && document.body) {
      peopleObs = new MutationObserver(schedulePeople);
      peopleObs.observe(document.body, { childList: true, subtree: true });
    } else if (!on && peopleObs) {
      peopleObs.disconnect();
      peopleObs = null;
    }
  }

  refreshOwned().then(() => {
    mark();
    enhancePeople();
    syncPeopleWatch();
  });
  CER.onNavigate?.(async () => {
    await refreshOwned();
    mark();
    syncPeopleWatch();
    schedulePeople();
  });
})();
