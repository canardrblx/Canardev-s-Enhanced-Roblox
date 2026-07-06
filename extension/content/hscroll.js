// Turn a vertical mouse wheel into horizontal scrolling when the pointer is over
// a horizontal row (our Continue/game rows, Roblox's carousels, the friends
// strip, search rows). Works on ANY element that is genuinely side-scrollable
// rather than a hand-maintained list, so new rows are covered automatically.
// Safe by construction: it only acts on an element whose overflow-x actually
// scrolls, that is a short row (not a tall scrollable panel), and only when
// there is still room to move in the wheel's direction — so it never hijacks
// normal page scrolling.
(function () {
  function scrollableRow(node) {
    for (let el = node; el && el !== document.body; el = el.parentElement) {
      if (!(el instanceof Element)) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 2 && el.clientHeight <= 460) {
        return el;
      }
    }
    return null;
  }

  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) return; // leave pinch-zoom alone
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // already a horizontal gesture (trackpad / tilt wheel)
      const row = scrollableRow(e.target);
      if (!row) return;
      const atStart = row.scrollLeft <= 1;
      const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;
      if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return; // at the edge — let the page scroll
      row.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false }
  );
})();
