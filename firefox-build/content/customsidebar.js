// CER Custom Sidebar — our own always-present left nav, built from Roblox's
// OWN utility classes + icon fonts so it's visually identical, then Roblox's
// real nav (.left-nav) and top bar (.rbx-header) are hidden so nothing can
// fight it. Works on any account/browser regardless of Roblox's rollout.

(async function () {
  if (typeof CER === "undefined") return;
  const settings = await CER.get();
  if (!settings.features.customSidebar) return;
  if (document.querySelector(".cer-custom-nav")) return;

  // Roblox's own nav + top bar are hidden by styles.css under html.cer-cnav,
  // which theme.js sets at document_start — so they never paint at all
  // (injecting a <style> from here, at idle, let them flash first).
  document.documentElement.classList.add("cer-cnav");
  // Roblox's #wrap reserves 288px for the left-nav via this class. Keep it so
  // content sits beside our nav — but DON'T add extra margin (that double-gaps
  // accounts that already have the class).
  function reserveSpace() {
    const wrap = document.querySelector("#wrap");
    if (wrap && !wrap.classList.contains("left-nav-new-width")) wrap.classList.add("left-nav-new-width");
  }
  reserveSpace();

  const meP = CER.me();
  let navWanted = true;

  // ---- build the nav ----

  const nav = CER.el("nav", "cer-custom-nav");
  const inner = CER.el("div", "cer-cnav-inner");
  nav.appendChild(inner);

  // item styled exactly like Roblox's (its classes + icon font)
  function item({ label, href, icon, svgName, onClick, badge }) {
    const li = CER.el("li", "cer-cnav-li");
    const a = CER.el(
      "a",
      "content-emphasis text-title-large flex items-center gap-small padding-left-xsmall padding-right-xxsmall radius-medium relative clip group/interactable cer-cnav-item"
    );
    if (href) a.href = href;
    a.appendChild(CER.el("div", "absolute inset-[0] transition-colors cer-cnav-overlay"));
    const iconWrap = CER.el("span", "size-1000 grow-0 shrink-0 basis-auto flex justify-center items-center cer-cnav-iconwrap");
    if (icon) iconWrap.appendChild(CER.el("span", "grow-0 shrink-0 basis-auto icon " + icon + " cer-cnav-icon"));
    else if (svgName) iconWrap.appendChild(CER.svg(svgName));
    a.appendChild(iconWrap);
    const text = CER.el("span", "min-width-0 text-truncate-end text-no-wrap", label);
    a.appendChild(text);
    if (badge) {
      const b = CER.el("span", "cer-cnav-badge", badge);
      a.appendChild(b);
    }
    if (onClick) {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(a);
      });
    }
    li.appendChild(a);
    return { li, a, href };
  }

  // --- username row (built now, filled when the user fetch lands; removed
  //     if logged out) ---
  const userLi = CER.el("li", "cer-cnav-li cer-cnav-user");
  const ua = CER.el("a", "content-emphasis text-title-large flex items-center gap-small radius-medium relative clip cer-cnav-item");
  const av = CER.el("img", "cer-cnav-avatar");
  av.alt = "";
  ua.appendChild(av);
  const uname = CER.el("span", "min-width-0 text-truncate-end text-no-wrap", "");
  ua.appendChild(uname);
  userLi.appendChild(ua);
  inner.appendChild(userLi);

  // --- robux (click → transactions / buy dropdown) ---
  const robuxLi = CER.el("li", "cer-cnav-li cer-cnav-robux-li");
  const robuxBtn = CER.el("button", "cer-cnav-robux");
  const robuxIcon = CER.svg("robux", 16);
  robuxIcon.classList.add("cer-cnav-robux-icon");
  robuxBtn.appendChild(robuxIcon);
  const robuxAmt = CER.el("span", "", "…");
  robuxBtn.appendChild(robuxAmt);
  robuxLi.appendChild(robuxBtn);
  inner.appendChild(robuxLi);
  robuxBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelector(".cer-ctx")?.remove();
    const menu = CER.el("div", "cer-ctx");
    for (const [t, h] of [["Transactions", "https://www.roblox.com/transactions"], ["Buy Robux", "https://www.roblox.com/upgrades/robux"]]) {
      const it = CER.el("a", "cer-ctx-item", t);
      it.href = h;
      menu.appendChild(it);
    }
    const r = robuxBtn.getBoundingClientRect();
    menu.style.left = r.left + "px";
    menu.style.top = r.bottom + 4 + "px";
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
  });
  // robux + online count are cached for a minute per tab, so clicking around
  // the site doesn't refetch them (the friends one is a full friend list +
  // a presence lookup) on every single page
  const cached = (key, maxAge) => {
    try {
      const c = JSON.parse(sessionStorage.getItem("cer-" + key));
      return c && Date.now() - c.t < maxAge ? c.v : undefined;
    } catch {
      return undefined;
    }
  };
  const cache = (key, v) => {
    try {
      sessionStorage.setItem("cer-" + key, JSON.stringify({ t: Date.now(), v }));
    } catch {}
  };
  const showRobux = (n) => (robuxAmt.textContent = Number(n ?? 0).toLocaleString());
  const robuxCached = cached("robux", 60000);
  if (robuxCached !== undefined) showRobux(robuxCached);
  else
    fetch("https://economy.roblox.com/v1/user/currency", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        showRobux(d.robux);
        cache("robux", d.robux ?? 0);
      })
      .catch(() => (robuxAmt.textContent = ""));

  // --- search ---
  const searchLi = CER.el("li", "cer-cnav-li cer-cnav-search-li");
  const searchWrap = CER.el("div", "cer-cnav-search-wrap");
  searchWrap.innerHTML =
    '<svg class="cer-cnav-search-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4-4"/></svg>';
  const search = CER.el("input", "cer-cnav-search");
  search.type = "search";
  search.placeholder = "Search Roblox";
  searchWrap.appendChild(search);
  searchLi.appendChild(searchWrap);

  // typing opens a where-to-search dropdown: Games / People / Catalog / Groups
  const SEARCH_TARGETS = [
    ["Games", { svg: "controller" }, (q) => "https://www.roblox.com/discover?Keyword=" + q],
    ["People", { icon: "icon-regular-two-people" }, (q) => "https://www.roblox.com/search/users?keyword=" + q],
    ["Catalog", { icon: "icon-regular-building-store" }, (q) => "https://www.roblox.com/catalog/?Keyword=" + q],
    ["Groups", { icon: "icon-regular-three-people" }, (q) => "https://www.roblox.com/search/communities?keyword=" + q],
  ];

  const searchMenu = CER.el("div", "cer-search-menu");
  searchLi.appendChild(searchMenu);

  function updateSearchMenu() {
    const q = search.value.trim();
    searchMenu.textContent = "";
    if (!q) {
      searchMenu.classList.remove("cer-search-menu-open");
      return;
    }
    searchMenu.classList.add("cer-search-menu-open");
    for (const [label, iconDef, urlFor] of SEARCH_TARGETS) {
      const row = CER.el("button", "cer-search-opt");
      const iconWrap = CER.el("span", "cer-search-opt-icon");
      if (iconDef.svg) iconWrap.appendChild(CER.svg(iconDef.svg, 16));
      else iconWrap.appendChild(CER.el("span", "icon " + iconDef.icon));
      row.appendChild(iconWrap);
      row.appendChild(CER.el("span", "", label));
      row.appendChild(CER.el("span", "cer-search-opt-q", "“" + (q.length > 16 ? q.slice(0, 16) + "…" : q) + "”"));
      row.addEventListener("mousedown", (e) => {
        e.preventDefault(); // fire before the input's blur closes the menu
        location.href = urlFor(encodeURIComponent(q));
      });
      searchMenu.appendChild(row);
    }
  }
  search.addEventListener("input", updateSearchMenu);
  search.addEventListener("focus", updateSearchMenu);
  search.addEventListener("blur", () => setTimeout(() => searchMenu.classList.remove("cer-search-menu-open"), 150));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && search.value.trim()) {
      location.href = SEARCH_TARGETS[0][2](encodeURIComponent(search.value.trim()));
    }
    if (e.key === "Escape") searchMenu.classList.remove("cer-search-menu-open");
  });
  inner.appendChild(searchLi);

  // --- nav items (Roblox icon-font classes; SVG fallback for the two Roblox
  //     doesn't expose cleanly) ---
  const groupsLabel = settings.features.renameGroups ? "Groups" : "Communities";
  const navItems = [
    { label: "Home", href: "https://www.roblox.com/home", icon: "icon-regular-house" },
    { label: "Profile", href: "https://www.roblox.com/users/profile", icon: "icon-regular-person" },
    { label: "Friends", href: "https://www.roblox.com/users/friends", icon: "icon-regular-two-people" },
    { label: "Avatar", href: "https://www.roblox.com/my/avatar", icon: "icon-regular-person-standing" },
    { label: "Catalog", href: "https://www.roblox.com/catalog", icon: "icon-regular-building-store" },
    { label: "Games", href: "https://www.roblox.com/charts", svgName: "controller" },
    { label: groupsLabel, href: "https://www.roblox.com/communities", icon: "icon-regular-three-people" },
    { label: "Create", href: "https://create.roblox.com/", icon: "icon-regular-fountain-pen-nib" },
    { label: "Messages", href: "https://www.roblox.com/my/messages", svgName: "mail" },
    // optional/hideable ones
    { label: "Inventory", href: "https://www.roblox.com/users/inventory", icon: "icon-regular-backpack", opt: true },
    { label: "Trade", href: "https://www.roblox.com/trades", icon: "icon-regular-hand-two-arrows-horizontal", opt: true },
  ];

  const built = [];
  for (const def of navItems) {
    if (def.opt && settings.sidebarPrefs[def.label] !== "show") continue; // opt items (Inventory, Trade) are hidden unless turned on
    const b = item(def);
    inner.appendChild(b.li);
    built.push(b);
  }

  // Chat (our panel) + Settings (dropdown) at the bottom. Only show Chat when
  // the custom chat feature is on — hiding chat should remove the button too.
  let chatItem = null;
  if (settings.features.customChat) {
    chatItem = item({ label: "Chat", icon: "icon-regular-speech-bubble-align-center", onClick: () => CER.toggleChat?.() });
    inner.appendChild(chatItem.li);
  }

  const settingsItem = item({
    label: "Settings",
    svgName: "gear",
    onClick: (anchor) => openSettingsMenu(anchor),
  });
  inner.appendChild(settingsItem.li);
  if (chatItem) built.push(chatItem);
  built.push(settingsItem);

  // highlight the item matching the current page
  function highlight() {
    const path = location.pathname;
    for (const b of built) {
      if (!b.href) continue;
      let match = false;
      try {
        const u = new URL(b.href);
        match = u.hostname.includes("roblox.com") && path.startsWith(u.pathname) && u.pathname !== "/";
        if (u.pathname === "/home" && path.startsWith("/home")) match = true;
      } catch {}
      b.a.classList.toggle("cer-cnav-selected", match);
    }
  }
  highlight();
  CER.onNavigate?.(highlight);

  // fill in everything that needs our user id
  const friendsItem = built.find((b) => b.a.textContent.includes("Friends"));
  const profileItem = built.find((b) => b.a.textContent.includes("Profile"));
  meP.then((me) => {
    if (!me) {
      // logged out: Roblox's own header has the Log In / Sign Up buttons, so
      // hand the page back to it instead of a nav full of login bounces
      navWanted = false;
      nav.remove();
      vtagEl?.remove();
      document.documentElement.classList.remove("cer-cnav");
      return;
    }
    ua.href = "https://www.roblox.com/users/" + me.id + "/profile";
    uname.textContent = me.displayName || me.name;
    if (profileItem) {
      profileItem.a.href = profileItem.href = ua.href;
      highlight();
    }
    fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${me.id}&size=48x48&format=Png&isCircular=true`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => (av.src = d.data?.[0]?.imageUrl ?? ""))
      .catch(() => {});
    if (!friendsItem) return;
    const showOnline = (online) => {
      if (online > 0) friendsItem.a.appendChild(CER.el("span", "cer-cnav-badge", String(online)));
    };
    const onlineCached = cached("online", 60000);
    if (onlineCached !== undefined) return showOnline(onlineCached);
    // not urgent: wait until the page is idle
    (window.requestIdleCallback ?? ((f) => setTimeout(f, 1500)))(async () => {
      try {
        const friends = (await (await fetch(`https://friends.roblox.com/v1/users/${me.id}/friends`, { credentials: "include" })).json()).data ?? [];
        let online = 0;
        // presence takes at most 100 ids per call
        for (let i = 0; i < friends.length; i += 100) {
          const pres = await CER.bgFetch("https://presence.roblox.com/v1/presence/users", "POST", { userIds: friends.slice(i, i + 100).map((f) => f.id) });
          online += (pres.data?.userPresences ?? []).filter((p) => p.userPresenceType > 0).length;
        }
        cache("online", online);
        showOnline(online);
      } catch {}
    });
  });

  function openSettingsMenu(anchor) {
    document.querySelector(".cer-ctx")?.remove();
    const menu = CER.el("div", "cer-ctx");
    const cer = CER.el("button", "cer-ctx-item", "CER Settings");
    cer.addEventListener("click", () => { menu.remove(); CER.openSettings?.(); });
    menu.appendChild(cer);
    const rbx = CER.el("a", "cer-ctx-item", "Roblox Settings");
    rbx.href = "https://www.roblox.com/my/account";
    menu.appendChild(rbx);
    const out = CER.el("button", "cer-ctx-item", "Log Out");
    out.addEventListener("click", async () => {
      if (!out.dataset.arm) { out.dataset.arm = "1"; out.textContent = "Log out? Tap again"; return; }
      await CER.bgFetch("https://auth.roblox.com/v2/logout", "POST", {});
      location.href = "https://www.roblox.com/";
    });
    menu.appendChild(out);
    const r = anchor.getBoundingClientRect();
    menu.style.left = r.left + "px";
    menu.style.top = r.top - 8 - 3 * 42 + "px";
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
  }

  document.body.appendChild(nav);


  // version tag at the bottom of the page (sidebar.js used to add this, but
  // it's short-circuited when the custom sidebar is on)
  let vtagEl = null;
  if (!document.querySelector(".cer-version-tag")) {
    const vtag = (vtagEl = CER.el("button", "cer-version-tag", "Canardev's Enhanced Roblox v" + CER.ext.runtime.getManifest().version));
    vtag.addEventListener("click", () => CER.openSettings?.("About"));
    document.body.appendChild(vtag);
  }

  // Roblox can replace <body> children or drop the #wrap class on re-render.
  // Only direct children of body matter for the nav, and #wrap only needs a
  // re-check when it changes — no subtree observer over the whole page.
  new MutationObserver(() => {
    if (!CER.alive?.()) return;
    if (!navWanted) return;
    if (!nav.isConnected) document.body.appendChild(nav);
    reserveSpace();
  }).observe(document.body, { childList: true });
  const wrapEl = document.querySelector("#wrap");
  if (wrapEl) new MutationObserver(reserveSpace).observe(wrapEl, { attributes: true, attributeFilter: ["class"] });
})();
