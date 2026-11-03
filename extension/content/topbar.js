// Top-bar migration: hides Roblox's top bar (features.showTopBar restores it)
// and moves what matters into the sidebar — search box, Robux balance under
// the username, Charts / Catalog / Create links. Also renames
// Marketplace→Catalog and (optionally) Communities→Groups, and drops the
// "Robux" text tab whenever the top bar IS shown.

(async function () {
  if (typeof CER === "undefined") return;
  let settings = await CER.get();
  // the custom sidebar owns navigation — skip Roblox's nav migration entirely
  if (settings.features.customSidebar) return;

  function sidebarList() {
    for (const ul of document.querySelectorAll("ul")) {
      const links = [...ul.querySelectorAll(":scope > li a")];
      if (links.some((a) => a.textContent.trim().toLowerCase() === "home") &&
          links.some((a) => a.textContent.trim().toLowerCase() === "profile")) {
        return ul;
      }
    }
    return null;
  }

  // SAFETY: only hide the top bar if the left sidebar actually exists to
  // replace it. Accounts using the classic top-bar nav have no left-nav — if
  // we hid their top bar there, they'd have NO navigation (the black-space
  // bug). Re-checked continuously so it self-corrects as the DOM loads.
  function updateTopbarMode() {
    const hasSidebar = !!sidebarList() && !!document.querySelector(".left-nav");
    document.body.classList.toggle("cer-no-topbar", !settings.features.showTopBar && hasSidebar);
  }
  updateTopbarMode();
  const modeTimer = setInterval(updateTopbarMode, 1500);
  setTimeout(() => clearInterval(modeTimer), 20000);

  // re-read settings when the panel changes them, so toggling "show top bar"
  // (or Groups rename) takes effect live instead of only after a reload
  CER.onSettingsChanged(async (changes) => {
    if (!changes.features) return;
    settings = await CER.get();
    updateTopbarMode();
    applyRenames();
  });

  const list = await CER.waitFor(sidebarList, 15000).catch(() => null);
  if (!list) return;

  // template link for native styling
  const template = [...list.querySelectorAll(":scope > li")].find(
    (li) => li.querySelector("a")?.textContent.trim().toLowerCase() === "profile"
  );

  // clones inherit whatever active/selected state the template had at clone
  // time — strip it so our items never render as "selected"
  function stripActiveState(li) {
    for (const el of [li, ...li.querySelectorAll("*")]) {
      el.removeAttribute("aria-current");
      for (const cls of [...el.classList]) {
        if (/^bg-|active|selected|current/i.test(cls)) el.classList.remove(cls);
      }
    }
  }
  CER.stripActiveState = stripActiveState;

  function makeItem(label, href, iconName) {
    let li;
    if (template) {
      li = template.cloneNode(true);
      stripActiveState(li);
      const a = li.querySelector("a");
      a.href = href;
      const icon = li.querySelector('[class*="icon-"], .cer-side-glyph');
      if (icon) {
        icon.className = "cer-side-glyph";
        icon.textContent = "";
        icon.appendChild(CER.svg(iconName));
      }
      const textSpan = [...li.querySelectorAll("span")].find(
        (s) => s.children.length === 0 && s.textContent.trim().toLowerCase() === "profile"
      );
      if (textSpan) textSpan.textContent = label;
    } else {
      li = CER.el("li");
      const a = CER.el("a", "", label);
      a.href = href;
      li.appendChild(a);
    }
    li.classList.add("cer-topnav-li");
    return li;
  }

  const widgets = [];

  function build() {
    if (settings.features.showTopBar) return; // nothing to migrate

    const userLi = list.querySelector(":scope > li"); // the username row

    // search box
    const searchLi = CER.el("li", "cer-topnav-li cer-side-search-li");
    const search = CER.el("input", "cer-side-search");
    search.type = "search";
    search.placeholder = "Search Roblox";
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && search.value.trim()) {
        location.href = "https://www.roblox.com/discover?Keyword=" + encodeURIComponent(search.value.trim());
      }
    });
    searchLi.appendChild(search);

    // robux balance — click opens a small dropdown (Transactions / Buy Robux)
    const robuxLi = CER.el("li", "cer-topnav-li cer-side-robux-li");
    const robuxLink = CER.el("button", "cer-side-robux");
    robuxLink.appendChild(CER.el("span", "cer-side-glyph icon-robux-16x16"));
    const robuxAmount = CER.el("span", "", "…");
    robuxLink.appendChild(robuxAmount);
    robuxLi.appendChild(robuxLink);
    robuxLink.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelector(".cer-ctx")?.remove();
      const menu = CER.el("div", "cer-ctx");
      for (const [label, href] of [
        ["Transactions", "https://www.roblox.com/transactions"],
        ["Buy Robux", "https://www.roblox.com/upgrades/robux"],
      ]) {
        const item = CER.el("a", "cer-ctx-item", label);
        item.href = href;
        menu.appendChild(item);
      }
      const r = robuxLink.getBoundingClientRect();
      menu.style.left = r.left + "px";
      menu.style.top = r.bottom + 4 + "px";
      document.body.appendChild(menu);
      document.addEventListener("click", () => menu.remove(), { once: true });
    });
    fetch("https://economy.roblox.com/v1/user/currency", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => (robuxAmount.textContent = Number(d.robux ?? 0).toLocaleString()))
      .catch(() => (robuxAmount.textContent = ""));

    // pending robux (clears over the next few days) — small line under Robux
    const pendingLi = CER.el("li", "cer-topnav-li cer-side-pending-li");
    const pending = CER.el("span", "cer-side-pending", "");
    pendingLi.appendChild(pending);
    pendingLi.style.display = "none"; // hidden until we confirm there's pending
    fetch("https://economy.roblox.com/v2/user/transaction-totals?timeFrame=Month&transactionType=summary", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const amt = d.pendingRobuxTotal ?? d.pendingRobux ?? 0;
        if (amt > 0) {
          pending.textContent = Number(amt).toLocaleString() + " pending";
          pendingLi.style.display = "";
        }
      })
      .catch(() => {});

    const navItems = [
      makeItem("Charts", "https://www.roblox.com/charts", "chart"),
      makeItem("Catalog", "https://www.roblox.com/catalog", "bag"),
      makeItem("Create", "https://create.roblox.com/", "hammer"),
    ];
    navItems[0].dataset.cerRoute = "/charts";
    navItems[1].dataset.cerRoute = "/catalog";

    // order: username, robux, pending, search, Charts, Catalog, Create, rest
    widgets.push(robuxLi, pendingLi, searchLi, ...navItems);
    let after = userLi;
    for (const w of widgets) {
      after ? after.insertAdjacentElement("afterend", w) : list.prepend(w);
      after = w;
    }
  }
  build();

  // ---- renames ----

  function applyRenames() {
    // Marketplace → Catalog (top bar links, if visible)
    for (const a of document.querySelectorAll('a[id*="marketplace"]')) {
      for (const node of a.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && /marketplace/i.test(node.nodeValue)) node.nodeValue = "Catalog";
      }
      if (a.children.length === 0 && /marketplace/i.test(a.textContent)) a.textContent = "Catalog";
    }
    // Communities → Groups (sidebar), optional. Query the LIVE list — React
    // swaps the whole <ul> on navigation, so the startup `list` reference goes
    // stale and querying it would miss the re-rendered items.
    if (settings.features.renameGroups) {
      const l = sidebarList();
      if (l) for (const span of l.querySelectorAll("span")) {
        if (span.children.length === 0 && span.textContent.trim() === "Communities") span.textContent = "Groups";
      }
    }
    // the "Robux" text tab in the top bar (icon button stays)
    for (const a of document.querySelectorAll(".rbx-navbar a")) {
      if (a.textContent.trim() === "Robux") a.closest("li")?.style.setProperty("display", "none");
    }
    // selected-state pill for OUR sidebar items (Charts/Catalog)
    for (const li of document.querySelectorAll("[data-cer-route]")) {
      li.classList.toggle("cer-side-active", location.pathname.startsWith(li.dataset.cerRoute));
    }
  }
  applyRenames();

  // ---- enforce the sidebar order ----
  // username, robux, search, then: home profile friends avatar catalog charts
  // groups [everything else] chat settings

  const ORDER = [
    [/^home$/i, 10],
    [/^profile$/i, 11],
    [/^friends/i, 12],
    [/^avatar$/i, 13],
    [/^catalog$/i, 14],
    [/^charts$/i, 15],
    [/^(groups|communities)$/i, 16],
    [/^create$/i, 17],
    [/^messages$/i, 18],
    [/^chat$/i, 60],
    [/settings/i, 99],
  ];

  function applyOrder() {
    const l = sidebarList();
    if (!l) return;
    l.style.display = "flex";
    l.style.flexDirection = "column";
    const lis = [...l.children];
    lis.forEach((li, index) => {
      const label = li.textContent.trim().replace(/\s*\d+$/, "");
      if (index === 0) return void (li.style.order = 0); // username stays first
      if (li.classList.contains("cer-side-robux-li")) return void (li.style.order = 1);
      if (li.classList.contains("cer-side-pending-li")) return void (li.style.order = 2);
      if (li.classList.contains("cer-side-search-li")) return void (li.style.order = 3);
      const match = ORDER.find(([re]) => re.test(label));
      li.style.order = match ? match[1] : 50; // unlisted (Create, Messages…) before Chat/Settings
    });
  }
  applyOrder();

  // React re-renders the sidebar on navigation and drops our flex `order`,
  // which made the Friends item jump. Re-apply order on every sidebar mutation.
  // coalesce to one applyOrder per frame — React fires many attribute/childList
  // mutations per re-render and re-sorting on each was pure waste
  let orderScheduled = false;
  const orderObserver = new MutationObserver(() => {
    if (orderScheduled) return;
    orderScheduled = true;
    requestAnimationFrame(() => { orderScheduled = false; applyOrder(); });
  });
  const l0 = sidebarList();
  if (l0) orderObserver.observe(l0, { childList: true, attributes: true, subtree: true });

  // keep our widgets + renames + order alive through React re-renders
  const keepAlive = setInterval(() => {
    if (!CER.alive?.()) return clearInterval(keepAlive); // stop once the extension reloads
    if (!settings.features.showTopBar && widgets.length && !document.contains(widgets[0])) {
      const l = sidebarList();
      if (l) {
        const userLi = l.querySelector(":scope > li");
        let after = userLi;
        for (const w of widgets) {
          after ? after.insertAdjacentElement("afterend", w) : l.prepend(w);
          after = w;
        }
      }
    }
    applyRenames();
    applyOrder();
  }, 3000);
})();
