// Catalog cleanup: rename "Marketplace" back to "Catalog", strip the clutter
// (buy-robux, cart, search-suggestion pills, the extra category dropdown next
// to the search box), and let the stylesheet retheme the rest. Toggleable.

(async function () {
  if (typeof CER === "undefined") return;
  if (!location.pathname.startsWith("/catalog")) return;
  const settings = await CER.get();
  if (settings.features.catalogClean === false) return;

  document.body.classList.add("cer-catalog");
  // (the catalog has no loading veil any more, so there's nothing to release)

  // Rename by editing the text node in place: replacing a React-owned
  // heading's children (textContent =) can make React throw on its next update.
  function tidy() {
    if (!location.pathname.startsWith("/catalog")) return;
    for (const h of document.querySelectorAll("h1, h2, .catalog-name, [class*='page-title']")) {
      if (h.textContent.trim() !== "Marketplace") continue;
      const walk = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (n.nodeValue.trim() === "Marketplace") n.nodeValue = n.nodeValue.replace("Marketplace", "Catalog");
      }
    }
  }
  tidy();
  let t = null;
  new MutationObserver(() => {
    if (t) return; // at most one tidy per 200 ms while the grid streams in
    t = setTimeout(() => {
      t = null;
      tidy();
    }, 200);
  }).observe(document.body, { childList: true, subtree: true });
  // in-app navigation away from the catalog drops the declutter class
  CER.onNavigate(() => document.body.classList.toggle("cer-catalog", location.pathname.startsWith("/catalog")));
})();
