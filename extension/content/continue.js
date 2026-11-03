// Continue tab, rebuilt. Resizing Roblox's carousel tiles in place broke its
// layout math (tiles overlapped), so instead: read the games out of the
// native section, hide it, and render our own native-looking wide row.
// features.wideTiles off → native section is left untouched.

let cerContinueBusy = false;
let cerContinueHiding = false; // true only while our row replaces the native one
let cerContinueObs = null;
let cerContinueRaf = 0;

// hide every native Continue carousel (ours has no .home-sort-header-container,
// so this never touches our replacement). data-cer-replaced tells sections.js
// to leave the wrapper alone (it used to un-hide it ~400 ms later).
function cerHideNativeContinue() {
  for (const h of document.querySelectorAll(".home-sort-header-container")) {
    if (!/continue/i.test(h.textContent)) continue;
    const wrapper = h.parentElement;
    if (!wrapper) continue;
    wrapper.dataset.cerReplaced = "1";
    if (wrapper.style.display !== "none") wrapper.style.display = "none";
  }
}

// give the native Continue back (our build failed) — never leave the user
// with no Continue row at all
function cerShowNativeContinue() {
  cerContinueHiding = false;
  cerContinueObs?.disconnect();
  cerContinueObs = null;
  for (const w of document.querySelectorAll("[data-cer-replaced]")) {
    delete w.dataset.cerReplaced;
    w.style.display = "";
  }
}

// Re-hide on every feed re-render, but only on /home and at most once a frame
// (this used to run querySelectorAll + textContent on every mutation of every page).
function cerWatchNativeContinue() {
  if (cerContinueObs) return;
  cerContinueObs = new MutationObserver(() => {
    if (!location.pathname.startsWith("/home")) {
      cerContinueObs?.disconnect();
      cerContinueObs = null;
      return;
    }
    if (cerContinueRaf || !cerContinueHiding) return;
    cerContinueRaf = requestAnimationFrame(() => {
      cerContinueRaf = 0;
      if (cerContinueHiding) cerHideNativeContinue();
    });
  });
  cerContinueObs.observe(document.body, { childList: true, subtree: true });
}

async function cerInitContinue() {
  if (typeof CER === "undefined") return;
  if (!location.pathname.startsWith("/home")) return;
  // CER's own home page (pages/home.js) owns /home now: stand down there
  if (CER.pageFor?.(location.pathname, location.search, (await CER.get()).features)?.tag === "home") return;
  // `busy` set synchronously so the observer/nav can't race two builds
  if (cerContinueBusy || document.querySelector("[data-cer-continue]")) return;
  cerContinueBusy = true;
  try {
    const settings = await CER.get();
    if (!settings.features.wideTiles) return;
    // Start hiding the native Continue the instant it renders (and on every
    // re-render), BEFORE our slower build. That's what kills the recurring "old
    // Continue flashes in" bug — it's never visible for the build's async gap.
    cerContinueHiding = true;
    cerHideNativeContinue();
    cerWatchNativeContinue();
    await buildContinue(settings);
  } catch {
    // never leave an empty shell over a hidden native row
    const ours = document.querySelector("[data-cer-continue]");
    if (ours && !ours.querySelector(".cer-card")) ours.remove();
    if (!document.querySelector("[data-cer-continue]")) cerShowNativeContinue();
  } finally {
    cerContinueBusy = false;
    CER.skelDone?.("continue"); // release the veil no matter which path we took
  }
}

async function buildContinue(settings) {
  // A new account has no Continue row at all. Once other sections have been on
  // screen for a moment without one, lift the veil (we keep watching quietly,
  // so a late Continue is still hidden + replaced the moment it renders).
  let othersSince = 0;
  const veilTimer = setInterval(() => {
    if (!document.querySelector(".home-sort-header-container")) return;
    othersSince ||= Date.now();
    if (Date.now() - othersSince >= 1500) {
      clearInterval(veilTimer);
      CER.skelDone?.("continue");
    }
  }, 150);

  const native = await CER.waitFor(() => {
    const h = [...document.querySelectorAll(".home-sort-header-container")].find((x) => /continue/i.test(x.textContent));
    return h?.parentElement ?? null;
  }, 20000).catch(() => null);
  clearInterval(veilTimer);
  if (!native || !native.parentElement) {
    cerShowNativeContinue();
    return;
  }

  // insert our shell (title + skeleton) right away so the layout is stable
  const section = CER.el("div", "cer-section");
  section.dataset.cerContinue = "1";
  section.appendChild(CER.el("h2", "cer-section-title", "Continue"));
  const grid = CER.el("div", "cer-grid cer-grid-wide");
  grid.appendChild(CER.skelGrid(5, 138, 246));
  section.appendChild(grid);
  native.parentElement.insertBefore(section, native);
  CER.skelDone?.("continue"); // shell is in place + native is hidden — safe to lift the veil

  // the tiles exist even while hidden (we read hrefs, not rendered images)
  const firstLink = await CER.waitFor(() => native.querySelector('a[href*="/games/"]'), 10000).catch(() => null);

  const seen = new Set();
  const games = [];
  for (const link of firstLink ? native.querySelectorAll('a[href*="/games/"]') : []) {
    const placeId = (link.getAttribute("href") ?? "").match(/\/games\/(\d+)/)?.[1];
    if (!placeId || seen.has(placeId)) continue;
    seen.add(placeId);
    const name =
      link.querySelector(".game-card-name")?.textContent.trim() ||
      link.querySelector("img")?.alt ||
      "Game";
    games.push({ placeId, name });
    // Continue's tiles come first in DOM order; cap so we don't accidentally
    // pull the entire feed (which blew the thumbnail API limit → blank cards)
    if (games.length >= 15) break;
  }
  if (games.length === 0) {
    // couldn't read the native row — drop ours and give theirs back
    section.remove();
    cerShowNativeContinue();
    return;
  }

  // cards go in now with names + links; art and the rating/players row fill in
  grid.textContent = "";
  const cards = new Map();
  for (const game of games) {
    const card = CER.buildGameCard(game, { wide: true, features: settings.features });
    const img = card.querySelector(".cer-card-thumb img");
    if (img) {
      img.removeAttribute("src"); // no broken-image icon / alt text while loading
      img.style.opacity = "0";
    }
    cards.set(game.placeId, card);
    grid.appendChild(card);
  }

  const uniByPlace = await CER.getUniverseIds(games.map((g) => g.placeId)).catch(() => ({}));
  for (const g of games) g.universeId = uniByPlace[g.placeId];
  const universeIds = games.map((g) => g.universeId).filter(Boolean);
  if (!universeIds.length) return;

  CER.getGameThumbs(universeIds)
    .then((thumbs) => {
      for (const g of games) {
        const img = cards.get(g.placeId)?.querySelector(".cer-card-thumb img");
        const url = thumbs[g.universeId];
        if (!img || !url) continue;
        img.addEventListener("load", () => (img.style.opacity = ""), { once: true });
        img.src = url;
      }
    })
    .catch(() => {});
  CER.getGameMeta(universeIds)
    .then((meta) => {
      for (const g of games) {
        const card = cards.get(g.placeId);
        const m = meta[g.universeId];
        if (!card || !m) continue;
        // reuse the shared card builder for the meta row so it stays identical
        const fresh = CER.buildGameCard(g, { wide: true, meta: m, features: settings.features }).querySelector(".cer-card-meta");
        const old = card.querySelector(".cer-card-meta");
        if (fresh && old) old.replaceWith(fresh);
      }
    })
    .catch(() => {});
}

cerInitContinue();
if (typeof CER !== "undefined") CER.onNavigate(cerInitContinue);
