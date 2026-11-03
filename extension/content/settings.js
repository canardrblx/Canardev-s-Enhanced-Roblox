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
  const TABS = [
    { id: "Home", label: "Home", icon: "home", sub: "Tips, feedback and more" },
    { id: "Themes", label: "Themes", icon: "sparkle", sub: "Pick your colors and font" },
    { id: "Features", label: "Features", icon: "sliders", sub: "Turn CER parts on or off" },
    { id: "Playtime", label: "Playtime", icon: "clock", sub: "How long you play. Stays on your device." },
    { id: "Roblox UI", label: "Hide stuff", icon: "eye", sub: "Choose what you see" },
    { id: "Join", label: "Join", icon: "server", sub: "How Play picks a server" },
    { id: "About", label: "About", icon: "info", sub: "Canardev's Enhanced Roblox" },
  ];
  const TAB_IDS = TABS.map((t) => t.id);

  CER.openSettings = openPanel;

  // Toasts get CER's look: tokens come from .cer-ui on their host.
  const baseToast = CER.toast;
  if (baseToast && !baseToast.cerShell) {
    CER.toast = function (message, kind) {
      const t = baseToast(message, kind);
      t?.parentElement?.classList.add("cer-ui");
      if (t && (kind === "error" || kind === "success")) t.prepend(icon(kind === "error" ? "info" : "check", 17));
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

  // One setting: name + hint on the left, a control on the right. A <label>
  // so clicking anywhere on the row flips its toggle.
  function row(name, hint, control, tag = "label") {
    return h(tag, { class: "cer-sp-row" }, h("span", { class: "cer-sp-row-text" }, h("span", { class: "cer-sp-row-name", text: name }), hint && h("span", { class: "cer-sp-row-hint", text: hint })), control);
  }
  // A titled card of rows.
  function group(title, kids, opts = {}) {
    return h("section", { class: "cer-sp-group" }, title && h("h3", { class: "cer-sp-group-title" }, opts.icon && icon(opts.icon, 16), h("span", { text: title })), h("div", { class: "cer-sp-card" + (opts.pad ? " is-pad" : "") }, kids));
  }
  const note = (text) => h("p", { class: "cer-sp-note", text });
  function warnBanner() {
    return h("div", { class: "cer-sp-warn" }, icon("info", 18), h("span", { text: "Changing these can break things. Best to leave them as they are." }));
  }
  // a two-tap button for things that can't be undone
  function armed(label, sure, run, opts = {}) {
    const b = CER.ui.button(label, { variant: "danger", icon: opts.icon ?? "trash", size: "sm" });
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

  // ---- the panel ----

  async function openPanel(startTab) {
    const existing = document.getElementById("cer-panel-overlay");
    if (existing) {
      if (startTab && TAB_IDS.includes(startTab)) existing.showTab?.(startTab);
      return;
    }

    // Most features set up the page once on load, so a toggle only takes
    // effect after a reload. Track edits: show a Reload button, and warn once
    // before closing with changes waiting.
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

    const reloadBtn = CER.ui.button("Reload to apply", { icon: "refresh", variant: "primary", size: "sm", onClick: () => location.reload() });
    reloadBtn.hidden = true;
    const closeBtn = CER.ui.button("", { icon: "x", variant: "ghost", title: "Close", onClick: attemptClose });
    const warn = h("div", { class: "cer-sp-banner" }, icon("refresh", 17), h("span", { text: "Reload the page to use your changes. Close again to skip." }));
    warn.hidden = true;

    const titleEl = h("h2", { class: "cer-sp-title" });
    const subEl = h("p", { class: "cer-sp-sub" });
    const body = h("div", { class: "cer-sp-body" });
    const tabBtns = {};
    const rail = h(
      "nav",
      { class: "cer-sp-rail", "aria-label": "Settings sections" },
      h("div", { class: "cer-sp-brand" }, h("span", { class: "cer-sp-logo", text: "CER" }), h("span", { class: "cer-sp-brand-text" }, h("b", { text: "Settings" }), h("span", { text: "v" + CER.ext.runtime.getManifest().version }))),
      TABS.map((t) => (tabBtns[t.id] = h("button", { type: "button", class: "cer-sp-tab", onClick: () => show(t.id) }, icon(t.icon, 18), h("span", { text: t.label }))))
    );
    const main = h("div", { class: "cer-sp-main" }, h("header", { class: "cer-sp-head" }, h("div", { class: "cer-sp-head-text" }, titleEl, subEl), reloadBtn, closeBtn), warn, body);
    const panel = h("div", { class: "cer-sp", role: "dialog", "aria-modal": "true", "aria-label": "CER settings" }, rail, main);
    const overlay = h("div", { id: "cer-panel-overlay", class: "cer-ui cer-sp-overlay", onClick: (e) => e.target === overlay && attemptClose() }, panel);

    // any toggle/select edit inside the panel needs a reload to take effect
    body.addEventListener("change", markDirty);

    let seq = 0;
    async function show(id) {
      const tab = TABS.find((t) => t.id === id) ?? TABS[0];
      const my = ++seq;
      for (const [n, b] of Object.entries(tabBtns)) {
        b.classList.toggle("is-active", n === tab.id);
        b.setAttribute("aria-current", n === tab.id ? "page" : "false");
      }
      titleEl.textContent = tab.label;
      subEl.textContent = tab.sub;
      const view = h("div", { class: "cer-sp-view" });
      const render = { Home: renderHome, Themes: renderThemes, Features: renderFeatures, Playtime: renderPlaytime, "Roblox UI": renderRobloxUI, Join: renderJoin, About: renderAbout }[tab.id];
      await render(view);
      if (my !== seq) return; // a newer tab click won
      body.replaceChildren(view);
      body.scrollTop = 0;
    }
    overlay.showTab = show;

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => overlay.classList.add("is-in"));
    const initial = startTab && TAB_IDS.includes(startTab) ? startTab : "Home";
    await show(initial);
  }

  // ---- tab: Home ----

  async function renderHome(body) {
    body.appendChild(
      group(
        "Quick tips",
        h(
          "ul",
          { class: "cer-sp-tips" },
          ["Pick a theme in Themes. It changes right away.", "Turn CER pages on or off in Features.", "The gear next to Play opens the Join tab."].map((t) => h("li", {}, icon("check", 16), h("span", { text: t })))
        ),
        { icon: "sparkle", pad: true }
      )
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
    const fbSend = CER.ui.button("Send", { icon: "send", variant: "primary", size: "sm" });
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
    body.appendChild(group("Send feedback", h("div", { class: "cer-sp-feedback" }, kinds, fbText, h("div", { class: "cer-sp-actions" }, fbSend)), { icon: "chat", pad: true }));

    // also try
    const card = h(
      "a",
      { class: "cer-sp-promo", href: "https://www.roblox.com/games/" + BAC.placeId },
      h("span", { class: "cer-sp-promo-icon" }, CER.ui.thumb("gameIcon", BAC.universeId, { alt: BAC.name })),
      h("span", { class: "cer-sp-promo-text" }, h("b", { text: BAC.name }), h("span", { text: "A game by the maker of CER" })),
      h("span", { class: "cer-sp-promo-go" }, icon("play", 18))
    );
    body.appendChild(group("Also try", card, { icon: "gamepad" }));

    body.appendChild(
      group(
        "Start over",
        row(
          "Reset all settings",
          "Puts every CER setting back to how it started.",
          armed("Reset", "Tap again to reset", async () => {
            await CER.ext.storage.local.clear();
            location.reload();
          }),
          "div"
        )
      )
    );
  }

  // ---- tab: Themes ----

  async function renderThemes(body) {
    const settings = await CER.get();
    const grid = h("div", { class: "cer-sp-themes" });
    for (const theme of CER.THEMES) {
      const chip = h(
        "button",
        { type: "button", class: "cer-sp-theme" + (settings.theme.preset === theme.id ? " is-active" : ""), "aria-pressed": settings.theme.preset === theme.id ? "true" : "false" },
        h("span", { class: "cer-sp-swatch", style: { background: theme.swatch } }, h("span", { class: "cer-sp-swatch-check" }, icon("check", 16))),
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
          // dark tints ride on native dark so Roblox recolors its own text,
          // light tints ride on native light
          await CER.setNativeTheme(theme.dark ? "Dark" : "Light");
        }
        for (const c of grid.children) {
          c.classList.toggle("is-active", c === chip);
          c.setAttribute("aria-pressed", c === chip ? "true" : "false");
        }
      });
      grid.appendChild(chip);
    }
    body.appendChild(group("Theme", grid, { icon: "sparkle", pad: true }));

    const fonts = ["", "Arial", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Courier New", "Comic Sans MS"];
    const sel = CER.ui.select(
      fonts.map((f) => ({ id: f, label: f === "" ? "Roblox font" : f })),
      settings.theme.font ?? "",
      async (v) => {
        const cur = await CER.get();
        await CER.set({ theme: { ...cur.theme, font: v } });
      }
    );
    body.appendChild(group("Font", row("Text font", "The font for text on Roblox.", sel, "div")));
  }

  // ---- tab: Features ----

  // [label, key, hint]. Short, simple words.
  const FEATURE_GROUPS = [
    {
      title: "New pages",
      icon: "grid",
      rows: [
        ["Home redesign", "homeRedesign", "A new home page with your games and friends."],
        ["Discover page", "gamesRedesign", "Find games with a big pick, top lists and genres."],
        ["Search page", "searchPage", "Clean results for games, people, items and groups."],
        ["Game page redesign", "gamePageRedesign", "A big game header, a Play button and tabs."],
        ["Profile redesign", "profileRedesign", "A clean profile with tabs for games, friends and badges."],
        ["Friends page redesign", "friendsPage", "See who is online and answer friend requests."],
        ["Groups pages", "groupsPage", "Clean group pages with games, posts and members."],
        ["Catalog page", "catalogClean", "Shop for items in a clean, simple store."],
        ["Messages page redesign", "messagesPage", "A clean inbox with an easy reader."],
        ["Account settings page", "settingsPage", "Your Roblox account settings, simple and tidy."],
        ["Transactions page", "transactionsPage", "See what you bought and sold in one list."],
        ["Avatar editor redesign", "avatarEditor", "A cleaner avatar editor. Wear more accessories."],
      ],
    },
    {
      title: "Look",
      icon: "sparkle",
      rows: [
        ["Custom theme", "theme", "Use the colors and font from Themes."],
        ["Presence rings", "presenceRings", "Rings on avatars: green in a game, blue online."],
        ["Clean game titles", "cleanTitles", "Removes [TAGS] and (notes) from game names."],
        ["Hide emojis in titles", "stripEmojis", "Removes emojis from game names."],
        ["Big game thumbnails", "wideTiles", "Wide pictures in the Continue row."],
        ["Loading screen", "loadingSkeleton", "Shows a calm loading screen while a page builds."],
        ["Rename Communities to Groups", "renameGroups", "Like the old days."],
        ["Show top bar", "showTopBar", "Brings back Roblox's top bar."],
      ],
    },
    {
      title: "Old home page",
      icon: "home",
      rows: [
        ["Home profile card", "profileHeader", "Your avatar card at the top of the old home page."],
        ["Expand button", "profileExpandBtn", "The Show more button under that card."],
        ["Hide Add Friends button", "hideAddFriends", "Removes the Add Friends tile from the friends row."],
      ],
    },
    {
      title: "Clean up",
      icon: "eye",
      rows: [
        ["Hide Roblox Plus ads", "hidePlusUpsell", "Removes the Roblox Plus pitch."],
        ["Hide footer", "hideFooter", "Hides the links at the bottom of pages."],
        ["Protect my groups", "protectGroups", "Hides the leave group buttons so you can't tap them by mistake."],
      ],
    },
    {
      title: "Chat",
      icon: "chat",
      rows: [
        ["CER Chat", "customChat", "Our chat panel. Open it from Chat in the sidebar."],
        ["Hide chat", "hideChat", "No chat at all, not even ours."],
      ],
    },
  ];

  async function renderFeatures(body) {
    const settings = await CER.get();
    body.appendChild(warnBanner());
    for (const g of FEATURE_GROUPS) {
      const rows = g.rows.map(([label, key, hint]) =>
        row(
          label,
          hint,
          CER.ui.toggle(!!settings.features[key], async (on) => {
            const cur = await CER.get();
            await CER.set({ features: { ...cur.features, [key]: on } });
          })
        )
      );
      body.appendChild(group(g.title, rows, { icon: g.icon }));
    }
    body.appendChild(note("Changes work after you reload the page."));
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
      body.appendChild(CER.ui.empty("No playtime yet. Play a game and it shows up here.", { icon: "clock" }));
      return;
    }

    const fmtT = (s) => {
      const hr = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return hr > 0 ? `${hr}h ${m}m` : `${m}m`;
    };
    const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const totalSecs = games.reduce((a, g) => a + (g.total ?? 0) / 1000, 0);
    const perDay = {};
    for (const g of games) for (const [day, ms] of Object.entries(g.days ?? {})) perDay[day] = (perDay[day] ?? 0) + ms / 1000;
    const today = new Date();
    const weekSecs = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      return perDay[dayKey(d)] ?? 0;
    }).reduce((a, b) => a + b, 0);

    body.appendChild(
      h(
        "div",
        { class: "cer-sp-stats" },
        CER.ui.stat(fmtT(totalSecs), "All time", { icon: "clock" }),
        CER.ui.stat(fmtT(perDay[dayKey(today)] ?? 0), "Today", { icon: "sparkle" }),
        CER.ui.stat(fmtT(weekSecs), "Last 7 days", { icon: "calendar" }),
        CER.ui.stat(String(games.length), games.length === 1 ? "Game" : "Games", { icon: "gamepad" })
      )
    );

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
    const legend = h("div", { class: "cer-sp-heat-legend" }, h("span", { text: "Less" }), [0, 1, 2, 3, 4].map((l) => h("span", { class: "cer-sp-heat-cell" + (l ? " l" + l : "") })), h("span", { text: "More" }));
    body.appendChild(group("Last 6 months", h("div", { class: "cer-sp-heat-wrap" }, heat, legend), { icon: "calendar", pad: true }));

    // top games
    games.sort((a, b) => b.total - a.total);
    const top = games.slice(0, 12);
    const rows = top.map((g, i) =>
      h(
        "a",
        { class: "cer-sp-pt", href: "https://www.roblox.com/discover?Keyword=" + encodeURIComponent(g.name ?? "") },
        h("span", { class: "cer-sp-pt-rank", text: String(i + 1) }),
        h("span", { class: "cer-sp-pt-icon" }, CER.ui.thumb("gameIcon", g.uni)),
        h("span", { class: "cer-sp-pt-info" }, h("span", { class: "cer-sp-pt-name", text: g.name ?? "" }), h("span", { class: "cer-sp-pt-bar" }, h("span", { class: "cer-sp-pt-fill", style: { width: Math.max(2, Math.round((g.total / top[0].total) * 100)) + "%" } }))),
        h("span", { class: "cer-sp-pt-time", text: fmtT(g.total / 1000) })
      )
    );
    body.appendChild(group("Most played", rows, { icon: "trophy" }));

    body.appendChild(
      group(
        "Start over",
        row(
          "Reset playtime",
          "Deletes all your playtime numbers.",
          armed("Reset", "Tap again to reset", async () => {
            await CER.ext.storage.local.set({ playtime: {}, playtimeState: { lastTick: null, lastUniverse: null } });
            body.replaceChildren();
            renderPlaytime(body);
          }),
          "div"
        )
      )
    );
  }

  // ---- tab: Roblox UI ("Hide stuff") ----

  async function renderRobloxUI(body) {
    const settings = await CER.get();
    body.appendChild(warnBanner());

    // CER's sidebar: optional items
    if (settings.features.customSidebar) {
      const opt = [
        ["Inventory", "Show Inventory in the sidebar."],
        ["Trade", "Show Trade in the sidebar."],
      ].map(([label, hint]) =>
        row(
          label,
          hint,
          CER.ui.toggle(settings.sidebarPrefs[label] === "show", async (on) => {
            const cur = await CER.get();
            await CER.set({ sidebarPrefs: { ...cur.sidebarPrefs, [label]: on ? "show" : "hide" } });
          })
        )
      );
      body.appendChild(group("Sidebar extras", opt, { icon: "list" }));
    }

    // old home page sections
    // purge sections from retired features (Pinned Games / Best Friends)
    const LEGACY = /^(pinned games|best friends)$/i;
    if (settings.knownSections.some((t) => LEGACY.test(t))) {
      const knownSections = settings.knownSections.filter((t) => !LEGACY.test(t));
      const sectionPrefs = { ...settings.sectionPrefs };
      for (const t of Object.keys(sectionPrefs)) if (LEGACY.test(t)) delete sectionPrefs[t];
      await CER.set({ knownSections, sectionPrefs });
      settings.knownSections = knownSections;
    }
    if (!settings.knownSections.length) {
      body.appendChild(group("Hide home rows", note("Visit Roblox's home page once, then the rows show up here."), { icon: "home", pad: true }));
    } else {
      const rows = settings.knownSections.map((title) =>
        row(
          title,
          null,
          CER.ui.toggle(settings.sectionPrefs[title] === "hide", async (on) => {
            const cur = await CER.get();
            await CER.set({ sectionPrefs: { ...cur.sectionPrefs, [title]: on ? "hide" : "show" } });
          })
        )
      );
      body.appendChild(group("Hide home rows", rows, { icon: "home" }));
      body.appendChild(note("On means hidden. For Roblox's own home page."));
    }

    // Roblox's own nav (only used when CER's sidebar is off)
    if (!settings.features.customSidebar) {
      if (!settings.knownSidebarItems.length) {
        body.appendChild(group("Hide sidebar items", note("Open a page with the sidebar once, then the items show up here."), { icon: "list", pad: true }));
      } else {
        const rows = settings.knownSidebarItems.map((label) =>
          row(
            label,
            null,
            CER.ui.toggle(settings.sidebarPrefs[label] === "hide", async (on) => {
              const cur = await CER.get();
              await CER.set({ sidebarPrefs: { ...cur.sidebarPrefs, [label]: on ? "hide" : "show" } });
            })
          )
        );
        body.appendChild(group("Hide sidebar items", rows, { icon: "list" }));
      }
    }
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
    body.appendChild(
      group("When you press Play", [row("Server region", "Join a server in this part of the world.", regionSel, "div"), row("Skip my friends' servers", "Join a server where no friends are playing.", avoid)], { icon: "play" })
    );

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
      body.appendChild(group("This game", row("Random server", "Jump into any open server of this game.", btn, "div"), { icon: "gamepad" }));
    }

    body.appendChild(note("The Servers tab on a game page can sort servers and join one by ID."));
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

  function renderAbout(body) {
    body.appendChild(
      group(
        "Your privacy",
        h(
          "ul",
          { class: "cer-sp-tips" },
          ["Free and open source (GPL-3.0).", "Everything runs in your browser.", "No servers, no tracking. It only talks to Roblox."].map((t) => h("li", {}, icon("shield", 16), h("span", { text: t })))
        ),
        { icon: "lock", pad: true }
      )
    );
    const donate = h(
      "a",
      { class: "cer-sp-promo is-donate", href: "https://www.roblox.com/games/127603609999069/", target: "_blank" },
      h("span", { class: "cer-sp-promo-heart" }, icon("heart", 24)),
      h("span", { class: "cer-sp-promo-text" }, h("b", { text: "Donate on Roblox" }), h("span", { text: "Opens the CER donations game" })),
      h("span", { class: "cer-sp-promo-go" }, icon("arrowRight", 18))
    );
    body.appendChild(
      group(
        "Support CER",
        h(
          "div",
          { class: "cer-sp-support" },
          h("p", {
            class: "cer-sp-letter",
            text: "i'm canardev, i make this stuff in my free time and CER's free, no catch. if it's made roblox nicer for you and you wanna send a few robux my way, it honestly helps a ton and keeps me building. totally optional though. thanks for being here",
          }),
          donate
        ),
        { icon: "heart", pad: true }
      )
    );
  }
})();
