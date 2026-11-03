// Left-sidebar manager: discovers the sidebar items so settings can list
// them, hides the ones the user turned off, and hides the Roblox Plus
// upsell box when that option is on.

(async function () {
  if (typeof CER === "undefined") return;
  // custom sidebar replaces Roblox's — no need to force/toggle Roblox's nav
  if ((await CER.get()).features.customSidebar) return;

  // Always-visible sidebar. Roblox toggles the sidebar with the nav-menu button
  // (.btn-navigation-nav-menu-md) — collapsing slides .left-nav off via
  // transform. Strategy: pin it open with CSS, and if it's still not showing,
  // programmatically click the toggle (works even though we hide the button).
  const pin = document.createElement("style");
  pin.textContent = `
    .left-nav { transform: none !important; left: 0 !important; visibility: visible !important; }
    .btn-navigation-nav-menu-md, .menu-button.btn-navigation-nav-menu-md { display: none !important; }
  `;
  document.documentElement.appendChild(pin);

  function keepExpanded() {
    const wrap = document.querySelector("#wrap");
    if (wrap && !wrap.classList.contains("left-nav-new-width")) wrap.classList.add("left-nav-new-width");
  }

  // Is the sidebar on screen AND populated? Use the nav's own rect (its links
  // have varied hrefs, so a specific-href check is unreliable) plus a link
  // count so we detect the "collapsed → content unmounted" state too.
  function sidebarShowing() {
    const nav = document.querySelector(".left-nav");
    if (!nav) return false;
    const r = nav.getBoundingClientRect();
    return r.right > 50 && r.width > 50 && nav.querySelectorAll("a").length > 3;
  }

  // HARD cap on total clicks, never reset. If Roblox keeps reverting (server-
  // enforced top-bar accounts), 2 clicks that don't stick means it's futile —
  // we stop clicking so the sidebar doesn't flash forever, and the v0.16.9
  // safety net keeps the top bar so navigation still works.
  let totalClicks = 0;
  let sidebarTimer = null;
  function ensureSidebar() {
    keepExpanded();
    if (sidebarShowing()) {
      clearInterval(sidebarTimer); // stable — stop watching
      return;
    }
    if (totalClicks < 2) {
      const toggle = document.querySelector(".btn-navigation-nav-menu-md, .menu-button");
      if (toggle) {
        toggle.click();
        totalClicks++;
      }
    } else {
      clearInterval(sidebarTimer); // clicking didn't take — give up, no flashing
    }
  }
  ensureSidebar();
  sidebarTimer = setInterval(ensureSidebar, 1500);
  setTimeout(() => clearInterval(sidebarTimer), 12000);

  function getSidebarList() {
    for (const ul of document.querySelectorAll("ul")) {
      const links = [...ul.querySelectorAll(":scope > li a")];
      if (links.some((a) => a.textContent.trim().toLowerCase() === "home") &&
          links.some((a) => a.textContent.trim().toLowerCase() === "profile")) {
        return ul;
      }
    }
    return null;
  }

  function itemLabel(li) {
    // strip badge counts like "Messages 2"
    return li.textContent.trim().replace(/\s*\d+$/, "").slice(0, 30);
  }

  let applying = false;
  async function apply() {
    if (applying) return;
    applying = true;
    try {
      const settings = await CER.get();
      const list = getSidebarList();

      if (list) {
        const items = [...list.querySelectorAll(":scope > li")].filter(
          (li) =>
            !li.classList.contains("cer-nav-li") &&
            !li.classList.contains("cer-topnav-li") &&
            !/less robux|subscribe/i.test(li.textContent)
        );
        const labels = items.map(itemLabel).filter(Boolean);

        // first item is the logged-in username — not hideable, skip it
        const hideable = labels.slice(1);
        const HIDDEN_BY_DEFAULT = /^(blog|official store|buy gift cards|inventory|trade|roblox plus)$/i;
        const known = new Set(settings.knownSidebarItems);
        const prefs = { ...settings.sidebarPrefs };
        let changed = false;
        for (const l of hideable) {
          if (!known.has(l)) {
            known.add(l);
            changed = true;
          }
          if (!(l in prefs)) {
            prefs[l] = HIDDEN_BY_DEFAULT.test(l) ? "hide" : "show";
            changed = true;
          }
        }
        if (changed) await CER.set({ knownSidebarItems: [...known], sidebarPrefs: prefs });

        for (const li of items.slice(1)) {
          if (li.classList.contains("cer-topnav-li")) continue; // our own widgets
          li.style.display = prefs[itemLabel(li)] === "hide" ? "none" : "";
        }
      }

      // system alert bars (green/yellow strips) sit at the top and only
      // matter when they have a message — hide the empty shells the top bar
      // used to cover, restore them the moment they carry text
      for (const alert of document.querySelectorAll('.alert, #system-feedback, [class*="system-feedback"]')) {
        alert.style.display = alert.textContent.trim() ? "" : "none";
      }

      // Roblox Plus upsell: it's an <li> in the same sidebar list
      if (settings.features.hidePlusUpsell && list) {
        for (const li of list.children) {
          if (/less robux|subscribe/i.test(li.textContent) && !li.classList.contains("cer-nav-li")) {
            li.style.display = "none";
          }
        }
      }
    } finally {
      applying = false;
    }
  }

  // online-friends count badge on the Friends sidebar item, refreshed slowly
  async function updateOnlineCount() {
    const list = getSidebarList();
    const link = list && [...list.querySelectorAll("a")].find((a) => a.textContent.trim().replace(/\d+$/, "").trim() === "Friends");
    if (!link) return;
    try {
      const me = await CER.me();
      const friends = (await (await fetch(`https://friends.roblox.com/v1/users/${me.id}/friends`, { credentials: "include" })).json()).data ?? [];
      if (!friends.length) return;
      const pres = await CER.bgFetch("https://presence.roblox.com/v1/presence/users", "POST", { userIds: friends.map((f) => f.id) });
      const online = (pres.data?.userPresences ?? []).filter((p) => p.userPresenceType > 0).length;
      let badge = link.querySelector(".cer-online-badge");
      if (!badge) {
        badge = CER.el("span", "cer-online-badge");
        link.appendChild(badge);
      }
      badge.textContent = online + " online";
      badge.style.display = online > 0 ? "" : "none";
    } catch {
      /* leave the item alone */
    }
  }
  updateOnlineCount();
  const onlineTimer = setInterval(() => {
    if (!CER.alive?.()) return clearInterval(onlineTimer); // stop polling once the extension reloads
    updateOnlineCount();
  }, 120000);

  let timer = null;
  const observer = new MutationObserver(() => {
    if (!CER.alive?.()) return observer.disconnect(); // stop touching storage once the extension reloads
    clearTimeout(timer);
    timer = setTimeout(apply, 500);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  CER.onSettingsChanged(() => apply());
  await apply();

  // version tag at the bottom of every page — click opens settings
  const tag = CER.el(
    "button",
    "cer-version-tag",
    "Canardev's Enhanced Roblox v" + CER.ext.runtime.getManifest().version
  );
  tag.addEventListener("click", () => CER.openSettings?.("About"));
  document.body.appendChild(tag);
})();
