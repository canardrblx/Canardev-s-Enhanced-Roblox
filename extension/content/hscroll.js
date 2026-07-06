// Turn a vertical mouse wheel into horizontal scrolling when the pointer is over
// a horizontally-scrollable row (our game rows + Roblox's carousels and the
// friends strip), so you can browse them with a normal wheel instead of hunting
// for the arrows. Safe by construction: it only ever acts on an element that is
// genuinely scrollable sideways and still has room to move in the wheel's
// direction, so it never hijacks normal page scrolling.
(function () {
  const ROWS = ".cer-g-grid, .friends-carousel-list-container, .hlist, [class*='carousel']";

  function scrollableRow(node) {
    for (let el = node; el && el !== document.body; el = el.parentElement) {
      if (!(el instanceof Element) || !el.matches) continue;
      if (!el.matches(ROWS)) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 2) return el;
    }
    return null;
  }

  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) return; // leave pinch-zoom alone
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // already a horizontal gesture (trackpad)
      const row = scrollableRow(e.target);
      if (!row) return;
      const atStart = row.scrollLeft <= 0;
      const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;
      if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return; // at the edge — let the page scroll
      row.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false }
  );
})();
