// Settings UI. Entry points:
//   1. "CER Settings" at the bottom of Roblox's left sidebar (the ul that
//      holds Home/Profile/... — NOT a[href="/home"], which matches the logo)
//   2. an item inside the header gear dropdown (added when it opens)
// The panel is a tabbed modal with an animated tab indicator.
// Other scripts open it via CER.openSettings(tabName).

(async function () {
  if (typeof CER === "undefined") return;

  const BAC = { name: "Build a Country", placeId: "82958998841721", universeId: "10200442730" };
  const TAB_NAMES = ["Home", "Themes", "Features", "Playtime", "Roblox UI", "Join", "About"];

  CER.openSettings = openPanel;

  // ---- entry point 1: bottom of the left sidebar ----

  function findSidebarList() {
    for (const ul of document.querySelectorAll("ul")) {
      const links = [...ul.querySelectorAll(":scope > li a")];
      if (links.some((a) => a.textContent.trim().toLowerCase() === "home") &&
          links.some((a) => a.textContent.trim().toLowerCase() === "profile")) {
        return ul;
      }
    }
    return null;
  }

  // custom sidebar provides its own Settings item — skip injecting into Roblox's
  const bootSettings = await CER.get();
  const sidebarList = bootSettings.features?.customSidebar
    ? null
    : await CER.waitFor(findSidebarList, 12000).catch(() => null);

  // "Settings" sidebar item — opens a dropdown: CER Settings, Roblox
  // Settings, Quick Sign In, Log Out.
  function openSettingsMenu(anchor) {
    document.querySelector(".cer-ctx")?.remove();
    const menu = CER.el("div", "cer-ctx");

    const cer = CER.el("button", "cer-ctx-item", "CER Settings");
    cer.addEventListener("click", () => {
      menu.remove();
      openPanel();
    });
    menu.appendChild(cer);

    const rbx = CER.el("a", "cer-ctx-item", "Roblox Settings");
    rbx.href = "https://www.roblox.com/my/account";
    menu.appendChild(rbx);

    const quick = CER.el("a", "cer-ctx-item", "Quick Sign In");
    quick.href = "https://www.roblox.com/crossdevicelogin/ConfirmCode";
    menu.appendChild(quick);

    const out = CER.el("button", "cer-ctx-item", "Log Out");
    out.addEventListener("click", async () => {
      if (!out.dataset.arm) {
        out.dataset.arm = "1";
        out.textContent = "Log out? Tap again";
        return;
      }
      await CER.robloxWrite("https://auth.roblox.com/v2/logout", "POST", {}).catch(() => {});
      location.href = "https://www.roblox.com/";
    });
    menu.appendChild(out);

    const r = anchor.getBoundingClientRect();
    menu.style.left = r.left + "px";
    menu.style.top = r.top - 8 - 4 * 42 + "px"; // open upward, above the item
    document.body.appendChild(menu);
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
    // Deep-clone a real item (Profile) so we inherit the exact native look:
    // hover overlay div, icon container, text span, all utility classes.
    const template = [...sidebarList.querySelectorAll(":scope > li")].find(
      (li) => li.querySelector("a")?.textContent.trim().toLowerCase() === "profile"
    );
    let li;
    if (template) {
      li = template.cloneNode(true);
      stripActiveState(li);
      li.classList.add("cer-nav-li");
      const a = li.querySelector("a");
      a.removeAttribute("href");
      const icon = li.querySelector('[class*="icon-"], .cer-side-glyph');
      if (icon) {
        icon.className = "cer-side-glyph";
        icon.textContent = "";
        icon.appendChild(CER.gearIcon());
      }
      const textSpan = [...li.querySelectorAll("span")].find(
        (s) => s.children.length === 0 && s.textContent.trim().toLowerCase() === "profile"
      );
      if (textSpan) textSpan.textContent = "Settings";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSettingsMenu(li);
      });
    } else {
      /* fallback item */
      li = CER.el("li", "cer-nav-li");
      const link = CER.el("a", "");
      link.href = "#";
      link.appendChild(CER.el("span", "cer-side-icon", "⚙"));
      link.appendChild(CER.el("span", "", "Settings"));
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSettingsMenu(li);
      });
      li.appendChild(link);
    }
    // above the "More fun for less Robux" upsell li, if it's there
    const upsellLi = [...sidebarList.children].find((l) => /less robux|subscribe/i.test(l.textContent));
    sidebarList.insertBefore(li, upsellLi ?? null);

    // Roblox's React re-renders can wipe foreign nodes — put ours back.
    setInterval(() => {
      if (!document.contains(li)) {
        const list = findSidebarList();
        if (list) {
          const upsell = [...list.children].find((l) => /less robux|subscribe/i.test(l.textContent));
          list.insertBefore(li, upsell ?? null);
        }
      }
    }, 3000);
  }

  // ---- entry point 2: the header gear dropdown ----

  const dropdownObserver = new MutationObserver(() => {
    // the Settings link uses an ABSOLUTE url — match by substring
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

  // ---- entry point 3: Roblox's account settings page (/my/account) ----

  if (location.pathname.startsWith("/my/account")) {
    CER.waitFor(() => {
      const tab = [...document.querySelectorAll("li a, li span")].find(
        (e) => e.children.length === 0 && /^account info$/i.test(e.textContent.trim())
      );
      return tab?.closest("li") ?? null;
    }, 12000)
      .then((accountInfoLi) => {
        const ours = accountInfoLi.cloneNode(true);
        ours.classList.add("cer-account-tab");
        // the clone inherits Account Info's selected state — strip it
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

  // ---- the panel ----

  async function openPanel(startTab) {
    if (document.getElementById("cer-panel-overlay")) return;

    const overlay = CER.el("div");
    overlay.id = "cer-panel-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) attemptClose();
    });

    // colors come from the design tokens, so the panel always matches the
    // active theme (native or tinted) with no detection logic
    const panel = CER.el("div", "cer-panel");
    overlay.appendChild(panel);

    // Most features are content scripts that set up the DOM once on load, so a
    // toggle only takes effect after a reload. Track edits: reveal a Reload
    // button, and warn once before letting the user exit with pending changes.
    let dirty = false;
    let closeArmed = false;
    function markDirty() {
      if (dirty) return;
      dirty = true;
      reloadBtn.style.display = "";
    }
    function attemptClose() {
      if (dirty && !closeArmed) {
        closeArmed = true;
        warn.style.display = "";
        return;
      }
      overlay.remove();
    }

    const head = CER.el("div", "cer-panel-head");
    head.appendChild(CER.el("span", "cer-panel-title", "Canardev's Enhanced Roblox"));
    const reloadBtn = CER.el("button", "cer-panel-reload", "⟳ Reload to apply");
    reloadBtn.style.display = "none";
    reloadBtn.addEventListener("click", () => location.reload());
    head.appendChild(reloadBtn);
    const x = CER.el("button", "cer-panel-x", "×");
    x.addEventListener("click", () => attemptClose());
    head.appendChild(x);
    panel.appendChild(head);

    // warning bar shown when trying to exit with unsaved-needs-reload changes
    const warn = CER.el("div", "cer-panel-warn");
    warn.textContent = "Reload the page to apply your changes. Close again to exit without reloading.";
    warn.style.display = "none";
    panel.appendChild(warn);

    // tab bar with a sliding indicator (the "tween")
    const tabBar = CER.el("div", "cer-tabs");
    const indicator = CER.el("span", "cer-tab-indicator");
    indicator.style.width = `calc(100% / ${TAB_NAMES.length})`;
    const body = CER.el("div", "cer-panel-body");
    const tabButtons = {};

    TAB_NAMES.forEach((name, index) => {
      const tab = CER.el("button", "cer-tab", name);
      tab.addEventListener("click", () => show(name, index));
      tabBar.appendChild(tab);
      tabButtons[name] = tab;
    });
    tabBar.appendChild(indicator);
    panel.appendChild(tabBar);
    panel.appendChild(body);

    // any toggle/select edit inside the panel needs a reload to take effect
    // (themes apply live, so they don't fire a change on the reload path)
    body.addEventListener("change", markDirty);

    async function show(name, index) {
      for (const [n, b] of Object.entries(tabButtons)) b.classList.toggle("cer-tab-active", n === name);
      indicator.style.transform = `translateX(${index * 100}%)`;
      body.classList.add("cer-body-fade");
      await new Promise((r) => setTimeout(r, 120));
      body.textContent = "";
      if (name === "Home") await renderHome(body);
      if (name === "Themes") await renderThemes(body);
      if (name === "Features") await renderFeatures(body);
      if (name === "Playtime") await renderPlaytime(body);
      if (name === "Roblox UI") await renderRobloxUI(body);
      if (name === "Join") await renderJoin(body);
      if (name === "About") renderAbout(body);
      body.classList.remove("cer-body-fade");
    }

    document.body.appendChild(overlay);
    const initial = startTab && TAB_NAMES.includes(startTab) ? startTab : "Home";
    await show(initial, TAB_NAMES.indexOf(initial));
  }

  // ---- tab: Home ----

  async function renderHome(body) {
    body.appendChild(CER.el("h3", "cer-h3", "Quick tips"));
    const tips = CER.el("ul", "cer-tips");
    for (const t of [
      "Pick a theme in the Themes tab. It changes right away.",
      "The ⚙ next to a game's Play button opens the Join tab.",
      "Hide any home row from the Home Sections tab.",
    ]) {
      tips.appendChild(CER.el("li", "", t));
    }
    body.appendChild(tips);

    // ---- feedback / bug report / idea ----
    body.appendChild(CER.el("h3", "cer-h3", "Send feedback"));
    const fbWrap = CER.el("div", "cer-feedback");
    const kindRow = CER.el("div", "cer-feedback-kinds");
    let fbKind = "Bug";
    for (const k of ["Bug", "Idea", "Other"]) {
      const chip = CER.el("button", "cer-profile-pill" + (k === fbKind ? " cer-profile-pill-active" : ""), k);
      chip.addEventListener("click", () => {
        fbKind = k;
        for (const c of kindRow.children) c.classList.toggle("cer-profile-pill-active", c.textContent === k);
      });
      kindRow.appendChild(chip);
    }
    fbWrap.appendChild(kindRow);
    const fbText = CER.el("textarea", "cer-feedback-text");
    fbText.placeholder = "What's on your mind?";
    fbText.maxLength = 1000;
    fbWrap.appendChild(fbText);
    const fbSend = CER.el("button", "cer-join-menu-action cer-feedback-send", "Send");
    fbSend.addEventListener("click", async () => {
      const msg = fbText.value.trim();
      if (!msg) return CER.toast("Write something first", "error");
      fbSend.disabled = true;
      fbSend.textContent = "Sending…";
      const res = await CER.sendFeedback(fbKind, msg);
      if (res.ok) {
        fbText.value = "";
        CER.toast("Thanks! Feedback sent", "success");
      } else if (res.cooldown) {
        CER.toast(`Please wait ${res.cooldown} more min`, "error");
      } else {
        CER.toast("Couldn't send — try again later", "error");
      }
      fbSend.disabled = false;
      fbSend.textContent = "Send";
    });
    fbWrap.appendChild(fbSend);
    body.appendChild(fbWrap);

    body.appendChild(CER.el("h3", "cer-h3", "Danger zone"));
    const reset = CER.el("button", "cer-profile-btn cer-reset-btn", "Reset all settings");
    reset.addEventListener("click", async () => {
      if (!reset.dataset.arm) {
        reset.dataset.arm = "1";
        reset.textContent = "Are you sure? Click again to reset everything";
        setTimeout(() => {
          delete reset.dataset.arm;
          reset.textContent = "Reset all settings";
        }, 4000);
        return;
      }
      await CER.ext.storage.local.clear();
      location.reload();
    });
    body.appendChild(reset);

    body.appendChild(CER.el("h3", "cer-h3", "Also Try:"));
    const card = CER.el("a", "cer-alsotry");
    card.href = "https://www.roblox.com/games/" + BAC.placeId;
    const img = CER.el("img", "cer-alsotry-icon");
    const icons = await CER.getGameIcons([BAC.universeId]);
    img.src = icons[BAC.universeId] ?? "";
    img.alt = BAC.name;
    card.appendChild(img);
    const info = CER.el("div", "cer-alsotry-info");
    info.appendChild(CER.el("div", "cer-alsotry-name", BAC.name));
    info.appendChild(CER.el("div", "cer-alsotry-sub", "By the developer of this extension"));
    card.appendChild(info);
    body.appendChild(card);
  }

  // ---- tab: Themes ----

  async function renderThemes(body) {
    const settings = await CER.get();

    body.appendChild(CER.el("h3", "cer-h3", "Theme"));
    const grid = CER.el("div", "cer-theme-grid");
    for (const theme of CER.THEMES) {
      const chip = CER.el("button", "cer-theme-chip");
      if (settings.theme.preset === theme.id) chip.classList.add("cer-theme-chip-active");
      const swatch = CER.el("span", "cer-theme-swatch");
      swatch.style.background = theme.swatch;
      chip.appendChild(swatch);
      chip.appendChild(CER.el("span", "cer-theme-name", theme.name));
      chip.addEventListener("click", async () => {
        const cur = await CER.get();
        await CER.set({ theme: { ...cur.theme, preset: theme.id } });
        if (theme.native) {
          // pure native switch — reload so Roblox re-serves with the new theme
          // and the account setting actually sticks
          await CER.setNativeTheme(theme.native);
          location.reload();
          return;
        } else if (theme.id !== "") {
          // dark tints ride on native dark so Roblox recolors its own text,
          // chat, search, footer; light tints ride on native light
          await CER.setNativeTheme(theme.dark ? "Dark" : "Light");
        }
        grid.querySelectorAll(".cer-theme-chip").forEach((c) => c.classList.remove("cer-theme-chip-active"));
        chip.classList.add("cer-theme-chip-active");
      });
      grid.appendChild(chip);
    }
    body.appendChild(grid);

    body.appendChild(CER.el("h3", "cer-h3", "Font"));
    const fonts = ["", "Arial", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Courier New", "Comic Sans MS"];
    const select = CER.el("select", "cer-select");
    for (const f of fonts) {
      const opt = CER.el("option", "", f === "" ? "Roblox default (Builder Sans)" : f);
      opt.value = f;
      if (settings.theme.font === f) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", async () => {
      const cur = await CER.get();
      await CER.set({ theme: { ...cur.theme, font: select.value } });
    });
    body.appendChild(select);
  }

  // ---- tab: Features ----

  function warnBanner() {
    const w = CER.el("div", "cer-settings-warn");
    w.appendChild(CER.el("span", "cer-settings-warn-icon", "⚠"));
    w.appendChild(CER.el("span", "", "Changing these can break things. It is best to leave everything default."));
    return w;
  }

  async function renderFeatures(body) {
    const settings = await CER.get();
    body.appendChild(warnBanner());
    const rows = [
      ["Profile header", "profileHeader", "Your avatar card replaces the Home title."],
      ["Expand button", "profileExpandBtn", "The Expand/Collapse control under the profile card."],
      ["Custom theme", "theme", "Theme colors and fonts from the Themes tab."],
      ["Show top bar", "showTopBar", "Bring back Roblox's top bar (nav lives in the sidebar otherwise)."],
      ["Rename Communities to Groups", "renameGroups", "Like the old days."],
      ["Protect my groups", "protectGroups", "Hides Leave / Transfer-ownership options so you can’t click them by accident."],
      ["Clean game titles", "cleanTitles", "Strips [BRACKETS] and (parens): “Bedwars [UPD]” → “Bedwars”."],
      ["Hide emojis in titles", "stripEmojis", "Removes emojis from game titles."],
      ["Hide Add Friends button", "hideAddFriends", "Removes the Add Friends tile from the friends row."],
      ["Avatar editor redesign (beta)", "avatarEditor", "A cleaner avatar editor with accessory stacking."],
      ["Game page redesign (beta)", "gamePageRedesign", "Hero layout with tabs, like the home page."],
      ["Friends page redesign", "friendsPage", "Clean friend grid with presence + requests tab."],
      ["Messages page redesign", "messagesPage", "Clean inbox with a reader view."],
      ["Profile redesign", "profileRedesign", "Pill tabs: About, Creations, Favorites, Friends, Badges…"],
      ["Home profile card", "profileHeader", "The avatar + info card at the top of the home page."],
      ["Presence rings", "presenceRings", "Ring avatars by status: green in-game, blue online, yellow Studio."],
      ["Games page redesign", "gamesRedesign", "Declutters /charts: Top Experiences, Trending carousel, Canardev's picks, friend games."],
      ["Loading skeleton", "loadingSkeleton", "Hide the stock UI behind a placeholder until CER's UI is ready."],
      ["Big game thumbnails", "wideTiles", "16:9 thumbnails in the Continue row instead of square icons."],
      ["Hide Roblox Plus ads", "hidePlusUpsell", "Removes the subscription pitch from the sidebar."],
      ["Hide footer", "hideFooter", "Hides the About Us / Jobs / language / copyright bar."],
      ["CER Chat", "customChat", "Our chat panel (sidebar → Chat) replaces Roblox's chat."],
      ["Hide chat", "hideChat", "No chat at all, not even ours."],
    ];
    for (const [label, key, hint] of rows) {
      const row = CER.el("label", "cer-feature-row");
      const textWrap = CER.el("div");
      textWrap.appendChild(CER.el("div", "cer-feature-name", label));
      textWrap.appendChild(CER.el("div", "cer-feature-hint", hint));
      row.appendChild(textWrap);
      const box = CER.el("input");
      box.type = "checkbox";
      box.className = "cer-toggle";
      box.checked = settings.features[key];
      box.addEventListener("change", async () => {
        const cur = await CER.get();
        await CER.set({ features: { ...cur.features, [key]: box.checked } });
      });
      row.appendChild(box);
      body.appendChild(row);
    }
    body.appendChild(CER.el("p", "cer-feature-hint", "Feature toggles apply after a page refresh."));
  }

  // ---- tab: Playtime ----

  async function renderPlaytime(body) {
    // nudge a tick so the freshest minute shows even if the worker just slept
    CER.ext.runtime.sendMessage({ cer: "playtime-tick" }, () => {});
    const { playtime = {} } = await CER.ext.storage.local.get("playtime");
    const games = Object.entries(playtime).map(([uni, e]) => ({ uni, ...e }));

    if (games.length === 0) {
      body.appendChild(CER.el("h3", "cer-h3", "Playtime"));
      body.appendChild(
        CER.el("p", "cer-feature-hint", "No playtime yet. Play a game and it shows up here. Your data stays on your device.")
      );
      return;
    }

    const fmt = (s) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };
    const totalSecs = games.reduce((a, g) => a + g.total / 1000, 0);

    body.appendChild(CER.el("h3", "cer-h3", `Total playtime: ${fmt(totalSecs)}`));

    // --- heatmap: last 26 weeks (fits the panel width) ---
    const perDay = {};
    for (const g of games) for (const [day, ms] of Object.entries(g.days ?? {})) perDay[day] = (perDay[day] ?? 0) + ms / 1000;
    const max = Math.max(1, ...Object.values(perDay));

    const heat = CER.el("div", "cer-heat");
    const WEEKS = 26;
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (WEEKS * 7 - 1));
    // align start to the Sunday of its week
    start.setDate(start.getDate() - start.getDay());
    for (let w = 0; w < WEEKS; w++) {
      const col = CER.el("div", "cer-heat-col");
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        const key = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
        const secs = perDay[key] ?? 0;
        const cell = CER.el("div", "cer-heat-cell");
        if (date > today) cell.style.visibility = "hidden";
        else if (secs > 0) {
          const level = Math.ceil((secs / max) * 4);
          cell.classList.add("cer-heat-" + Math.min(4, level));
          cell.title = `${key}: ${fmt(secs)}`;
        } else {
          cell.title = `${key}: none`;
        }
        col.appendChild(cell);
      }
      heat.appendChild(col);
    }
    body.appendChild(heat);

    // --- top games ---
    body.appendChild(CER.el("h3", "cer-h3", "Most played"));
    games.sort((a, b) => b.total - a.total);
    const top = games.slice(0, 12);
    const icons = await CER.getGameIcons(top.map((g) => g.uni)).catch(() => ({}));
    for (const g of top) {
      const row = CER.el("a", "cer-pt-row");
      row.href = "https://www.roblox.com/games/?keyword=" + encodeURIComponent(g.name);
      const img = CER.el("img", "cer-pt-icon");
      img.src = icons[g.uni] ?? "";
      row.appendChild(img);
      const info = CER.el("div", "cer-pt-info");
      info.appendChild(CER.el("div", "cer-pt-name", g.name));
      const barWrap = CER.el("div", "cer-pt-bar");
      const fill = CER.el("div", "cer-pt-fill");
      fill.style.width = Math.round((g.total / top[0].total) * 100) + "%";
      barWrap.appendChild(fill);
      info.appendChild(barWrap);
      row.appendChild(info);
      row.appendChild(CER.el("div", "cer-pt-time", fmt(g.total / 1000)));
      body.appendChild(row);
    }

    const reset = CER.el("button", "cer-profile-btn cer-pt-reset", "Reset playtime data");
    reset.addEventListener("click", async () => {
      if (!reset.dataset.arm) {
        reset.dataset.arm = "1";
        reset.textContent = "Sure? Click again";
        setTimeout(() => { delete reset.dataset.arm; reset.textContent = "Reset playtime data"; }, 4000);
        return;
      }
      await CER.ext.storage.local.set({ playtime: {}, playtimeState: { lastTick: null, lastUniverse: null } });
      body.textContent = "";
      renderPlaytime(body);
    });
    body.appendChild(reset);
  }

  // ---- tab: Roblox UI ----

  async function renderRobloxUI(body) {
    const settings = await CER.get();

    body.appendChild(warnBanner());
    body.appendChild(CER.el("h3", "cer-h3", "Hide home sections"));

    if (settings.knownSections.length === 0) {
      body.appendChild(
        CER.el("p", "cer-feature-hint", "Visit the home page once and reopen settings — the sections will show up here.")
      );
      return;
    }

    // purge sections from retired features (Pinned Games / Best Friends)
    const LEGACY = /^(pinned games|best friends)$/i;
    if (settings.knownSections.some((t) => LEGACY.test(t))) {
      const knownSections = settings.knownSections.filter((t) => !LEGACY.test(t));
      const sectionPrefs = { ...settings.sectionPrefs };
      for (const t of Object.keys(sectionPrefs)) if (LEGACY.test(t)) delete sectionPrefs[t];
      await CER.set({ knownSections, sectionPrefs });
      settings.knownSections = knownSections;
    }

    for (const title of settings.knownSections) {
      const row = CER.el("label", "cer-feature-row");
      row.appendChild(CER.el("div", "cer-feature-name", `“${title}”`));
      const box = CER.el("input");
      box.type = "checkbox";
      box.className = "cer-toggle";
      box.checked = settings.sectionPrefs[title] === "hide";
      box.addEventListener("change", async () => {
        const cur = await CER.get();
        await CER.set({ sectionPrefs: { ...cur.sectionPrefs, [title]: box.checked ? "hide" : "show" } });
      });
      row.appendChild(box);
      body.appendChild(row);
    }
    body.appendChild(
      CER.el(
        "p",
        "cer-feature-hint",
        "Checked = hidden. Applies instantly. New sections start hidden, except “Friends” and “Continue Playing”."
      )
    );

    body.appendChild(CER.el("h3", "cer-h3", "Hide sidebar items"));
    if (settings.knownSidebarItems.length === 0) {
      body.appendChild(CER.el("p", "cer-feature-hint", "Open a page with the sidebar once and the items will show up here."));
    } else {
      for (const label of settings.knownSidebarItems) {
        const row = CER.el("label", "cer-feature-row");
        row.appendChild(CER.el("div", "cer-feature-name", `“${label}”`));
        const box = CER.el("input");
        box.type = "checkbox";
        box.className = "cer-toggle";
        box.checked = settings.sidebarPrefs[label] === "hide";
        box.addEventListener("change", async () => {
          const cur = await CER.get();
          await CER.set({ sidebarPrefs: { ...cur.sidebarPrefs, [label]: box.checked ? "hide" : "show" } });
        });
        row.appendChild(box);
        body.appendChild(row);
      }
    }
  }

  // ---- tab: Join ----

  async function renderJoin(body) {
    const settings = await CER.get();

    body.appendChild(CER.el("h3", "cer-h3", "Join options"));

    // preferred region: when set, pressing Play searches for a server there
    const regionRow = CER.el("div", "cer-feature-row");
    const rWrap = CER.el("div");
    rWrap.appendChild(CER.el("div", "cer-feature-name", "Preferred region"));
    rWrap.appendChild(CER.el("div", "cer-feature-hint", "When you press Play, join a server in this region."));
    regionRow.appendChild(rWrap);
    const regionOpts = [["auto", "Off"]].concat(Object.keys(CER.REGIONS).map((k) => [k, CER.REGIONS[k]]));
    regionRow.appendChild(
      CER.dropdown(regionOpts, settings.joinPrefs.region ?? "auto", async (v) => {
        const cur = await CER.get();
        await CER.set({ joinPrefs: { ...cur.joinPrefs, region: v } });
      })
    );
    body.appendChild(regionRow);

    const row = CER.el("label", "cer-feature-row");
    const textWrap = CER.el("div");
    textWrap.appendChild(CER.el("div", "cer-feature-name", "Avoid servers my friends are in"));
    textWrap.appendChild(CER.el("div", "cer-feature-hint", "Skip servers where your friends are already playing."));
    row.appendChild(textWrap);
    const box = CER.el("input");
    box.type = "checkbox";
    box.className = "cer-toggle";
    box.checked = settings.joinPrefs.avoidFriends;
    box.addEventListener("change", async () => {
      const cur = await CER.get();
      await CER.set({ joinPrefs: { ...cur.joinPrefs, avoidFriends: box.checked } });
    });
    row.appendChild(box);
    body.appendChild(row);

    // on a game page, the working quick action lives here too
    const placeId = location.pathname.match(/\/games\/(\d+)/)?.[1];
    if (placeId) {
      body.appendChild(CER.el("h3", "cer-h3", "This game"));
      const btn = CER.el("button", "cer-join-menu-action", "🎲 Join random server");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Finding a server…";
        try {
          const cur = await CER.get();
          const res = await fetch(
            `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&excludeFullGames=true`,
            { credentials: "include" }
          );
          let servers = ((await res.json()).data ?? []).filter((s) => s.playing < s.maxPlayers);

          // "avoid servers with friends": friends' presence exposes the
          // jobId of the server they're in — exclude those
          if (cur.joinPrefs.avoidFriends) {
            try {
              const meRes = await fetch("https://users.roblox.com/v1/users/authenticated", { credentials: "include" });
              const myId = (await meRes.json()).id;
              const friends = (await (await fetch(`https://friends.roblox.com/v1/users/${myId}/friends`, { credentials: "include" })).json()).data ?? [];
              if (friends.length) {
                const pres = await CER.robloxWrite("https://presence.roblox.com/v1/presence/users", "POST", {
                  userIds: friends.map((f) => f.id),
                });
                const friendServers = new Set(
                  ((await pres.json()).userPresences ?? [])
                    .filter((p) => p.userPresenceType === 2 && p.gameId)
                    .map((p) => p.gameId)
                );
                const filtered = servers.filter((s) => !friendServers.has(s.id));
                if (filtered.length) servers = filtered;
              }
            } catch {
              /* presence unavailable — join without the filter */
            }
          }

          if (servers.length === 0) throw new Error("no open servers");
          const pick = servers[Math.floor(Math.random() * servers.length)];
          window.postMessage({ cer: "join-instance", placeId, jobId: pick.id }, location.origin);
          btn.textContent = "Joining…";
        } catch {
          btn.textContent = "No server found. Try again";
        } finally {
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = "🎲 Join random server";
          }, 2500);
        }
      });
      body.appendChild(btn);
    }

    body.appendChild(
      CER.el(
        "p",
        "cer-feature-hint",
        "The Servers tab lets you sort, filter, and join by ID. Set a preferred region above to join servers there."
      )
    );
  }

  // ---- rival extension detection ----
  // Other Roblox extensions rewrite the same pages we do — warn once each.

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
      const toast = CER.el("div", "cer-conflict-toast");
      toast.appendChild(
        CER.el("span", "", `⚠ ${name} found. Two Roblox add-ons can clash. Try turning one off.`)
      );
      // not dismissable for the first 10 seconds — the × shows a countdown
      const x = CER.el("button", "cer-panel-x cer-toast-locked", "10");
      x.disabled = true;
      let remaining = 10;
      const countdown = setInterval(() => {
        remaining--;
        if (remaining > 0) {
          x.textContent = String(remaining);
        } else {
          clearInterval(countdown);
          x.textContent = "×";
          x.disabled = false;
          x.classList.remove("cer-toast-locked");
        }
      }, 1000);
      x.addEventListener("click", async () => {
        if (x.disabled) return;
        toast.remove();
        const s = await CER.get();
        await CER.set({ uiState: { ...s.uiState, conflictWarned: [...(s.uiState.conflictWarned ?? []), name] } });
      });
      toast.appendChild(x);
      document.body.appendChild(toast);
      break; // one warning at a time
    }
  }, 6000);

  // ---- tab: About ----

  function renderAbout(body) {
    body.appendChild(CER.el("h3", "cer-h3", "Canardev's Enhanced Roblox"));
    for (const line of [
      "Free and open source (GPL-3.0).",
      "Everything runs locally in your browser.",
      "No servers, no analytics, no tracking. Only talks to roblox.com.",
    ]) {
      body.appendChild(CER.el("p", "cer-about-line", line));
    }

    // ---- support / donations ----
    body.appendChild(CER.el("h3", "cer-h3", "Support CER"));
    body.appendChild(
      CER.el(
        "p",
        "cer-about-line",
        "i'm canardev, i make this stuff in my free time and CER's free, no catch. if it's made roblox nicer for you and you wanna send a few robux my way, it honestly helps a ton and keeps me building. totally optional though. thanks for being here 🫶"
      )
    );
    const donate = CER.el("a", "cer-donate-card");
    donate.href = "https://www.roblox.com/games/127603609999069/";
    donate.target = "_blank";
    donate.appendChild(CER.el("span", "cer-donate-heart", "💜"));
    const dtext = CER.el("div");
    dtext.appendChild(CER.el("div", "cer-donate-title", "Donate on Roblox"));
    dtext.appendChild(CER.el("div", "cer-donate-sub", "Opens the CER donations experience"));
    donate.appendChild(dtext);
    donate.appendChild(CER.el("span", "cer-donate-arrow", "→"));
    body.appendChild(donate);
  }
})();
