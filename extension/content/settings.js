// CER's own settings panel, plus its entry points:
//   1. "Settings" in Roblox's left nav (only when CER's sidebar is off; CER's
//      sidebar has its own Settings item)
//   2. an item inside Roblox's header gear dropdown (only while that header
//      can show)
//   3. a tab on Roblox's own account page (only when that page isn't ours)
// The panel itself is built from CER.ui pieces (tokens, toggles, cards), so it
// looks like the rest of CER and never depends on Roblox's markup.
// Other scripts open it via CER.openSettings(tabName).

(async function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { h, icon } = CER.ui;

  const BAC = { name: "Build a Country", placeId: "82958998841721", universeId: "10200442730" };
  // id = the name callers pass to CER.openSettings(tab)
  // id = what callers pass to CER.openSettings(tab). Old tab names still work.
  const TABS = [
    { id: "Features", label: "Features" },
    { id: "Themes", label: "Themes" },
    { id: "Playtime", label: "Playtime" },
    { id: "Join", label: "Join" },
    { id: "About", label: "About" },
  ];
  const ALIAS = { Home: "Features", "Roblox UI": "Features" };
  const tabFor = (id) => TABS.find((t) => t.id === (ALIAS[id] ?? id))?.id ?? "Features";

  CER.openSettings = openPanel;

  // Toasts get CER's look: tokens come from .cer-ui on their host.
  const baseToast = CER.toast;
  if (baseToast && !baseToast.cerShell) {
    CER.toast = function (message, kind) {
      const t = baseToast(message, kind);
      t?.parentElement?.classList.add("cer-ui");
      if (t && kind === "error") t.prepend(icon("info", 17));
      return t;
    };
    CER.toast.cerShell = true;
  }

  // ---- entry point 1: bottom of Roblox's left sidebar ----

  function findSidebarList() {
    for (const ul of document.querySelectorAll("ul")) {
      const links = [...ul.querySelectorAll(":scope > li a")];
      if (links.some((a) => a.textContent.trim().toLowerCase() === "home") && links.some((a) => a.textContent.trim().toLowerCase() === "profile")) {
        return ul;
      }
    }
    return null;
  }

  const bootSettings = await CER.get();
  const customSidebar = !!bootSettings.features?.customSidebar;
  const sidebarList = customSidebar ? null : await CER.waitFor(findSidebarList, 12000).catch(() => null);

  // "Settings" item in Roblox's nav: a small menu with CER Settings, Roblox
  // Settings, Quick Sign In, Log Out.
  function openSettingsMenu(anchor) {
    document.querySelector(".cer-ctx")?.remove();
    const menu = h("div", { class: "cer-ui cer-ctx", role: "menu" });
    const add = (label, name, opts = {}) => {
      const el = h(opts.href ? "a" : "button", { class: "cer-ctx-item" + (opts.danger ? " is-danger" : ""), href: opts.href, type: opts.href ? null : "button", role: "menuitem" }, icon(name, 17), h("span", { text: label }));
      if (opts.onClick) el.addEventListener("click", () => opts.onClick(el));
      menu.appendChild(el);
    };
    add("CER settings", "sliders", { onClick: () => (menu.remove(), openPanel()) });
    add("Roblox settings", "user", { href: "https://www.roblox.com/my/account" });
    add("Quick sign in", "zap", { href: "https://www.roblox.com/crossdevicelogin/ConfirmCode" });
    add("Log out", "arrowRight", {
      danger: true,
      onClick: async (el) => {
        if (!el.dataset.arm) {
          el.dataset.arm = "1";
          el.lastChild.textContent = "Tap again to log out";
          return;
        }
        await CER.robloxWrite("https://auth.roblox.com/v2/logout", "POST", {}).catch(() => {});
        location.href = "https://www.roblox.com/";
      },
    });
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = r.left + "px";
    menu.style.top = r.top - menu.offsetHeight - 6 + "px"; // open upward, above the item
    setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
  }

  function stripActiveState(li) {
    for (const el of [li, ...li.querySelectorAll("*")]) {
      el.removeAttribute("aria-current");
      for (const cls of [...el.classList]) {
        if (/^bg-|active|selected|current/i.test(cls)) el.classList.remove(cls);
      }
    }
  }

  if (sidebarList) {
    // Deep-clone a real item (Profile) so it sits in Roblox's own nav
    // naturally (this path only runs when CER's sidebar is off).
    const template = [...sidebarList.querySelectorAll(":scope > li")].find((li) => li.querySelector("a")?.textContent.trim().toLowerCase() === "profile");
    let li;
    if (template) {
      li = template.cloneNode(true);
      stripActiveState(li);
      li.classList.add("cer-nav-li");
      const a = li.querySelector("a");
      a.removeAttribute("href");
      const ic = li.querySelector('[class*="icon-"], .cer-side-glyph');
      if (ic) {
        ic.className = "cer-side-glyph";
        ic.textContent = "";
        ic.appendChild(CER.gearIcon());
      }
      const textSpan = [...li.querySelectorAll("span")].find((s) => s.children.length === 0 && s.textContent.trim().toLowerCase() === "profile");
      if (textSpan) textSpan.textContent = "Settings";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSettingsMenu(li);
      });
    } else {
      li = h("li", { class: "cer-nav-li" });
      const link = h("a", { href: "#" }, h("span", { class: "cer-side-glyph" }, CER.gearIcon()), h("span", { text: "Settings" }));
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSettingsMenu(li);
      });
      li.appendChild(link);
    }
    const upsellLi = [...sidebarList.children].find((l) => /less robux|subscribe/i.test(l.textContent));
    sidebarList.insertBefore(li, upsellLi ?? null);

    // Roblox's React re-renders can wipe foreign nodes: put ours back.
    const keep = setInterval(() => {
      if (!CER.alive?.()) return clearInterval(keep);
      if (!document.contains(li)) {
        const list = findSidebarList();
        if (list) {
          const upsell = [...list.children].find((l) => /less robux|subscribe/i.test(l.textContent));
          list.insertBefore(li, upsell ?? null);
        }
      }
    }, 3000);
  }

  // ---- entry point 2: Roblox's header gear dropdown ----
  // Only while that header can show (CER's sidebar hides it otherwise), so
  // most pages never pay for this observer.
  if (!customSidebar || bootSettings.features?.showTopBar) {
    const dropdownObserver = new MutationObserver(() => {
      const accountLink = document.querySelector('ul.dropdown-menu a[href*="/my/account"], .popover a[href*="/my/account"]');
      if (!accountLink || !accountLink.offsetParent) return;
      const listItem = accountLink.closest("li");
      if (!listItem || listItem.parentElement.querySelector(".cer-dropdown-item")) return;
      const ours = listItem.cloneNode(true);
      ours.classList.add("cer-dropdown-item");
      const ourLink = ours.querySelector("a");
      ourLink.removeAttribute("href");
      ourLink.textContent = "CER Settings";
      ourLink.addEventListener("click", (e) => {
        e.preventDefault();
        openPanel();
      });
      listItem.parentElement.insertBefore(ours, listItem.nextSibling);
    });
    dropdownObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ---- entry point 3: Roblox's account settings page (/my/account) ----
  // Skipped when CER's own account page is showing there.
  if (location.pathname.startsWith("/my/account") && !document.documentElement.classList.contains("cer-takeover")) {
    CER.waitFor(() => {
      const tab = [...document.querySelectorAll("li a, li span")].find((e) => e.children.length === 0 && /^account info$/i.test(e.textContent.trim()));
      return tab?.closest("li") ?? null;
    }, 12000)
      .then((accountInfoLi) => {
        const ours = accountInfoLi.cloneNode(true);
        ours.classList.add("cer-account-tab");
        for (const el of [ours, ...ours.querySelectorAll("*")]) {
          for (const cls of [...el.classList]) {
            if (/active|selected|current/i.test(cls)) el.classList.remove(cls);
          }
        }
        const label = [...ours.querySelectorAll("a, span")].find((e) => e.children.length === 0);
        if (label) label.textContent = "CER Settings";
        ours.querySelector("a")?.removeAttribute("href");
        ours.addEventListener("click", (e) => {
          e.preventDefault();
          openPanel();
        });
        accountInfoLi.parentElement.appendChild(ours);
      })
      .catch(() => {});
  }

  // ---- building blocks ----

  // One setting: a name, an optional hint (only when the name alone is
  // unclear), a control on the right. A <label> so the whole row flips it.
  function row(name, hint, control, tag = "label") {
    return h(tag, { class: "cer-sp-row" }, h("span", { class: "cer-sp-row-text" }, h("span", { class: "cer-sp-row-name", text: name }), hint && h("span", { class: "cer-sp-row-hint", text: hint })), control);
  }
  // A plain titled list of rows.
  function group(title, kids) {
    return h("section", { class: "cer-sp-group" }, title && h("h3", { class: "cer-sp-group-title", text: title }), h("div", { class: "cer-sp-list" }, kids));
  }
  // a two-tap button for things that can't be undone
  function armed(label, sure, run) {
    const b = CER.ui.button(label, { variant: "danger", size: "sm" });
    const text = b.querySelector("span");
    let t = null;
    b.addEventListener("click", async () => {
      if (!b.dataset.arm) {
        b.dataset.arm = "1";
        text.textContent = sure;
        t = setTimeout(() => {
          delete b.dataset.arm;
          text.textContent = label;
        }, 4000);
        return;
      }
      clearTimeout(t);
      await run();
    });
    return b;
  }
  const featureToggle = (settings, key, after) =>
    CER.ui.toggle(!!settings.features[key], async (on) => {
      const cur = await CER.get();
      await CER.set({ features: { ...cur.features, [key]: on } });
      after?.(on);
    });

  // ---- the panel ----

  async function openPanel(startTab) {
    const existing = document.getElementById("cer-panel-overlay");
    if (existing) {
      if (startTab) existing.showTab?.(tabFor(startTab));
      return;
    }

    // Most features set up the page once on load, so a change only shows
    // after a reload: a Reload button appears, and closing asks once.
    let dirty = false;
    let closeArmed = false;
    const markDirty = () => {
      if (dirty) return;
      dirty = true;
      reloadBtn.hidden = false;
    };
    const close = () => {
      overlay.classList.remove("is-in");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => overlay.remove(), 160);
    };
    const attemptClose = () => {
      if (dirty && !closeArmed) {
        closeArmed = true;
        warn.hidden = false;
        return;
      }
      close();
    };
    const onKey = (e) => e.key === "Escape" && attemptClose();

    const reloadBtn = CER.ui.button("Reload", { icon: "refresh", variant: "primary", size: "sm", onClick: () => location.reload() });
    reloadBtn.hidden = true;
    const closeBtn = CER.ui.button("", { icon: "x", variant: "ghost", size: "sm", title: "Close", onClick: attemptClose });
    const warn = h("div", { class: "cer-sp-banner" }, h("span", { text: "Reload to see your changes. Close again to skip." }));
    warn.hidden = true;

    let current = tabFor(startTab);
    const tabs = CER.ui.tabs(
      TABS.map((t) => ({ id: t.id, label: t.label })),
      current,
      (id) => show(id)
    );
    const body = h("div", { class: "cer-sp-body" });
    const panel = h(
      "div",
      { class: "cer-sp", role: "dialog", "aria-modal": "true", "aria-label": "CER settings" },
      h("header", { class: "cer-sp-head" }, h("h2", { class: "cer-sp-title", text: "Settings" }), tabs, h("span", { class: "cer-sp-head-end" }, reloadBtn, closeBtn)),
      warn,
      body
    );
    const overlay = h("div", { id: "cer-panel-overlay", class: "cer-ui cer-sp-overlay", onClick: (e) => e.target === overlay && attemptClose() }, panel);

    // any toggle/select edit inside the panel needs a reload to take effect
    body.addEventListener("change", markDirty);

    let seq = 0;
    async function show(id) {
      current = tabFor(id);
      tabs.set(current);
      const my = ++seq;
      const view = h("div", { class: "cer-sp-view" });
      const render = { Features: renderFeatures, Themes: renderThemes, Playtime: renderPlaytime, Join: renderJoin, About: renderAbout }[current];
      await render(view, () => show(current));
      if (my !== seq) return; // a newer tab click won
      const keep = body.dataset.tab === current ? body.scrollTop : 0;
      body.replaceChildren(view);
      body.dataset.tab = current;
      body.scrollTop = keep;
    }
    overlay.showTab = show;

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => overlay.classList.add("is-in"));
    await show(current);
  }

  // ---- tab: Features ----

  // [label, key, hint?]
  const PAGES = [
    ["Home redesign", "homeRedesign"],
    ["Discover page", "gamesRedesign"],
    ["Search page", "searchPage"],
    ["Game page", "gamePageRedesign"],
    ["Profile page", "profileRedesign"],
    ["Friends page", "friendsPage"],
    ["Groups pages", "groupsPage"],
    ["Catalog page", "catalogClean"],
    ["Messages page", "messagesPage"],
    ["Account settings page", "settingsPage"],
    ["Transactions page", "transactionsPage"],
    ["Avatar editor", "avatarEditor"],
  ];
  const LOOK = [
    ["Custom theme", "theme"],
    ["Presence rings", "presenceRings", "Colored rings around friends who are online."],
    ["Clean game titles", "cleanTitles", "Removes [TAGS] from game names."],
    ["Hide emojis in titles", "stripEmojis"],
    ["Say Groups, not Communities", "renameGroups"],
    ["Loading screen", "loadingSkeleton", "A blank page while CER pages load."],
    ["Show Roblox top bar", "showTopBar"],
  ];
  const CLEAN = [
    ["Hide Roblox Plus ads", "hidePlusUpsell"],
    ["Hide footer", "hideFooter"],
    ["Protect my groups", "protectGroups", "Hides the leave group buttons."],
  ];
  const CHAT = [
    ["CER chat", "customChat"],
    ["Hide chat", "hideChat", "No chat at all."],
  ];
  const OLD_HOME = [
    ["Profile card", "profileHeader"],
    ["Expand button", "profileExpandBtn", "Under the profile card."],
    ["Big game pictures", "wideTiles", "In the Continue row."],
    ["Hide Add Friends", "hideAddFriends"],
  ];

  async function renderFeatures(body, rerender) {
    const settings = await CER.get();
    const rows = (list) => list.map(([label, key, hint]) => row(label, hint, featureToggle(settings, key, key === "homeRedesign" || key === "customSidebar" ? rerender : null)));
    body.append(group("CER pages", rows(PAGES)), group("Look", rows(LOOK)));

    // CER's sidebar: two optional items
    if (settings.features.customSidebar) {
      const opt = ["Inventory", "Trade"].map((label) =>
        row(
          "Show " + label,
          null,
          CER.ui.toggle(settings.sidebarPrefs[label] === "show", async (on) => {
            const cur = await CER.get();
            await CER.set({ sidebarPrefs: { ...cur.sidebarPrefs, [label]: on ? "show" : "hide" } });
          })
        )
      );
      body.append(group("Sidebar", opt));
    } else if (settings.knownSidebarItems.length) {
      // Roblox's own nav (only while CER's sidebar is off): on = hidden
      const hide = settings.knownSidebarItems.map((label) =>
        row(
          "Hide " + label,
          null,
          CER.ui.toggle(settings.sidebarPrefs[label] === "hide", async (on) => {
            const cur = await CER.get();
            await CER.set({ sidebarPrefs: { ...cur.sidebarPrefs, [label]: on ? "hide" : "show" } });
          })
        )
      );
      body.append(group("Sidebar", hide));
    }

    body.append(group("Chat", rows(CHAT)), group("Clean up", rows(CLEAN)));

    // Roblox's own home page: only matters while the CER home is off
    if (!settings.features.homeRedesign) {
      const LEGACY = /^(pinned games|best friends)$/i; // rows from retired features
      if (settings.knownSections.some((t) => LEGACY.test(t))) {
        const knownSections = settings.knownSections.filter((t) => !LEGACY.test(t));
        const sectionPrefs = { ...settings.sectionPrefs };
        for (const t of Object.keys(sectionPrefs)) if (LEGACY.test(t)) delete sectionPrefs[t];
        await CER.set({ knownSections, sectionPrefs });
        settings.knownSections = knownSections;
      }
      const sectionRows = settings.knownSections.map((title) =>
        row(
          "Hide " + title,
          null,
          CER.ui.toggle(settings.sectionPrefs[title] === "hide", async (on) => {
            const cur = await CER.get();
            await CER.set({ sectionPrefs: { ...cur.sectionPrefs, [title]: on ? "hide" : "show" } });
          })
        )
      );
      body.append(group("Roblox home page", [...rows(OLD_HOME), ...sectionRows]));
    }
  }

  // ---- tab: Themes ----

  async function renderThemes(body) {
    const settings = await CER.get();
    const grid = h("div", { class: "cer-sp-themes" });
    for (const theme of CER.THEMES) {
      const on = settings.theme.preset === theme.id;
      const chip = h(
        "button",
        { type: "button", class: "cer-sp-theme" + (on ? " is-active" : ""), "aria-pressed": on ? "true" : "false", title: theme.name },
        h("span", { class: "cer-sp-swatch", style: { background: theme.swatch } }),
        h("span", { class: "cer-sp-theme-name", text: theme.name })
      );
      chip.addEventListener("click", async () => {
        const cur = await CER.get();
        await CER.set({ theme: { ...cur.theme, preset: theme.id } });
        if (theme.native) {
          // pure native switch: reload so Roblox re-serves with the new theme
          // and the account setting actually sticks
          await CER.setNativeTheme(theme.native);
          location.reload();
          return;
        } else if (theme.id !== "") {
          // dark tints ride on native dark, light tints on native light
          await CER.setNativeTheme(theme.dark ? "Dark" : "Light");
        }
        for (const c of grid.children) {
          c.classList.toggle("is-active", c === chip);
          c.setAttribute("aria-pressed", c === chip ? "true" : "false");
        }
      });
      grid.appendChild(chip);
    }
    const fonts = ["", "Arial", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Courier New", "Comic Sans MS"];
    const sel = CER.ui.select(
      fonts.map((f) => ({ id: f, label: f === "" ? "Roblox font" : f })),
      settings.theme.font ?? "",
      async (v) => {
        const cur = await CER.get();
        await CER.set({ theme: { ...cur.theme, font: v } });
      }
    );
    body.append(grid, group(null, row("Font", null, sel, "div")));
  }

  // ---- tab: Playtime ----

  async function renderPlaytime(body) {
    // nudge a tick so the freshest minute shows even if the worker just slept
    try {
      CER.ext.runtime.sendMessage({ cer: "playtime-tick" }, () => void CER.ext.runtime.lastError);
    } catch {}
    const { playtime = {} } = await CER.ext.storage.local.get("playtime");
    const games = Object.entries(playtime).map(([uni, e]) => ({ uni, ...e }));
    if (!games.length) {
      body.appendChild(CER.ui.empty("Play a game and your time shows up here.", { icon: "clock" }));
      return;
    }

    const fmtT = (sec) => {
      const hr = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      return hr > 0 ? `${hr}h ${m}m` : `${m}m`;
    };
    const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const totalSecs = games.reduce((a, g) => a + (g.total ?? 0) / 1000, 0);
    const perDay = {};
    for (const g of games) for (const [day, ms] of Object.entries(g.days ?? {})) perDay[day] = (perDay[day] ?? 0) + ms / 1000;
    const today = new Date();

    body.appendChild(h("div", { class: "cer-sp-total" }, h("b", { text: fmtT(totalSecs) }), h("span", { text: "played" })));

    // heatmap: last 26 weeks
    const max = Math.max(1, ...Object.values(perDay));
    const heat = h("div", { class: "cer-sp-heat" });
    const WEEKS = 26;
    const start = new Date(today);
    start.setDate(start.getDate() - (WEEKS * 7 - 1));
    start.setDate(start.getDate() - start.getDay()); // the Sunday of its week
    for (let w = 0; w < WEEKS; w++) {
      const col = h("div", { class: "cer-sp-heat-col" });
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        const key = dayKey(date);
        const secs = perDay[key] ?? 0;
        const cell = h("div", { class: "cer-sp-heat-cell" });
        if (date > today) cell.style.visibility = "hidden";
        else if (secs > 0) {
          cell.classList.add("l" + Math.min(4, Math.ceil((secs / max) * 4)));
          cell.title = `${key}: ${fmtT(secs)}`;
        } else cell.title = `${key}: none`;
        col.appendChild(cell);
      }
      heat.appendChild(col);
    }
    body.appendChild(heat);

    // most played
    games.sort((a, b) => b.total - a.total);
    const top = games.slice(0, 10);
    body.appendChild(
      group(
        "Most played",
        top.map((g) =>
          h(
            "a",
            { class: "cer-sp-pt", href: "https://www.roblox.com/discover?Keyword=" + encodeURIComponent(g.name ?? "") },
            h("span", { class: "cer-sp-pt-icon" }, CER.ui.thumb("gameIcon", g.uni)),
            h("span", { class: "cer-sp-pt-info" }, h("span", { class: "cer-sp-pt-name", text: g.name ?? "" }), h("span", { class: "cer-sp-pt-bar" }, h("span", { class: "cer-sp-pt-fill", style: { width: Math.max(2, Math.round((g.total / top[0].total) * 100)) + "%" } }))),
            h("span", { class: "cer-sp-pt-time", text: fmtT(g.total / 1000) })
          )
        )
      )
    );

    body.appendChild(
      h(
        "div",
        { class: "cer-sp-foot" },
        armed("Reset playtime", "Tap again to reset", async () => {
          await CER.ext.storage.local.set({ playtime: {}, playtimeState: { lastTick: null, lastUniverse: null } });
          body.replaceChildren();
          renderPlaytime(body);
        })
      )
    );
  }

  // ---- tab: Join ----

  async function renderJoin(body) {
    const settings = await CER.get();

    const regionSel = CER.ui.select(
      [{ id: "auto", label: "Any region" }].concat(Object.keys(CER.REGIONS).map((k) => ({ id: k, label: CER.REGIONS[k] }))),
      settings.joinPrefs.region ?? "auto",
      async (v) => {
        const cur = await CER.get();
        await CER.set({ joinPrefs: { ...cur.joinPrefs, region: v } });
      }
    );
    const avoid = CER.ui.toggle(settings.joinPrefs.avoidFriends, async (on) => {
      const cur = await CER.get();
      await CER.set({ joinPrefs: { ...cur.joinPrefs, avoidFriends: on } });
    });
    body.appendChild(group(null, [row("Server region", null, regionSel, "div"), row("Skip servers with my friends", null, avoid)]));

    // on a game page, a random-server button
    const placeId = location.pathname.match(/\/games\/(\d+)/)?.[1];
    if (placeId) {
      const label = "Join a random server";
      const btn = CER.ui.button(label, { icon: "refresh", variant: "primary", size: "sm" });
      const text = btn.querySelector("span");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        text.textContent = "Finding a server";
        try {
          const cur = await CER.get();
          const res = await fetch(`https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&excludeFullGames=true`, { credentials: "include" });
          let servers = ((await res.json()).data ?? []).filter((s) => s.playing < s.maxPlayers);

          // "skip my friends' servers": friends' presence has the jobId of
          // the server they're in, so leave those out
          if (cur.joinPrefs.avoidFriends) {
            try {
              const myId = (await CER.me())?.id;
              const friends = (await (await fetch(`https://friends.roblox.com/v1/users/${myId}/friends`, { credentials: "include" })).json()).data ?? [];
              if (friends.length) {
                const pres = await CER.robloxWrite("https://presence.roblox.com/v1/presence/users", "POST", { userIds: friends.map((f) => f.id) });
                const friendServers = new Set(((await pres.json()).userPresences ?? []).filter((p) => p.userPresenceType === 2 && p.gameId).map((p) => p.gameId));
                const filtered = servers.filter((s) => !friendServers.has(s.id));
                if (filtered.length) servers = filtered;
              }
            } catch {
              /* presence unavailable: join without the filter */
            }
          }

          if (!servers.length) throw new Error("no open servers");
          const pick = servers[Math.floor(Math.random() * servers.length)];
          window.postMessage({ cer: "join-instance", placeId, jobId: pick.id }, location.origin);
          text.textContent = "Joining";
        } catch {
          text.textContent = "No server found. Try again.";
        } finally {
          setTimeout(() => {
            btn.disabled = false;
            text.textContent = label;
          }, 2500);
        }
      });
      body.appendChild(group("This game", row("Random server", null, btn, "div")));
    }
  }

  // ---- rival extension detection ----
  // Other Roblox extensions rewrite the same pages we do: warn once each.

  setTimeout(async () => {
    const RIVALS = [
      ["BTRoblox", '.btr-settings-toggle, [class^="btr-"], #btr-settings'],
      ["RoPro", '[class*="ropro"], [id*="ropro"]'],
      ["Roblox+", '[id^="rplus"], [class^="rplus"]'],
      ["RoGold", '[class*="rogold"], [id*="rogold"]'],
      ["RoValra", '[class*="rovalra"], [id*="rovalra"]'],
    ];
    const cur = await CER.get();
    const warned = cur.uiState.conflictWarned ?? [];
    for (const [name, selector] of RIVALS) {
      if (warned.includes(name)) continue;
      if (!document.querySelector(selector)) continue;
      // can't be closed for the first 10 seconds: the close button counts down
      const x = h("button", { type: "button", class: "cer-conflict-x", disabled: true, title: "Close", text: "10" });
      const toast = h("div", { class: "cer-ui cer-conflict-toast", role: "alert" }, h("span", { class: "cer-conflict-ic" }, icon("info", 20)), h("span", { text: `${name} found. Two Roblox add-ons can clash. Try turning one off.` }), x);
      let remaining = 10;
      const countdown = setInterval(() => {
        remaining--;
        if (remaining > 0) x.textContent = String(remaining);
        else {
          clearInterval(countdown);
          x.replaceChildren(icon("x", 16));
          x.disabled = false;
        }
      }, 1000);
      x.addEventListener("click", async () => {
        if (x.disabled) return;
        toast.remove();
        const s = await CER.get();
        await CER.set({ uiState: { ...s.uiState, conflictWarned: [...(s.uiState.conflictWarned ?? []), name] } });
      });
      document.body.appendChild(toast);
      break; // one warning at a time
    }
  }, 6000);

  // ---- tab: About ----

  async function renderAbout(body) {
    body.appendChild(
      h(
        "div",
        { class: "cer-sp-about" },
        h("b", { text: "Canardev's Enhanced Roblox" }),
        h("span", { text: "v" + CER.ext.runtime.getManifest().version + ". Free and open source. Runs only in your browser." })
      )
    );

    const link = (href, art, title, sub, opts = {}) =>
      h("a", { class: "cer-sp-link", href, target: opts.blank ? "_blank" : null }, h("span", { class: "cer-sp-link-art" }, art), h("span", { class: "cer-sp-link-text" }, h("b", { text: title }), sub && h("span", { text: sub })), icon("right", 18));
    body.appendChild(
      group(null, [
        link("https://www.roblox.com/games/" + BAC.placeId, CER.ui.thumb("gameIcon", BAC.universeId, { alt: "" }), BAC.name, "A game by the maker of CER"),
        link("https://www.roblox.com/games/127603609999069/", icon("heart", 22), "Donate on Roblox", "Totally optional. Thank you!", { blank: true }),
      ])
    );

    // feedback / bug report / idea
    let fbKind = "Bug";
    const kinds = CER.ui.chips(
      [
        { id: "Bug", label: "Bug" },
        { id: "Idea", label: "Idea" },
        { id: "Other", label: "Other" },
      ],
      fbKind,
      (k) => (fbKind = k)
    );
    const fbText = h("textarea", { class: "cer-textarea", placeholder: "Tell us what you think", maxlength: "1000", "aria-label": "Feedback" });
    const fbSend = CER.ui.button("Send", { variant: "primary", size: "sm" });
    fbSend.addEventListener("click", async () => {
      const msg = fbText.value.trim();
      if (!msg) return CER.toast("Write something first", "error");
      fbSend.busy(true);
      const res = await CER.sendFeedback(fbKind, msg);
      if (res.ok) {
        fbText.value = "";
        CER.toast("Thanks! Feedback sent", "success");
      } else if (res.cooldown) {
        CER.toast(`Please wait ${res.cooldown} more min`, "error");
      } else {
        CER.toast("Could not send. Try again later.", "error");
      }
      fbSend.busy(false);
    });
    body.appendChild(group("Feedback", h("div", { class: "cer-sp-feedback" }, h("div", { class: "cer-sp-feedback-top" }, kinds, fbSend), fbText)));

    body.appendChild(
      h(
        "div",
        { class: "cer-sp-foot" },
        armed("Reset all settings", "Tap again to reset", async () => {
          await CER.ext.storage.local.clear();
          location.reload();
        })
      )
    );
  }
})();
