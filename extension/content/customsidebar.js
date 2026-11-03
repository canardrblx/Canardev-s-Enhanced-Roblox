// CER sidebar: the always-present left nav that frames every page. Built only
// from CER's design system (ui.css tokens + CER.ui icons), never from Roblox's
// classes, so a Roblox update can't change how it looks. Roblox's own nav and
// top bar are hidden by styles.css under html.cer-cnav (set by theme.js at
// document_start), so they never paint.
//
// Speed: the nav paints synchronously from a small localStorage snapshot of
// the last visit (name, headshot, Robux, which items to show). Live data then
// refreshes it in place. No awaits before the first paint.

(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  if (document.querySelector(".cer-custom-nav")) return;
  const { h, icon } = CER.ui;
  const root = document.documentElement;

  // ---- snapshot of the last visit (sync) ----
  const SNAP_KEY = "cer:shell";
  let snap = {};
  try {
    snap = JSON.parse(localStorage.getItem(SNAP_KEY)) || {};
  } catch {
    snap = {};
  }
  const saveSnap = (patch) => {
    snap = { ...snap, ...patch };
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify(snap));
    } catch {
      /* storage off: next visit just paints without the snapshot */
    }
  };

  // theme.js adds html.cer-cnav at document_start when the feature is on.
  // If its storage read hasn't landed yet, fall back to reading settings.
  if (root.classList.contains("cer-cnav")) start();
  else
    CER.get().then((s) => {
      if (s.features.customSidebar) {
        root.classList.add("cer-cnav");
        start();
      }
    });

  function start() {
    // Known logged out last time: wait for the login check instead of
    // flashing a nav full of login bounces.
    if (snap.me === null) {
      root.classList.remove("cer-cnav");
      CER.me().then((me) => {
        if (!me) return;
        root.classList.add("cer-cnav");
        build();
      });
      return;
    }
    build();
  }

  function build() {
    // Roblox's #wrap reserves the nav's 288px via this class. Keep it.
    const reserveSpace = () => {
      const wrap = document.querySelector("#wrap");
      if (wrap && !wrap.classList.contains("left-nav-new-width")) wrap.classList.add("left-nav-new-width");
    };
    reserveSpace();

    // ---- icons CER.ui doesn't have yet (same 24 grid, stroke style) ----
    const EXTRA = {
      gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
      logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
      swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
      pen: '<path d="M12 19l7-7 3 3-7 7-3-3Z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5ZM2 2l7.59 7.59"/><circle cx="11" cy="11" r="2"/>',
      phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    };
    const ic = (name, size = 20) => {
      if (!EXTRA[name]) return icon(name, size);
      const s = icon("", size);
      s.innerHTML = EXTRA[name]; // static strings from the table above only
      return s;
    };

    const nav = h("nav", { class: "cer-ui cer-custom-nav", "aria-label": "Main" });
    const inner = h("div", { class: "cer-cnav-inner" });
    nav.appendChild(inner);

    // ---- account card: avatar + name, Robux row ----
    const avatarImg = h("img", { class: "cer-cnav-avatar-img", alt: "", draggable: "false" });
    const showHead = (url) => {
      if (!url) return;
      avatarImg.onload = () => avatarImg.classList.add("is-in");
      avatarImg.src = url;
    };
    const nameEl = h("span", { class: "cer-cnav-me-name" });
    const userEl = h("span", { class: "cer-cnav-me-user" });
    const meLink = h(
      "a",
      { class: "cer-cnav-me", href: "https://www.roblox.com/users/profile", title: "Your profile" },
      h("span", { class: "cer-cnav-avatar" }, avatarImg),
      h("span", { class: "cer-cnav-me-text" }, nameEl, userEl)
    );
    const showMe = (me) => {
      if (!me) return;
      nameEl.textContent = me.displayName || me.name || "";
      userEl.textContent = me.name ? "@" + me.name : "";
      meLink.href = "https://www.roblox.com/users/" + me.id + "/profile";
    };

    const robuxAmt = h("span", { class: "cer-cnav-robux-amt", text: "" });
    const robuxBtn = h(
      "button",
      { type: "button", class: "cer-cnav-robux", title: "Your Robux", "aria-haspopup": "menu" },
      h("span", { class: "cer-cnav-robux-ic" }, ic("robux", 18)),
      robuxAmt,
      h("span", { class: "cer-cnav-robux-more" }, ic("down", 16))
    );
    const showRobux = (n) => {
      robuxAmt.textContent = n == null ? "" : Number(n).toLocaleString();
      robuxBtn.classList.toggle("is-loading", n == null);
    };
    robuxBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      popMenu(robuxBtn, [
        { label: "Buy Robux", icon: "plus", href: "https://www.roblox.com/upgrades/robux" },
        { label: "Transactions", icon: "list", href: "https://www.roblox.com/transactions" },
      ]);
    });
    inner.appendChild(h("div", { class: "cer-cnav-card" }, meLink, robuxBtn));

    showMe(snap.me);
    showHead(snap.head);
    showRobux(snap.robux);

    // ---- search with a where-to-search menu ----
    const SEARCH_TARGETS = [
      { label: "Games", icon: "gamepad", url: (q) => "https://www.roblox.com/discover?Keyword=" + q },
      { label: "People", icon: "users", url: (q) => "https://www.roblox.com/search/users?keyword=" + q },
      { label: "Catalog", icon: "bag", url: (q) => "https://www.roblox.com/catalog/?Keyword=" + q },
      { label: "Groups", icon: "shield", url: (q) => "https://www.roblox.com/search/communities?keyword=" + q },
    ];
    const searchBox = CER.ui.search("Search Roblox", { class: "cer-cnav-searchbox" });
    const input = searchBox.input;
    input.setAttribute("aria-label", "Search Roblox");
    input.setAttribute("aria-controls", "cer-cnav-menu");
    const menu = h("div", { class: "cer-cnav-menu", id: "cer-cnav-menu", role: "listbox" });
    let activeIdx = 0;
    const go = (i) => {
      const q = input.value.trim();
      if (q) location.href = SEARCH_TARGETS[i].url(encodeURIComponent(q));
    };
    function renderMenu() {
      const q = input.value.trim();
      menu.replaceChildren();
      const open = !!q && document.activeElement === input;
      menu.classList.toggle("is-open", open);
      if (!open) return;
      menu.appendChild(h("div", { class: "cer-cnav-menu-head", text: "Search in" }));
      SEARCH_TARGETS.forEach((t, i) => {
        const row = h(
          "button",
          { type: "button", role: "option", class: "cer-cnav-opt" + (i === activeIdx ? " is-active" : ""), "aria-selected": i === activeIdx ? "true" : "false" },
          h("span", { class: "cer-cnav-opt-ic" }, ic(t.icon, 17)),
          h("span", { class: "cer-cnav-opt-label", text: t.label }),
          h("span", { class: "cer-cnav-opt-q", text: q }),
          h("span", { class: "cer-cnav-opt-go" }, ic("arrowRight", 15))
        );
        // mousedown fires before the input's blur closes the menu
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          go(i);
        });
        row.addEventListener("mouseenter", () => {
          activeIdx = i;
          for (const [j, el] of [...menu.querySelectorAll(".cer-cnav-opt")].entries()) el.classList.toggle("is-active", j === i);
        });
        menu.appendChild(row);
      });
    }
    input.addEventListener("input", () => {
      activeIdx = 0;
      renderMenu();
    });
    input.addEventListener("focus", renderMenu);
    input.addEventListener("blur", () => setTimeout(renderMenu, 120));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        activeIdx = (activeIdx + (e.key === "ArrowDown" ? 1 : -1) + SEARCH_TARGETS.length) % SEARCH_TARGETS.length;
        renderMenu();
      } else if (e.key === "Enter") {
        e.preventDefault();
        go(activeIdx);
      } else if (e.key === "Escape") {
        input.blur();
      }
    });
    inner.appendChild(h("div", { class: "cer-cnav-search" }, searchBox, menu));

    // ---- nav items ----
    const list = h("ul", { class: "cer-cnav-list" });
    const foot = h("ul", { class: "cer-cnav-list cer-cnav-foot" });
    inner.append(list, foot);

    let myId = snap.me?.id ?? null;
    const NAV = () => [
      { id: "home", label: "Home", icon: "home", href: "https://www.roblox.com/home", match: (p) => /^\/(home\/?)?$/i.test(p) },
      { id: "profile", label: "Profile", icon: "user", href: myId ? `https://www.roblox.com/users/${myId}/profile` : "https://www.roblox.com/users/profile", match: (p) => (myId ? p.toLowerCase().startsWith(`/users/${myId}/profile`) : false) },
      { id: "friends", label: "Friends", icon: "users", href: "https://www.roblox.com/users/friends", match: (p) => /^\/users\/(\d+\/)?friends/i.test(p) },
      { id: "avatar", label: "Avatar", icon: "shirt", href: "https://www.roblox.com/my/avatar", match: (p) => /^\/my\/avatar/i.test(p) },
      { id: "catalog", label: "Catalog", icon: "bag", href: "https://www.roblox.com/catalog", match: (p) => /^\/(catalog|bundles)(\/|$)/i.test(p) },
      { id: "games", label: "Games", icon: "gamepad", href: "https://www.roblox.com/charts", match: (p) => /^\/(charts|discover|games)(\/|$)/i.test(p) },
      { id: "groups", label: prefs.groupsLabel, icon: "shield", href: "https://www.roblox.com/communities", match: (p) => /^\/(communities|groups)(\/|$)/i.test(p) },
      { id: "create", label: "Create", icon: "pen", href: "https://create.roblox.com/", match: () => false },
      { id: "messages", label: "Messages", icon: "mail", href: "https://www.roblox.com/my/messages", match: (p) => /^\/my\/messages/i.test(p) },
      // optional ones: hidden unless turned on (sidebarPrefs[label] === "show")
      { id: "inventory", label: "Inventory", icon: "box", href: "https://www.roblox.com/users/inventory", opt: true, match: (p) => /^\/users\/(\d+\/)?inventory/i.test(p) },
      { id: "trade", label: "Trade", icon: "swap", href: "https://www.roblox.com/trades", opt: true, match: (p) => /^\/trades/i.test(p) },
    ];

    // prefs that change which items show (snapshot now, settings later)
    let prefs = snap.prefs ?? { groupsLabel: "Groups", opt: [], chat: true };
    let friendsBadge = null;
    let onlineCount = null;

    function item({ label, icon: name, href, onClick, badge, id }) {
      const a = h(
        href ? "a" : "button",
        { class: "cer-cnav-item", href, type: href ? null : "button", "data-id": id },
        h("span", { class: "cer-cnav-ic" }, ic(name, 20)),
        h("span", { class: "cer-cnav-label", text: label }),
        badge
      );
      if (onClick)
        a.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick(a);
        });
      return h("li", { class: "cer-cnav-li" }, a);
    }

    let built = [];
    function renderItems() {
      const defs = NAV().filter((d) => !d.opt || prefs.opt.includes(d.label));
      built = defs.map((d) => {
        const badge = d.id === "friends" ? (friendsBadge = h("span", { class: "cer-cnav-badge", title: "Friends online" })) : null;
        const li = item({ ...d, badge });
        return { li, a: li.firstChild, def: d };
      });
      list.replaceChildren(...built.map((b) => b.li));
      if (onlineCount != null) showOnline(onlineCount);
      const footItems = [];
      if (prefs.chat) footItems.push(item({ id: "chat", label: "Chat", icon: "chat", onClick: () => CER.toggleChat?.() }));
      footItems.push(item({ id: "settings", label: "Settings", icon: "gear", onClick: (a) => openSettingsMenu(a) }));
      foot.replaceChildren(...footItems);
      highlight();
    }

    function highlight() {
      const p = location.pathname;
      for (const b of built) {
        const on = !!b.def.match(p);
        b.a.classList.toggle("is-active", on);
        if (on) b.a.setAttribute("aria-current", "page");
        else b.a.removeAttribute("aria-current");
      }
    }

    function showOnline(n) {
      onlineCount = n;
      if (!friendsBadge) return;
      friendsBadge.replaceChildren();
      friendsBadge.classList.toggle("is-on", n > 0);
      if (n > 0) friendsBadge.append(h("span", { class: "cer-cnav-badge-dot" }), String(n > 99 ? "99+" : n));
      friendsBadge.title = n === 1 ? "1 friend online" : n + " friends online";
    }

    renderItems();
    CER.onNavigate?.(highlight);

    // ---- small popover menu (Robux + Settings) ----
    function popMenu(anchor, entries, { up = false } = {}) {
      document.querySelector(".cer-ctx")?.remove();
      const m = h("div", { class: "cer-ui cer-ctx cer-cnav-pop", role: "menu" });
      for (const en of entries) {
        const el = h(
          en.href ? "a" : "button",
          { class: "cer-ctx-item" + (en.danger ? " is-danger" : ""), href: en.href, type: en.href ? null : "button", role: "menuitem" },
          en.icon && ic(en.icon, 17),
          h("span", { text: en.label })
        );
        if (en.onClick)
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            en.onClick(el, m);
          });
        m.appendChild(el);
      }
      document.body.appendChild(m);
      const r = anchor.getBoundingClientRect();
      m.style.left = r.left + "px";
      m.style.minWidth = Math.max(200, r.width) + "px";
      m.style.top = (up ? r.top - m.offsetHeight - 6 : r.bottom + 6) + "px";
      const close = () => {
        m.remove();
        document.removeEventListener("click", onDoc);
        document.removeEventListener("keydown", onKey);
      };
      const onDoc = (e) => !m.contains(e.target) && close();
      const onKey = (e) => e.key === "Escape" && close();
      setTimeout(() => {
        document.addEventListener("click", onDoc);
        document.addEventListener("keydown", onKey);
      }, 0);
      return m;
    }

    function openSettingsMenu(anchor) {
      popMenu(
        anchor,
        [
          {
            label: "CER settings",
            icon: "sliders",
            onClick: (_, m) => {
              m.remove();
              CER.openSettings?.();
            },
          },
          { label: "Roblox settings", icon: "gear", href: "https://www.roblox.com/my/account" },
          { label: "Quick sign in", icon: "phone", href: "https://www.roblox.com/crossdevicelogin/ConfirmCode" },
          {
            label: "Log out",
            icon: "logout",
            danger: true,
            onClick: async (el) => {
              // two taps, so a stray click never logs anyone out
              if (!el.dataset.arm) {
                el.dataset.arm = "1";
                el.lastChild.textContent = "Tap again to log out";
                return;
              }
              await CER.bgFetch("https://auth.roblox.com/v2/logout", "POST", {});
              location.href = "https://www.roblox.com/";
            },
          },
        ],
        { up: true }
      );
    }

    document.body.appendChild(nav);

    // version tag at the very bottom of the page (opens About)
    let vtagEl = null;
    if (!document.querySelector(".cer-version-tag")) {
      vtagEl = h("button", { type: "button", class: "cer-version-tag", text: "Canardev's Enhanced Roblox v" + CER.ext.runtime.getManifest().version });
      vtagEl.addEventListener("click", () => CER.openSettings?.("About"));
      document.body.appendChild(vtagEl);
    }

    // ---- settings: reconcile the snapshot with the real prefs ----
    CER.get().then((s) => {
      const next = {
        groupsLabel: s.features.renameGroups ? "Groups" : "Communities",
        opt: ["Inventory", "Trade"].filter((l) => s.sidebarPrefs?.[l] === "show"),
        chat: !!s.features.customChat,
      };
      if (JSON.stringify(next) !== JSON.stringify(prefs)) {
        prefs = next;
        renderItems();
      }
      saveSnap({ prefs: next });
    });

    // ---- live data ----
    let navWanted = true;
    CER.me().then((me) => {
      if (!me) {
        // logged out: Roblox's own header has Log In / Sign Up, so hand the
        // page back to it
        navWanted = false;
        nav.remove();
        vtagEl?.remove();
        root.classList.remove("cer-cnav");
        saveSnap({ me: null, head: null, robux: null });
        return;
      }
      const meSnap = { id: me.id, name: me.name, displayName: me.displayName };
      showMe(meSnap);
      if (myId !== me.id) {
        myId = me.id;
        renderItems();
      }
      saveSnap({ me: meSnap });

      CER.api.thumb("headshot", me.id).then((url) => {
        if (!url || url === snap.head) return;
        showHead(url);
        saveSnap({ head: url });
      });

      // Robux: fresh at most once a minute per tab
      const fresh = (key, ms) => {
        try {
          const c = JSON.parse(sessionStorage.getItem("cer-" + key));
          return c && Date.now() - c.t < ms ? c.v : undefined;
        } catch {
          return undefined;
        }
      };
      const stamp = (key, v) => {
        try {
          sessionStorage.setItem("cer-" + key, JSON.stringify({ t: Date.now(), v }));
        } catch {}
      };
      const rbx = fresh("robux", 60000);
      if (rbx !== undefined) showRobux(rbx);
      else
        CER.api.json("https://economy.roblox.com/v1/user/currency").then((d) => {
          if (d?.robux == null) return;
          showRobux(d.robux);
          stamp("robux", d.robux);
          saveSnap({ robux: d.robux });
        });

      // friends online: not urgent, wait for idle; cached a minute per tab
      const on = fresh("online", 60000);
      if (on !== undefined) return showOnline(on);
      (window.requestIdleCallback ?? ((f) => setTimeout(f, 1500)))(async () => {
        const j = await CER.api.json(`https://friends.roblox.com/v1/users/${me.id}/friends`, { ttl: 60000 });
        const ids = (j?.data ?? []).map((f) => f.id);
        if (!j) return;
        const pres = ids.length ? await CER.api.presence(ids) : new Map();
        let n = 0;
        for (const p of pres.values()) if (p.userPresenceType > 0) n++;
        stamp("online", n);
        showOnline(n);
      });
    });

    // Roblox can replace <body> children or drop the #wrap class on re-render.
    // Only body's direct children are watched, never the whole page.
    new MutationObserver(() => {
      if (!CER.alive?.() || !navWanted) return;
      if (!nav.isConnected) document.body.appendChild(nav);
      reserveSpace();
    }).observe(document.body, { childList: true });
    const wrapEl = document.querySelector("#wrap");
    if (wrapEl) new MutationObserver(reserveSpace).observe(wrapEl, { attributes: true, attributeFilter: ["class"] });
  }
})();
