// Turn a vertical mouse wheel into horizontal scrolling when the pointer is over
// a horizontal row (our Continue/game rows, Roblox's carousels, the friends
// strip, search rows). Works on ANY element that is genuinely side-scrollable
// rather than a hand-maintained list, so new rows are covered automatically.
// Safe by construction: it only acts on an element whose overflow-x actually
// scrolls, that is a short row (not a tall scrollable panel), and only when
// there is still room to move in the wheel's direction — so it never hijacks
// normal page scrolling.
// Perf: the non-passive wheel listener lives on each row, found once on
// hover. A window-level non-passive listener (the old way) made the browser
// wait on our JS before scrolling ANY page, every tick.
(function () {
  function scrollableRow(node) {
    for (let el = node; el && el !== document.body; el = el.parentElement) {
      if (!(el instanceof Element)) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.clientHeight <= 460) return el;
    }
    return null;
  }

  function onWheel(e) {
    if (e.ctrlKey) return; // leave pinch-zoom alone
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // already a horizontal gesture (trackpad / tilt wheel)
    const row = e.currentTarget;
    if (row.scrollWidth <= row.clientWidth + 2) return;
    const atStart = row.scrollLeft <= 1;
    const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;
    if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return; // at the edge — let the page scroll
    // Firefox reports mouse wheels in lines (deltaMode 1), not pixels
    row.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? row.clientWidth : 1);
    e.preventDefault();
  }

  const hooked = new WeakSet();
  let lastTarget = null;
  document.addEventListener(
    "pointerover",
    (e) => {
      if (e.target === lastTarget) return;
      lastTarget = e.target;
      const row = scrollableRow(e.target);
      if (row && !hooked.has(row)) {
        hooked.add(row);
        row.addEventListener("wheel", onWheel, { passive: false });
      }
    },
    { passive: true }
  );
})();
