// Universal settings re-skinner. Rather than rebuild each setting (which
// breaks whenever Roblox rearranges them), this tags the settings page so the
// stylesheet can modernise it generically: card-ify sections, round inputs,
// theme everything, widen the layout. Works on whatever settings Roblox ships.

(async function () {
  if (typeof CER === "undefined") return;
  // group / community configure pages count as settings too
  const isGroupCfgPath = (p) => /^\/(communities|groups)\/(\d+\/)?configure/.test(p);
  const isSettingsPath = (p) => p.startsWith("/my/account") || p.startsWith("/my/settings") || isGroupCfgPath(p);
  if (!isSettingsPath(location.pathname)) return;
  // /my/account is CER's own page now (pages/settings.js); this reskin stays
  // for ?cer=native, /my/settings and community configure pages
  if ((await CER.takeover) === "settings") return;
  // configure pages are CER's own group manager now (pages/groupconfig.js);
  // this reskin stays only for ?cer=native and /my/settings
  if ((await CER.takeover) === "groupconfig") return;

  // the group/community "Configure" page has a different shell (big title,
  // author line, funds, side menu). Treat it specially so it ends up looking
  // exactly like the account settings: no title, one centred pill on top.
  let isGroupCfg = false;

  function tag() {
    const p = location.pathname;
    if (!isSettingsPath(p)) {
      // SPA'd off the settings page: take our hooks with us
      document.body.classList.remove("cer-settings-reskin", "cer-group-cfg");
      return;
    }
    isGroupCfg = isGroupCfgPath(p);
    document.body.classList.add("cer-settings-reskin");
    document.body.classList.toggle("cer-group-cfg", isGroupCfg);
    // give each settings "section" a consistent hook regardless of its class.
    // Each heading is checked once (data-cer-set); reads first, writes after,
    // so offsetWidth doesn't force a layout per heading.
    const cards = [];
    const done = [];
    for (const h of document.querySelectorAll(
      "h2:not([data-cer-set]), h3:not([data-cer-set]), [class*='section-header']:not([data-cer-set]), [class*='SectionHeader']:not([data-cer-set])"
    )) {
      const card = h.closest("[class*='section'], [class*='Section'], .panel, [class*='container']");
      if (card && !card.classList.contains("cer-set-card")) {
        const w = card.offsetWidth;
        if (w === 0) continue; // section tab not shown yet: check again later
        if (w > 300 && card.offsetHeight < 2000) cards.push(card);
      }
      done.push(h);
    }
    for (const card of cards) card.classList.add("cer-set-card");
    for (const h of done) h.dataset.cerSet = "1";
    // hide the big "Settings" page title (redundant with the sidebar item)
    for (const h1 of document.querySelectorAll("h1:not(.cer-hide-settings-title)")) {
      if (h1.textContent.trim() === "Settings") h1.classList.add("cer-hide-settings-title");
    }
    buildDropdown();
    if (isGroupCfg) cleanGroupShell();
  }

  // first text node matching `re` (a text walk instead of reading textContent
  // on every a/button/span)
  function findText(re) {
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    return tw.nextNode();
  }

  // Strip the Configure-page chrome and relocate the pill so the page matches
  // account settings: hide title + author + funds + "back" link, then move the
  // dropdown to the top of the content column (was a side menu).
  let backEl = null;
  let fundsEl = null;
  function cleanGroupShell() {
    const hdr = document.querySelector(".section.configure-group > .container-header");
    if (hdr) hdr.classList.add("cer-hide-settings-title");
    if (!backEl?.isConnected) {
      backEl = findText(/^\s*back to (community|group)/i)?.parentElement?.closest("a, button") ?? null;
      backEl?.classList.add("cer-hide-settings-title");
    }
    // the "Community/Group Funds: N" line — hide the smallest wrapper that is
    // just that line, so we don't nuke a shared container
    if (!fundsEl?.isConnected) {
      let n = findText(/^\s*(community|group)\s*funds/i)?.parentElement ?? null;
      while (
        n?.parentElement &&
        /funds/i.test(n.parentElement.textContent) &&
        n.parentElement.textContent.trim().length < 40
      )
        n = n.parentElement;
      fundsEl = n;
      fundsEl?.classList.add("cer-hide-settings-title");
    }
    // move the pill to the top of the content column and drop the old side menu
    const dd = document.querySelector(".cer-set-dd");
    const tcg = document.querySelector(".tab-content-group");
    if (dd && tcg && tcg.firstElementChild !== dd) tcg.insertBefore(dd, tcg.firstChild);
  }

  // Replace the section list with a dropdown picker (pills got crowded with
  // 11 sections). The dropdown proxies clicks to Roblox's own (hidden) menu
  // links so Angular routing keeps working untouched.
  function buildDropdown() {
    const nav = document.querySelector(".settings-left-navigation .menu-vertical, .menu-vertical");
    if (!nav || document.querySelector(".cer-set-dd")) return;
    const opts = [...nav.querySelectorAll(".menu-option-content")];
    if (!opts.length) return;
    nav.style.display = "none"; // the dropdown replaces the section list

    const dd = CER.el("div", "cer-set-dd");
    const btn = CER.el("button", "cer-set-dd-btn");
    const menu = CER.el("div", "cer-set-dd-menu");
    const currentLabel = () =>
      (nav.querySelector(".menu-option-content.active") ?? opts[0]).textContent.trim();
    btn.textContent = currentLabel() + "  ▾";

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("cer-set-dd-open");
    });
    document.addEventListener("click", () => menu.classList.remove("cer-set-dd-open"));

    for (const opt of opts) {
      const it = CER.el("button", "cer-set-dd-opt", opt.textContent.trim());
      it.addEventListener("click", () => {
        opt.click();
        menu.classList.remove("cer-set-dd-open");
        setTimeout(() => (btn.textContent = currentLabel() + "  ▾"), 60);
      });
      menu.appendChild(it);
    }
    dd.appendChild(btn);
    dd.appendChild(menu);
    nav.parentElement.insertBefore(dd, nav);
  }

  // changing a native setting isn't instant — flash a brief loading shimmer on
  // the card so it doesn't feel frozen
  document.addEventListener(
    "change",
    (e) => {
      const card = e.target?.closest?.(".cer-set-card");
      if (!card) return;
      card.classList.add("cer-set-loading");
      setTimeout(() => card.classList.remove("cer-set-loading"), 900);
    },
    true
  );

  // throttled: Angular re-renders in bursts, one tag() per burst is plenty
  let tagTimer = null;
  const scheduleTag = () => {
    if (tagTimer) return;
    tagTimer = setTimeout(() => {
      tagTimer = null;
      tag();
    }, 150);
  };
  tag();
  new MutationObserver(scheduleTag).observe(document.body, { childList: true, subtree: true });
  CER.onNavigate?.(tag);
})();
