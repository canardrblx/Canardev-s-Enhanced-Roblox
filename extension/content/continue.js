// Continue tab, rebuilt. Resizing Roblox's carousel tiles in place broke its
// layout math (tiles overlapped), so instead: read the games out of the
// native section, hide it, and render our own native-looking wide row.
// features.wideTiles off → native section is left untouched.

let cerContinueBusy = false;
let cerContinueWatching = false;

// hide every native Continue carousel (ours has no .home-sort-header-container,
// so this never touches our replacement)
function cerHideNativeContinue() {
  for (const h of document.querySelectorAll(".home-sort-header-container")) {
    if (!/continue/i.test(h.textContent)) continue;
    const wrapper = h.parentElement;
    if (wrapper && wrapper.style.display !== "none") wrapper.style.display = "none";
  }
}

async function cerInitContinue() {
  if (typeof CER === "undefined") return;
  if (!location.pathname.startsWith("/home")) return;
  // `busy` set synchronously so the observer/nav can't race two builds
  if (cerContinueBusy || document.querySelector("[data-cer-continue]")) return;
  cerContinueBusy = true;
  try {
    const settings = await CER.get();
    if (!settings.features.wideTiles) return;
    // Start hiding the native Continue the instant it renders (and on every
    // re-render), BEFORE our slower build. That's what kills the recurring "old
    // Continue flashes in" bug — it's never visible for the build's async gap.
    cerHideNativeContinue();
    if (!cerContinueWatching) {
      cerContinueWatching = true;
      new MutationObserver(() => {
        if (location.pathname.startsWith("/home")) cerHideNativeContinue();
      }).observe(document.body, { childList: true, subtree: true });
    }
    await buildContinue(settings);
  } finally {
    cerContinueBusy = false;
    CER.skelDone?.("continue"); // release the veil no matter which path we took
  }
}

async function buildContinue(settings) {
  const native = await CER.waitFor(() => {
    const h = [...document.querySelectorAll(".home-sort-header-container")].find((x) => /continue/i.test(x.textContent));
    return h?.parentElement ?? null;
  }, 20000).catch(() => null);
  if (!native) return;

  // the tiles exist even while hidden (we read hrefs, not rendered images)
  await CER.waitFor(() => native.querySelector('a[href*="/games/"]'), 10000).catch(() => null);

  const seen = new Set();
  const games = [];
  for (const link of native.querySelectorAll('a[href*="/games/"]')) {
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
  if (games.length === 0) return;

  // insert our (empty) row now so the layout is stable while thumbnails load
  const section = CER.el("div", "cer-section");
  section.dataset.cerContinue = "1";
  section.appendChild(CER.el("h2", "cer-section-title", "Continue"));
  const grid = CER.el("div", "cer-grid cer-grid-wide");
  section.appendChild(grid);
  native.parentElement.insertBefore(section, native);
  CER.skelDone?.("continue"); // row is in place + native is hidden — safe to lift the veil now, thumbnails fill in after

  const uniByPlace = await CER.getUniverseIds(games.map((g) => g.placeId));
  for (const g of games) g.universeId = uniByPlace[g.placeId];
  const playable = games.filter((g) => g.universeId);
  const universeIds = playable.map((g) => g.universeId);

  const [thumbs, meta] = await Promise.all([CER.getGameThumbs(universeIds), CER.getGameMeta(universeIds)]);

  for (const game of playable) {
    grid.appendChild(
      CER.buildGameCard(game, {
        wide: true,
        art: thumbs[game.universeId],
        meta: meta[game.universeId],
        features: settings.features,
      })
    );
  }
}

cerInitContinue();
if (typeof CER !== "undefined") CER.onNavigate(cerInitContinue);
