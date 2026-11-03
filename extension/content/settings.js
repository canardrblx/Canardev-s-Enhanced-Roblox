// CER's own settings panel, plus its entry points:
//   - CER's sidebar Settings menu and the account page call CER.openSettings(tab)
//   - a tab on Roblox's own account page (only when that page isn't ours)
//   - CER themes inside Roblox's own Browser preferences (App theme) page
// The panel is built from CER.ui pieces (tokens, toggles, cards), so it looks
// like the rest of CER and never depends on Roblox's markup.
// Switches that only brought back Roblox's old UI are gone: those features are
// fixed at the owner's setup (CER.fixFeatures in shared.js).

(async function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { h, icon } = CER.ui;

  const MAKER_ID = 2614193870;
  // id = what callers pass to CER.openSettings(tab). Old tab names still work.
  // Themes live on the account page (/my/account) only; General links there.
  // Playtime shows only once there is some.
  const TABS = [
    { id: "General", label: "General" },
    { id: "Playtime", label: "Playtime" },
    { id: "About", label: "About" },
  ];
  const ALIAS = { Themes: "General", Home: "General", "Roblox UI": "General", Features: "General", Join: "General" };
  const tabFor = (id, tabs = TABS) => tabs.find((t) => t.id === (ALIAS[id] ?? id))?.id ?? "General";
  const readPlaytime = async () => {
    try {
      return (await CER.ext.storage.local.get("playtime")).playtime ?? {};
    } catch {
      return {}; // extension reloading
    }
  };

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

  // ---- Roblox's own Browser preferences page: CER themes next to Roblox's ----
  // Roblox's page has Mode (light/dark/system) and App theme cards. Our block
  // goes at the end of that section (Roblox's React leaves foreign nodes be;
  // re-placed if a re-render drops it). Picking Roblox's own mode or app
  // theme there switches CER to Auto, so the choice actually shows.
  if (location.pathname.startsWith("/my/account") && !document.documentElement.classList.contains("cer-takeover")) {
    let block = null;
    const onPrefs = () => /^#!\/browser-preferences/.test(location.hash);
    const sync = () => {
      if (!CER.alive?.()) return clearInterval(timer);
      const card = onPrefs() ? document.querySelector('[data-testid="app-theme-card"]') : null;
      const host = card?.closest("section.settings-container-v2") ?? card?.closest("section");
      if (!host) {
        block?.remove();
        return;
      }
      if (block?.isConnected && block.parentElement === host) return;
      block ??= h(
        "section",
        { class: "cer-ui cer-native-themes" },
        h("h3", { class: "cer-native-themes-title", text: "CER themes" }),
        CER.themePicker({ groups: ["cer"], titles: false, prepend: [""], names: { "": "Off" } })
      );
      host.appendChild(block);
    };
    // Only Roblox's own controls count: CER's sidebar search rows are
    // role=option too, and a click there must never reset the theme.
    document.addEventListener(
      "click",
      (e) => {
        if (!onPrefs() || !e.isTrusted || e.target.closest?.(".cer-ui, #cer-app")) return;
        const hit = e.target.closest?.('[data-testid="app-theme-card"], [role="option"]');
        if (!hit) return;
        // the theme cards sit in the settings column; the Mode menu's options
        // may render in a body-level popup, so those only need a listbox
        const roblox = hit.matches('[data-testid="app-theme-card"]') ? hit.closest("#content, main, .settings-container-v2") : hit.closest('[role="listbox"]');
        if (roblox) CER.pickTheme("");
      },
      true
    );
    window.addEventListener("hashchange", sync);
    const timer = setInterval(sync, 1500);
    sync();
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
  // ---- the panel ----

  async function openPanel(startTab) {
    const existing = document.getElementById("cer-panel-overlay");
    if (existing) {
      if (startTab) existing.showTab?.(tabFor(startTab));
      return;
    }

    // Sidebar switches set up the page once on load, so a change only shows
    // after a reload: a Reload button appears, and closing asks once.
    // Themes, font and join options apply live.
    let dirty = false;
    let closeArmed = false;
    const markDirty = () => {
      if (dirty) return;
      dirty = true;
      reloadBtn.hidden = false;
    };
    const returnFocus = document.activeElement;
    const close = () => {
      overlay.classList.remove("is-in");
      document.removeEventListener("keydown", onKey, true);
      setTimeout(() => overlay.remove(), 160);
      if (returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
    };
    const attemptClose = () => {
      if (dirty && !closeArmed) {
        closeArmed = true;
        warn.hidden = false;
        return;
      }
      close();
    };
    // Esc closes this panel only (it sits above chat); Tab stays inside it
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKey = (e) => {
      if (!overlay.isConnected || !overlay.classList.contains("is-in")) return;
      if (e.key === "Escape") {
        if (e.defaultPrevented || document.querySelector(".cer-ctx")) return; // a menu inside handles it
        e.preventDefault();
        e.stopPropagation();
        attemptClose();
        return;
      }
      if (e.key !== "Tab") return;
      const els = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const reloadBtn = CER.ui.button("Reload", { icon: "refresh", variant: "primary", size: "sm", onClick: () => location.reload() });
    reloadBtn.hidden = true;
    const closeBtn = CER.ui.button("", { icon: "x", variant: "ghost", size: "sm", title: "Close", onClick: attemptClose });
    const warn = h("div", { class: "cer-sp-banner" }, h("span", { text: "Reload to see your changes. Close again to skip." }));
    warn.hidden = true;

    const hasPlaytime = Object.keys(await readPlaytime()).length > 0;
    if (document.getElementById("cer-panel-overlay")) return; // a second open won the race
    const shown = TABS.filter((t) => t.id !== "Playtime" || hasPlaytime);
    let current = tabFor(startTab, shown);
    const tabs = CER.ui.tabs(
      shown.map((t) => ({ id: t.id, label: t.label })),
      current,
      (id) => show(id)
    );
    const body = h("div", { class: "cer-sp-body" });
    const panel = h(
      "div",
      { class: "cer-sp", role: "dialog", "aria-modal": "true", "aria-label": "CER settings", tabindex: "-1" },
      h("header", { class: "cer-sp-head" }, h("h2", { class: "cer-sp-title", text: "Settings" }), tabs, h("span", { class: "cer-sp-head-end" }, reloadBtn, closeBtn)),
      warn,
      body
    );
    const overlay = h("div", { id: "cer-panel-overlay", class: "cer-ui cer-sp-overlay", onClick: (e) => e.target === overlay && attemptClose() }, panel);

    let seq = 0;
    async function show(id) {
      current = tabFor(id, shown);
      tabs.set(current);
      const my = ++seq;
      const view = h("div", { class: "cer-sp-view" });
      const render = { General: renderGeneral, Playtime: renderPlaytime, About: renderAbout }[current];
      await render(view, markDirty, close);
      if (my !== seq) return; // a newer tab click won
      const keep = body.dataset.tab === current ? body.scrollTop : 0;
      body.replaceChildren(view);
      body.dataset.tab = current;
      body.scrollTop = keep;
    }
    overlay.showTab = show;

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => overlay.classList.add("is-in"));
    panel.focus({ preventScroll: true }); // focus moves inside; Tab starts at the tabs
    await show(current);
  }

  // ---- look: theme (a link to the account page, its one home) + font ----

  function lookRows(settings, closePanel) {
    const fonts = ["", "Arial", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Courier New", "Comic Sans MS"];
    const sel = CER.ui.select(
      fonts.map((f) => ({ id: f, label: f === "" ? "Roblox font" : f })),
      settings.theme.font ?? "",
      async (v) => {
        const cur = await CER.get();
        await CER.set({ theme: { ...cur.theme, font: v } });
      }
    );
    const theme = row("Theme", null, icon("right", 18), "a");
    theme.classList.add("is-link");
    theme.href = "https://www.roblox.com/my/account";
    theme.addEventListener("click", (e) => {
      // already on the account page: just show its theme grid
      const grid = document.querySelector("#cer-app .cer-acct-theme");
      if (!grid) return;
      e.preventDefault();
      closePanel();
      grid.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return [theme, row("Font", null, sel, "div")];
  }

  // ---- tab: Playtime ----

  async function renderPlaytime(body) {
    // nudge a tick so the freshest minute shows even if the worker just slept
    try {
      CER.ext.runtime.sendMessage({ cer: "playtime-tick" }, () => void CER.ext.runtime.lastError);
    } catch {}
    const playtime = await readPlaytime();
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
    // the Sunday of this week, minus 25 weeks: the last column holds today
    start.setDate(start.getDate() - start.getDay() - (WEEKS - 1) * 7);
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

  // ---- tab: General ----

  async function renderGeneral(body, markDirty, closePanel) {
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
    const servers = [row("Server region", null, regionSel, "div"), row("Skip servers with my friends", null, avoid)];

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
      servers.push(row("Random server", null, btn, "div"));
    }

    // what CER's sidebar shows. The sidebar builds once per page: reload.
    const side = (label, on, save) =>
      row(
        label,
        null,
        CER.ui.toggle(on, async (v) => {
          await save(v, await CER.get());
          markDirty();
        })
      );
    const sidebar = [
      ...["Inventory", "Trade"].map((label) => side(label, settings.sidebarPrefs[label] === "show", (on, cur) => CER.set({ sidebarPrefs: { ...cur.sidebarPrefs, [label]: on ? "show" : "hide" } }))),
      side("Chat", !settings.features.hideChat, (on, cur) => CER.set({ features: { ...cur.features, hideChat: !on } })),
    ];

    body.append(group("Look", lookRows(settings, closePanel)), group("Servers", servers), group("Sidebar", sidebar));
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
        h("span", { text: "v" + CER.ext.runtime.getManifest().version })
      )
    );

    // the maker
    const makerTag = (u) => CER.ui.nameTag({ type: "user", id: MAKER_ID, name: u.displayName, sub: "@" + u.name, verified: u.hasVerifiedBadge, size: "md" });
    const maker = h("a", { class: "cer-sp-maker", href: `https://www.roblox.com/users/${MAKER_ID}/profile` }, CER.ui.avatar(MAKER_ID, { size: 44 }), makerTag({ displayName: "canard", name: "canardev" }));
    CER.api.user(MAKER_ID).then((u) => u && maker.lastChild.replaceWith(makerTag(u)));
    body.appendChild(maker);

    body.appendChild(
      group(null, [
        h(
          "a",
          { class: "cer-sp-link", href: "https://www.roblox.com/games/127603609999069/", target: "_blank" },
          h("span", { class: "cer-sp-link-art" }, icon("heart", 22)),
          h("span", { class: "cer-sp-link-text" }, h("b", { text: "Donate" })),
          icon("right", 18)
        ),
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
    body.appendChild(
      group(
        "Feedback",
        h(
          "div",
          { class: "cer-sp-feedback" },
          kinds,
          fbText,
          h("div", { class: "cer-sp-feedback-foot" }, h("span", { class: "cer-sp-feedback-note", text: "Sends your message and username." }), fbSend)
        )
      )
    );

    body.appendChild(
      h(
        "div",
        { class: "cer-sp-foot" },
        armed("Reset all settings", "Tap again to reset", async () => {
          // settings only: playtime, feedback state and caches stay
          await CER.ext.storage.local.remove(CER.SETTINGS_KEYS);
          try {
            localStorage.removeItem("cer:shell");
          } catch {}
          location.reload();
        })
      )
    );
  }
})();
