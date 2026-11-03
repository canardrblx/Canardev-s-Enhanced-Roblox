// Shared helpers. Loaded before every other content script, so anything on
// `CER` is available to all of them (they run in the same isolated world —
// think of it like a ModuleScript everything requires).

// Force the new left-nav to render EXPANDED. Roblox stores the collapse state
// in localStorage['new-left-nav'] keyed by user id; if it's false the sidebar
// mounts empty (just a black bar). This runs at document_start, before Roblox
// reads it, so Roblox itself populates the expanded sidebar.
try {
  const raw = localStorage.getItem("new-left-nav");
  if (raw) {
    const obj = JSON.parse(raw);
    if (obj && obj.data) {
      let changed = false;
      for (const k of Object.keys(obj.data)) {
        if (obj.data[k] !== true) {
          obj.data[k] = true;
          changed = true;
        }
      }
      if (changed) localStorage.setItem("new-left-nav", JSON.stringify(obj));
    }
  }
} catch {
  /* localStorage unavailable — the force CSS still applies */
}

const CER = {
  // `browser` on Firefox, `chrome` on Chrome — same API either way.
  ext: globalThis.browser ?? globalThis.chrome,

  DEFAULTS: {
    features: {
      theme: true,
      profileHeader: true,
      profileExpandBtn: true,
      hidePlusUpsell: true,
      avatarEditor: true,
      wideTiles: true, // big 16:9 thumbnails in Continue + Pinned Games
      hideFooter: true, // about us / jobs / language / copyright bar
      hideChat: false,
      chatRestyle: true,
      gamePageRedesign: true,
      customChat: true, // our chat panel replaces Roblox's chat UI
      cleanTitles: true, // strip [BRACKETS] and (parens) from game titles
      stripEmojis: true, // strip emojis from game titles
      hideAddFriends: true, // the "Add Friends" tile in the friends row
      showTopBar: false, // Roblox's top bar (nav lives in the sidebar instead)
      customSidebar: true, // our own always-present sidebar (replaces Roblox's nav)
      renameGroups: true, // "Communities" → "Groups"
      protectGroups: true, // HIDE (never click) leave-group / transfer-owner options
      friendsPage: true, // redesigned friends page
      messagesPage: true, // redesigned messages page
      profileRedesign: true, // pill-tab profile (About/Creations/Favorites/...)
      presenceRings: true, // ring avatars by status (green in-game/blue online)
      gamesRedesign: true, // redesigned /charts page
      loadingSkeleton: true, // hide the stock UI behind a skeleton until CER mounts
      catalogClean: true, // declutter the catalog (rename, hide cart/robux, theme)
      homeRedesign: true, // CER home page (own UI, Roblox data only)
      groupsPage: true, // CER groups pages
      searchPage: true, // CER search results
      settingsPage: true, // CER account settings page
      transactionsPage: true, // CER transactions page
    },
    knownSidebarItems: [], // sidebar labels we've seen (for the settings list)
    sidebarPrefs: {}, // { [label]: "show" | "hide" }
    knownSections: [], // home-section titles we've seen (for the settings list)
    sectionPrefs: {}, // { [title]: "show" | "hide" } — new sections default to
    // "hide" except Friends / Continue Playing / our own sections
    joinPrefs: {
      region: "auto",
      avoidFriends: false, // wired up in the server-tools phase
      preferRegion: false, // wired up in the server-tools phase
    },
    theme: {
      preset: "native-dark", // id from CER.THEMES, "" = leave Roblox alone
      font: "",
    },
    uiState: {
      profileExpanded: false,
      recsNoticeHidden: false,
    },
  },
};

// Theme presets. Three kinds:
//  - id ""          "Auto": hands off, Roblox's own mode and app theme show
//                   (incl. Roblox Plus app themes like The Hollow)
//  - `native`       flips Roblox's own light/dark setting (PATCH themes/User at
//                   click time, see CER.pickTheme) and theme.js keeps the
//                   body classes on it; Roblox app themes come off
//  - CER themes     ride on native dark/light (`dark`), then theme.js tints
//                   Roblox's tokens and CER's: bg (page, may be a gradient;
//                   `flat` is its solid twin for tokens), header (nav/bars),
//                   card (tiles), raise (inputs, hover, second surface),
//                   accent (buttons; its ink comes from theme.js inkOn()).
// Every pair was checked: body text 14:1+ on bg, muted text 5:1+ on cards,
// accent 4.5:1+ (light) / 5.4:1+ (dark) on cards, ink 4.6:1+ on accent.
// `preview` = the picker's mini page colours where it can't use the tokens.
CER.THEMES = [
  { id: "", group: "roblox", name: "Auto", preview: { bg: "linear-gradient(135deg,#f2f4f5 50%,#111216 50%)", side: "transparent", card: "rgba(128,128,128,0.35)", accent: "#8e93a3", dark: true } },
  { id: "native-light", group: "roblox", name: "Light", native: "Light", preview: { bg: "#f2f4f5", side: "#ffffff", card: "#ffffff", accent: "#202227" } },
  { id: "native-dark", group: "roblox", name: "Dark", native: "Dark", preview: { bg: "#111216", side: "#191b1f", card: "#232527", accent: "#f7f7f8", dark: true } },
  {
    id: "midnight", name: "Midnight", dark: true, flat: "#0b1020", header: "#0f1529", card: "#1b2442", raise: "#252f50", accent: "#7b93ff",
    bg: "radial-gradient(ellipse 90% 55% at 70% -10%, rgba(123,147,255,0.16), transparent 70%), #0b1020",
  },
  {
    id: "galaxy", name: "Galaxy", dark: true, flat: "#0c0919", header: "#120e24", card: "#221b3f", raise: "#2d2450", accent: "#c084ff",
    // stars are a fixed-size tile so density is the same on every screen
    bg: "radial-gradient(1.4px 1.4px at 40px 60px, rgba(255,255,255,0.75), transparent 2.4px) 0 0 / 420px 420px repeat, radial-gradient(1px 1px at 230px 140px, rgba(255,255,255,0.5), transparent 2px) 0 0 / 420px 420px repeat, radial-gradient(1.2px 1.2px at 330px 330px, rgba(255,255,255,0.65), transparent 2.2px) 0 0 / 420px 420px repeat, radial-gradient(1px 1px at 120px 360px, rgba(255,255,255,0.4), transparent 2px) 0 0 / 420px 420px repeat, radial-gradient(ellipse 60% 45% at 20% 10%, rgba(192,132,255,0.2), transparent 70%), radial-gradient(ellipse 55% 45% at 85% 85%, rgba(80,120,255,0.16), transparent 70%), #0c0919",
  },
  {
    id: "ocean", name: "Ocean", dark: true, flat: "#06171d", header: "#0a2027", card: "#102f38", raise: "#173e49", accent: "#2dd4bf",
    bg: "radial-gradient(ellipse 90% 55% at 30% -10%, rgba(45,212,191,0.13), transparent 70%), #06171d",
  },
  {
    id: "forest", name: "Forest", dark: true, flat: "#0b1510", header: "#0f1d16", card: "#172b20", raise: "#20392b", accent: "#4ade80",
    bg: "radial-gradient(ellipse 90% 55% at 50% -10%, rgba(74,222,128,0.11), transparent 70%), #0b1510",
  },
  {
    id: "lava", name: "Lava", dark: true, flat: "#160c0a", header: "#1d110e", card: "#311c16", raise: "#3e251d", accent: "#ff6b3d",
    bg: "radial-gradient(ellipse 90% 50% at 50% 110%, rgba(255,107,61,0.16), transparent 70%), #160c0a",
  },
  { id: "black", name: "Black", dark: true, bg: "#000000", header: "#000000", card: "#161616", raise: "#202020", accent: "#ffffff" },
  { id: "cloud", name: "Cloud", bg: "#edf2fa", header: "#ffffff", card: "#ffffff", raise: "#e2e9f5", accent: "#2563eb" },
  { id: "bubblegum", name: "Bubblegum", bg: "#fcf0f5", header: "#fff8fb", card: "#ffffff", raise: "#f8e0ea", accent: "#db2777" },
  { id: "mint", name: "Mint", bg: "#eaf6f0", header: "#f6fbf8", card: "#ffffff", raise: "#d8ede2", accent: "#047857" },
  { id: "sunny", name: "Sunny", bg: "#fbf4e6", header: "#fffbf3", card: "#ffffff", raise: "#f2e5c9", accent: "#c2410c" },
];
// Retired preset ids (round 1 set) -> the closest current one. Read-time only.
CER.THEME_ALIAS = {
  blossom: "bubblegum", cotton: "bubblegum", sky: "cloud", beach: "cloud", oled: "black",
  sunset: "galaxy", grape: "galaxy", nightsky: "galaxy", aurora: "ocean", cyber: "midnight",
  coffee: "lava", ember: "lava",
};
CER.themeById = (id) => CER.THEMES.find((t) => t.id === (CER.THEME_ALIAS[id] ?? id)) ?? null;

// Features with no switch any more are FIXED at their default (the owner's
// setup). Only these stay the player's choice. Stored values for the others
// are ignored, and healed once in storage so scripts that read storage
// directly agree (no write when they already match).
CER.USER_FEATURES = ["hideChat"];
CER.fixFeatures = function (stored = {}) {
  const f = { ...CER.DEFAULTS.features, ...stored };
  for (const k in CER.DEFAULTS.features) if (!CER.USER_FEATURES.includes(k)) f[k] = CER.DEFAULTS.features[k];
  return f;
};

// True while our extension context is still valid. After a reload/update the
// old content scripts stay live in open tabs; the instant they touch a chrome.*
// API they throw "Extension context invalidated". Checking runtime.id lets us
// bail quietly instead of spamming the extensions error log.
CER.alive = function () {
  try {
    return !!CER.ext?.runtime?.id;
  } catch {
    return false;
  }
};

// Roblox navigates between some pages client-side (no page load), so
// URL-scoped scripts must re-run when the address changes.
// One shared watcher for every caller (it used to be one 700 ms interval per
// script, ten of them, plus a fixed 500 ms delay before reacting). Content
// scripts can't hook the page's history.pushState, but the Navigation API
// (Chrome, newer Firefox) reports every same-document URL change. Without it,
// a 1 s poll that sleeps while the tab is hidden.
CER._navCbs = [];
CER.onNavigate = function (cb) {
  CER._navCbs.push(cb);
  if (CER._navWired) return;
  CER._navWired = true;
  let last = location.href;
  const nav = globalThis.navigation;
  const check = () => {
    if (!CER.alive()) {
      clearInterval(CER._navTimer); // stop the orphaned poll after a reload/update
      CER._navTimer = null;
      return;
    }
    if (location.href === last) return;
    last = location.href;
    // a short beat so the new route has started rendering
    setTimeout(() => {
      for (const fn of CER._navCbs) {
        try {
          fn();
        } catch {
          /* one broken caller must not stop the rest */
        }
      }
    }, 150);
  };
  if (nav && typeof nav.addEventListener === "function") {
    // currententrychange also covers pushState/replaceState that no one intercepts
    nav.addEventListener("navigatesuccess", check);
    nav.addEventListener("currententrychange", check);
  } else {
    CER._navTimer = setInterval(() => !document.hidden && check(), 1000);
    document.addEventListener("visibilitychange", () => !document.hidden && check());
  }
  window.addEventListener("popstate", check);
};

// Settings keys. Everything else in storage (playtime, caches, notes) is NOT a
// setting: reading it on every CER.get() made each page load pull the whole
// store, and a background playtime write every minute re-ran every
// settings listener in every tab.
CER.SETTINGS_KEYS = [
  "features",
  "knownSidebarItems",
  "sidebarPrefs",
  "knownSections",
  "sectionPrefs",
  "joinPrefs",
  "theme",
  "uiState",
  "cerHealV1",
];

// Read all settings, filling in defaults for anything not saved yet.
// (Like DataStore reads in BAC: never trust the stored shape blindly.)
// One storage read per page: ~20 scripts call this at startup, so the read is
// shared and only redone after a settings key actually changes.
CER._settingsP = null;
CER.get = async function () {
  if (!CER._settingsP) CER._settingsP = CER._readSettings();
  return structuredClone(await CER._settingsP);
};
CER._readSettings = async function () {
  let stored = {};
  try {
    stored = await CER.ext.storage.local.get(CER.SETTINGS_KEYS);
  } catch {
    // context invalidated (reload/update) — hand back defaults, don't reject
    CER._settingsP = null;
    return structuredClone(CER.DEFAULTS);
  }
  const merged = {
    ...structuredClone(CER.DEFAULTS),
    ...stored,
    features: CER.fixFeatures(stored.features ?? {}),
    joinPrefs: { ...CER.DEFAULTS.joinPrefs, ...(stored.joinPrefs ?? {}) },
    sidebarPrefs: { ...(stored.sidebarPrefs ?? {}) },
    sectionPrefs: { ...(stored.sectionPrefs ?? {}) },
    theme: { ...CER.DEFAULTS.theme, ...(stored.theme ?? {}) },
    uiState: { ...CER.DEFAULTS.uiState, ...(stored.uiState ?? {}) },
  };
  // retired theme ids map to their closest current one; unknown ids get the default
  const preset = merged.theme.preset ?? "";
  merged.theme.preset = CER.themeById(preset)?.id ?? CER.DEFAULTS.theme.preset;
  // fixed features: heal storage once if a stored value disagrees
  const sf = stored.features;
  if (sf && Object.keys(CER.DEFAULTS.features).some((k) => !CER.USER_FEATURES.includes(k) && k in sf && sf[k] !== CER.DEFAULTS.features[k])) {
    CER.set({ features: merged.features });
  }
  return merged;
};

// Run `cb(changes)` when a SETTING changes (not caches/playtime). Debounced so
// a burst of toggles is one call. Use this instead of storage.onChanged.
CER.onSettingsChanged = function (cb, delay = 80) {
  let t = null;
  CER.ext.storage.onChanged.addListener((changes, area) => {
    if (area && area !== "local") return;
    if (!Object.keys(changes).some((k) => CER.SETTINGS_KEYS.includes(k))) return;
    clearTimeout(t);
    t = setTimeout(() => cb(changes), delay);
  });
};
// drop the shared read whenever a setting changes (registered first, so every
// later listener sees fresh values)
try {
  CER.ext.storage.onChanged.addListener((changes, area) => {
    if (area && area !== "local") return;
    if (Object.keys(changes).some((k) => CER.SETTINGS_KEYS.includes(k))) CER._settingsP = null;
  });
} catch {
  /* context invalidated */
}

// Our own user ({ id, name, displayName } or null). Fetched once per page and
// shared; before this, five scripts each fetched it separately on every load.
// null + CER.loggedOut = true only on a real "not signed in" answer. A rate
// limit or network blip is retried, and a final failure is not cached, so
// callers that see null with CER.loggedOut false should not act as logged out.
CER._meP = null;
CER.loggedOut = false;
CER.me = function () {
  if (!CER._meP) {
    CER._meP = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 800 * attempt));
        try {
          const r = await fetch("https://users.roblox.com/v1/users/authenticated", { credentials: "include" });
          if (r.status === 401 || r.status === 403) {
            CER.loggedOut = true;
            return null;
          }
          if (r.ok) {
            const d = await r.json();
            if (d && d.id) return d;
          }
        } catch {
          /* network blip: retry */
        }
      }
      CER._meP = null; // unknown, not logged out: let the next caller try again
      return null;
    })();
  }
  return CER._meP;
};

// Some accounts never had the new sidebar, so the key/entry doesn't exist and
// the sync block above can't create it (no user id yet). Fetch the id and
// enable it — takes effect on the next page load.
(async () => {
  try {
    const me = await CER.me();
    if (!me || !me.id) return;
    let obj = {};
    try {
      obj = JSON.parse(localStorage.getItem("new-left-nav")) || {};
    } catch {
      obj = {};
    }
    if (!obj.data) obj.data = {};
    if (obj.data[me.id] !== true) {
      obj.data[me.id] = true;
      localStorage.setItem("new-left-nav", JSON.stringify(obj));
    }
    // the background playtime tracker caches our id: keep it on the account
    // that is signed in now (it used to keep the first one forever)
    const { cerUserId } = await CER.ext.storage.local.get("cerUserId");
    if (String(cerUserId ?? "") !== String(me.id)) await CER.set({ cerUserId: me.id, cerUserIdAt: Date.now() });
  } catch {
    /* ignore */
  }
})();

// Dev only. A build is "dev" only when its manifest carries "cer_dev": true
// (the repo's extension/ folder does; build-firefox.sh and store zips strip
// it) AND has no store update_url. Firefox store installs have no update_url,
// so that alone used to turn every Firefox install into a dev build.
// Dev builds can be reloaded from the page with window.postMessage({ cer:
// "dev-reload" }) and honour the cer-dry-writes test switch.
try {
  const m = CER.ext.runtime.getManifest();
  CER.dev = m.cer_dev === true && !m.update_url;
  if (CER.dev) {
    window.addEventListener("message", (e) => {
      if (e.source === window && e.data?.cer === "dev-reload") CER.ext.runtime.sendMessage({ cer: "dev-reload" });
      // screenshots: show a preset locally, without pickTheme's Roblox theme write
      if (e.source === window && e.data?.cer === "dev-theme" && CER.themeById?.(e.data.id)) {
        CER.get().then((cur) => CER.set({ theme: { ...cur.theme, preset: e.data.id } }));
      }
    });
  }
} catch {
  CER.dev = false;
}
// Dev test switch: sessionStorage["cer-dry-writes"] = "1" makes page writes
// log instead of sending. Never read outside dev builds.
CER.dryWrites = function () {
  if (!CER.dev) return false;
  try {
    return sessionStorage.getItem("cer-dry-writes") === "1";
  } catch {
    return false;
  }
};

// Send feedback/bug/idea to the maintainer's Discord webhook, via the
// background worker (Roblox CSP blocks a page fetch to discord.com). The URL
// lives only in background.js — we just hand it the text. 10-minute cooldown.
CER.FEEDBACK_COOLDOWN = 10 * 60 * 1000;
CER.sendFeedback = async function (kind, message) {
  let feedbackAt = 0;
  try {
    ({ feedbackAt = 0 } = await CER.ext.storage.local.get("feedbackAt"));
  } catch {
    return { ok: false, status: 0 }; // context invalidated (extension reloading)
  }
  const wait = CER.FEEDBACK_COOLDOWN - (Date.now() - feedbackAt);
  if (wait > 0) return { ok: false, cooldown: Math.ceil(wait / 60000) };
  let me = null;
  try {
    me = await CER.me();
  } catch {}
  const who = me ? `${me.name} (${me.id})` : "unknown user";
  const v = CER.ext.runtime.getManifest().version;
  const text = `**[${kind}]** from **${who}** · v${v}\n${message}`;
  const res = await new Promise((resolve) => {
    try {
      CER.ext.runtime.sendMessage({ cer: "feedback", text }, (r) => {
        void CER.ext.runtime.lastError; // read it: a closed port is just a failed send
        resolve(r ?? { ok: false, status: 0 });
      });
    } catch {
      resolve({ ok: false, status: 0 }); // context invalidated
    }
  });
  if (res?.ok) await CER.set({ feedbackAt: Date.now() });
  return res ?? { ok: false };
};

// Inline skeleton grid — drop into a container while a pill/tab/genre loads.
CER.skelGrid = function (n = 6, tileH = 150, tileW = 200) {
  const g = CER.el("div", "cer-skel-row cer-skel-inline");
  for (let i = 0; i < n; i++) {
    const t = CER.el("div", "cer-skel-tile");
    t.style.height = tileH + "px";
    t.style.width = tileW + "px";
    g.appendChild(t);
  }
  return g;
};

// Toast notifications — bottom-centre, auto-dismiss. CER.toast("Wore Ninja") or
// CER.toast("Couldn't save", "error"). Shared across every CER surface.
CER.toast = function (message, kind) {
  let host = document.querySelector(".cer-toast-host");
  if (!host) {
    host = CER.el("div", "cer-toast-host");
    document.body.appendChild(host);
  }
  const t = CER.el("div", "cer-toast" + (kind ? " cer-toast-" + kind : ""), message);
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("cer-toast-in"));
  setTimeout(() => {
    t.classList.remove("cer-toast-in");
    setTimeout(() => t.remove(), 250);
  }, 2600);
  return t;
};

CER.set = async function (patch) {
  try {
    return await CER.ext.storage.local.set(patch);
  } catch {
    /* context invalidated — ignore */
  }
};

// Regions offered for the "preferred region" join option. Keys match the ones
// the background worker uses to tag a server from its coordinates.
CER.REGIONS = {
  "us-east": "US East",
  "us-central": "US Central",
  "us-west": "US West",
  brazil: "Brazil",
  uk: "UK",
  europe: "Europe",
  india: "India",
  singapore: "Singapore",
  japan: "Japan",
  australia: "Australia",
};

// Tiny element builder: CER.el("div", "cer-grid") or CER.el("span", "cls", "text")
CER.el = function (tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

// Run `fn` until it returns something truthy, watching the page for changes.
// Roblox builds its pages with JavaScript after load, so the element we want
// usually doesn't exist yet when our script runs — this waits for it.
CER.waitFor = function (fn, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const first = fn();
    if (first) return resolve(first);

    const observer = new MutationObserver(() => {
      const el = fn();
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error("CER.waitFor timed out"));
    }, timeoutMs);
  });
};

// Write requests to Roblox need the CSRF token dance: the first call gets a
// 403 with a token in the headers, the retry with that token succeeds.
CER.robloxWrite = async function (url, method, body) {
  // seed from the last token we saw: if a 403 ever comes back WITHOUT the
  // header (malformed response), we can still retry with a cached one instead
  // of giving up.
  let token = CER._csrf || "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": token },
      body: JSON.stringify(body),
    });
    if (res.status === 403 && attempt === 0) {
      const fresh = res.headers.get("x-csrf-token");
      if (fresh) CER._csrf = fresh;
      const next = fresh || CER._csrf;
      if (next && next !== token) {
        token = next;
        continue;
      }
    }
    return res; // always a Response (it used to fall out as undefined)
  }
};

// Fetch via the background worker — needed for hosts that reject the page's
// CORS preflight (apis.roblox.com writes). Returns { ok, status, data }.
CER.bgFetch = function (url, method = "GET", body) {
  return new Promise((resolve) => {
    try {
      CER.ext.runtime.sendMessage({ cer: "fetch", url, method, body }, (r) => {
        void CER.ext.runtime.lastError; // worker torn down mid-request: just a failed fetch
        resolve(r ?? { ok: false, status: 0 });
      });
    } catch {
      resolve({ ok: false, status: 0 }); // context invalidated
    }
  });
};

// Switch Roblox's own light/dark setting (verified: PATCH themes/User) and
// flip the body classes so it takes effect without a reload.
CER.setNativeTheme = async function (type) {
  try {
    await CER.robloxWrite("https://accountsettings.roblox.com/v1/themes/User", "PATCH", { themeType: type });
  } catch {
    /* purely cosmetic — the body-class flip below still applies this tab */
  }
  for (const [cls, on] of [
    ["dark-theme", type === "Dark"],
    ["light-theme", type === "Light"],
    ["color-mode-dark", type === "Dark"],
    ["color-mode-light", type === "Light"],
  ])
    document.body?.classList.toggle(cls, on);
};

// Apply a theme preset (the one place that does it: CER panel, CER account
// page, Roblox's own Browser preferences page). Roblox Light/Dark flip
// Roblox's own setting and reload so it sticks; CER themes ride on native
// dark/light; Auto just hands the page back to Roblox's own theme.
CER.pickTheme = async function (id) {
  const t = CER.themeById(id);
  if (!t) return;
  const cur = await CER.get();
  if (cur.theme.preset === t.id) return;
  await CER.set({ theme: { ...cur.theme, preset: t.id } });
  if (t.native) {
    await CER.setNativeTheme(t.native);
    location.reload();
  } else if (t.id !== "") {
    await CER.setNativeTheme(t.dark ? "Dark" : "Light");
  }
};

// Theme picker: every preset as a tiny page (sidebar, hero, game tiles) in
// its own colours. Same component everywhere themes are picked.
//   CER.themePicker({ groups: ["roblox", "cer"], titles: true })
//   CER.themePicker({ groups: ["cer"], prepend: [""], names: { "": "Off" } })
// Tiles stay in sync with the saved theme (one shared settings listener).
CER._pickers = new Set();
CER.themePicker = function (opts = {}) {
  const { h } = CER.ui;
  const groups = opts.groups ?? ["roblox", "cer"];
  const TITLES = { roblox: "Roblox", cer: "CER" };
  const tiles = [];
  const tile = (t) => {
    const p = t.preview ?? { bg: t.bg, side: t.header, card: t.card, accent: t.accent, dark: t.dark };
    const name = opts.names?.[t.id] ?? t.name;
    const el = h(
      "button",
      {
        type: "button",
        class: "cer-tp-tile" + (p.dark ? " is-dark" : ""),
        "aria-pressed": "false",
        "aria-label": name + " theme",
        dataset: { theme: t.id },
        style: { "--p-bg": p.bg, "--p-side": p.side, "--p-card": p.card, "--p-acc": p.accent },
        onClick: () => {
          set(t.id); // instant feedback, the save follows
          CER.pickTheme(t.id);
        },
      },
      h(
        "span",
        { class: "cer-tp-page", "aria-hidden": "true" },
        h("span", { class: "cer-tp-side" }, h("i"), h("i"), h("i"), h("i")),
        h(
          "span",
          { class: "cer-tp-main" },
          h("span", { class: "cer-tp-hero" }, h("i", { class: "cer-tp-line" }), h("i", { class: "cer-tp-line is-short" }), h("b", { class: "cer-tp-play" })),
          h("span", { class: "cer-tp-row" }, h("i"), h("i"), h("i"))
        ),
        h("span", { class: "cer-tp-check" }, CER.ui.icon("check", 14))
      ),
      h("span", { class: "cer-tp-name", text: name })
    );
    tiles.push(el);
    return el;
  };
  const root = h(
    "div",
    { class: "cer-tp" },
    groups.map((g) => {
      const list = CER.THEMES.filter((t) => (t.group ?? "cer") === g);
      const extra = g === groups[0] ? (opts.prepend ?? []).map((id) => CER.themeById(id)).filter(Boolean) : [];
      return h(
        "div",
        { class: "cer-tp-group" },
        opts.titles !== false && h("h3", { class: "cer-tp-title", text: TITLES[g] }),
        h("div", { class: "cer-tp-grid", role: "group", "aria-label": TITLES[g] + " themes" }, [...extra, ...list].map(tile))
      );
    })
  );
  function set(id) {
    for (const el of tiles) {
      const on = el.dataset.theme === id;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }
  root.set = set;
  CER.get().then((s) => set(s.theme.preset));
  CER._pickers.add(root);
  if (!CER._pickersWired) {
    CER._pickersWired = true;
    CER.onSettingsChanged(async (ch) => {
      if (!ch.theme) return;
      const s = await CER.get();
      for (const el of CER._pickers) el.isConnected ? el.set(s.theme.preset) : CER._pickers.delete(el);
    });
  }
  return root;
};

// Game icons from Roblox's thumbnail API. Returns { [universeId]: imageUrl }.
CER.getGameIcons = async function (universeIds) {
  if (universeIds.length === 0) return {};
  const url =
    "https://thumbnails.roblox.com/v1/games/icons?universeIds=" +
    universeIds.join(",") +
    "&size=150x150&format=Png&isCircular=false";
  const icons = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { credentials: "include" }).catch(() => null);
    if (!res || !res.ok) return icons;
    const body = await res.json().catch(() => ({}));
    let pending = false;
    for (const item of body.data ?? []) {
      if (item.imageUrl) icons[item.targetId] = item.imageUrl;
      else if (item.state === "Pending") pending = true;
    }
    if (!pending) break;
    await new Promise((r) => setTimeout(r, 900));
  }
  return icons;
};

// placeId → universeId (never changes). One in-memory map per tab, loaded from
// storage once; places already being looked up share that lookup; unknown
// places go in one batched call (50 a time), and whatever it misses goes
// through the per-place endpoint 4 at a time with 429 backoff. New entries
// are merged into storage in one debounced write (re-read first), so two
// callers finishing together no longer drop each other's ids.
CER._pu = { map: {}, loadP: null, wait: new Map(), dirty: {}, saveT: null };
CER._lookupUniverses = async function (ids) {
  const out = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const r = await fetch("https://games.roblox.com/v1/games/multiget-place-details?placeIds=" + ids.slice(i, i + 50).join(","), { credentials: "include" });
      const list = r.ok ? await r.json().catch(() => null) : null;
      if (Array.isArray(list)) for (const d of list) if (d?.placeId && d.universeId) out[String(d.placeId)] = String(d.universeId);
    } catch {
      /* the per-place path below picks these up */
    }
  }
  const rest = ids.filter((p) => !out[p]);
  let next = 0;
  const worker = async () => {
    while (next < rest.length) {
      const p = rest[next++];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch("https://apis.roblox.com/universes/v1/places/" + p + "/universe");
          if (r.status === 429) {
            await sleep(800 * (attempt + 1));
            continue;
          }
          if (r.ok) {
            const id = (await r.json().catch(() => null))?.universeId; // non-2xx bodies never get cached
            if (id) out[p] = String(id);
          }
        } catch {
          /* leave unresolved */
        }
        break;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, rest.length) }, worker));
  return out;
};
CER._savePlaceUniverses = function () {
  const pu = CER._pu;
  if (pu.saveT) return;
  pu.saveT = setTimeout(async () => {
    pu.saveT = null;
    const add = pu.dirty;
    pu.dirty = {};
    try {
      const { placeUniverseCache = {} } = await CER.ext.storage.local.get("placeUniverseCache");
      const merged = { ...placeUniverseCache, ...add };
      // don't let the map grow forever
      const keys = Object.keys(merged);
      if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 1500)) delete merged[k];
      await CER.set({ placeUniverseCache: merged });
    } catch {
      /* context invalidated: the memory map still works this page */
    }
  }, 1000);
};
CER.getUniverseIds = async function (placeIds) {
  const pu = CER._pu;
  pu.loadP ??= (async () => {
    try {
      const { placeUniverseCache = {} } = await CER.ext.storage.local.get("placeUniverseCache");
      pu.map = { ...placeUniverseCache, ...pu.map };
    } catch {
      /* context invalidated: resolve without the cache */
    }
  })();
  await pu.loadP;
  const result = {};
  const missing = [];
  for (const raw of placeIds) {
    const p = String(raw);
    if (pu.map[p]) result[p] = pu.map[p];
    else if (/^\d+$/.test(p) && !missing.includes(p)) missing.push(p);
  }
  const fresh = missing.filter((p) => !pu.wait.has(p));
  if (fresh.length) {
    const job = CER._lookupUniverses(fresh)
      .catch(() => ({}))
      .then((found) => {
        for (const p of fresh) pu.wait.delete(p);
        for (const p in found) pu.map[p] = pu.dirty[p] = found[p];
        if (Object.keys(found).length) CER._savePlaceUniverses();
        return found;
      });
    for (const p of fresh) pu.wait.set(p, job);
  }
  const waits = missing.map((p) => pu.wait.get(p).then((found) => found[p] && (result[p] = found[p])));
  await Promise.all(waits);
  return result;
};

// 16:9 game thumbnails. Returns { [universeId]: imageUrl }.
// Chunks in batches of 50 (the API rejects large id lists → blank cards) and
// retries state:"Pending" so thumbnails aren't blank on a slow connection.
CER.getGameThumbs = async function (universeIds) {
  if (universeIds.length === 0) return {};
  const thumbs = {};
  for (let i = 0; i < universeIds.length; i += 50) {
    const chunk = universeIds.slice(i, i + 50);
    const url =
      "https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=" +
      chunk.join(",") +
      "&size=768x432&format=Png&countPerUniverse=1";
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { credentials: "include" }).catch(() => null);
      if (!res || !res.ok) break;
      const body = await res.json();
      let pending = false;
      for (const item of body.data ?? []) {
        const t = item.thumbnails?.[0];
        if (t?.imageUrl && item.universeId) thumbs[item.universeId] = t.imageUrl;
        else if (t?.state === "Pending") pending = true;
      }
      if (!pending) break;
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  return thumbs;
};

// Playing count + like percentage for game cards, like the native tiles show.
// Sequential (not parallel) + a retry on the info call — firing both at once
// intermittently rate-limits one, which dropped the CCU (playing) count.
CER.getGameMeta = async function (universeIds) {
  if (universeIds.length === 0) return {};
  const ids = universeIds.join(",");
  const meta = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const info = await fetch("https://games.roblox.com/v1/games?universeIds=" + ids, { credentials: "include" }).then((r) => r.json());
      if (info.data) {
        for (const g of info.data) meta[g.id] = { playing: g.playing ?? 0 };
        break;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  try {
    const votes = await fetch("https://games.roblox.com/v1/games/votes?universeIds=" + ids, { credentials: "include" }).then((r) => r.json());
    for (const v of votes.data ?? []) {
      const total = (v.upVotes ?? 0) + (v.downVotes ?? 0);
      (meta[v.id] ??= {}).votesPct = total > 0 ? Math.round((v.upVotes / total) * 100) : null;
    }
  } catch {
    /* rating optional */
  }
  return meta;
};

// Game-title cleanup per user settings: "[UPD] Bedwars 🔥" → "Bedwars".
CER.cleanTitle = function (title, features) {
  features = features || {};
  if (title == null) return ""; // never call .replace/.trim on a missing title
  let out = title;
  if (features.cleanTitles) out = out.replace(/\s*[\[(][^\])]*[\])]/g, " ");
  if (features.stripEmojis) out = out.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}️]/gu, "");
  out = out.replace(/\s{2,}/g, " ").trim();
  return out || title.trim(); // never clean a title into nothing
};

// Crisp currentColor SVG icons (sprites break outside their exact context,
// and gray sprites don't follow themes).
CER.ICON_PATHS = {
  gear: "M19.4 13a7.6 7.6 0 0 0 .1-1 7.6 7.6 0 0 0-.1-1l2.1-1.6a.5.5 0 0 0 .1-.7l-2-3.4a.5.5 0 0 0-.6-.2l-2.5 1a7.6 7.6 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.5l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.4a.5.5 0 0 0 .1.7L4.5 11a7.6 7.6 0 0 0-.1 1 7.6 7.6 0 0 0 .1 1l-2.1 1.6a.5.5 0 0 0-.1.7l2 3.4c.1.2.4.3.6.2l2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6c0 .3.2.5.5.5h4c.3 0 .5-.2.5-.5l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.4a.5.5 0 0 0-.1-.7L19.4 13Zm-7.4 2.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5Z",
  chart: "M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z",
  bag: "M7 7V6a5 5 0 0 1 10 0v1h3l-1 14a2 2 0 0 1-2 1.8H7A2 2 0 0 1 5 21L4 7h3Zm2 0h6V6a3 3 0 0 0-6 0v1Z",
  hammer: "m14.7 3 6.3 6.3-2.1 2.1-1.1-1-1 1L21 15.6 18.9 22l-7.1-7.1 1-1-1-1.1 2.1-2.1-1-1.1L14.7 3ZM3 17.3 10.6 9.7l3.7 3.7L6.7 21A2.6 2.6 0 0 1 3 17.3Z",
  chat: "M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2Zm3 5v2h10V9H7Z",
  like: "M2 21h3V9H2v12ZM22 10a2 2 0 0 0-2-2h-5.3l1-4.6A1.7 1.7 0 0 0 14 1.4L8 8.1V21h9.4a2 2 0 0 0 2-1.5l2.5-8A2 2 0 0 0 22 10Z",
  people: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.3 0-8 1.7-8 5v3h16v-3c0-3.3-4.7-5-8-5Z",
  // Robux mark: hexagon coin with a square negative space (evenodd)
  robux: "M12 2 20.66 7v10L12 22 3.34 17V7L12 2Zm0 3.2L6.1 8.6v6.8L12 18.8l5.9-3.4V8.6L12 5.2ZM9.4 9.4h5.2v5.2H9.4V9.4Z",
  trash: "M9 3h6l1 2h4v2H4V5h4l1-2ZM6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8Zm4 2v9h1.5v-9H10Zm3 0v9h1.5v-9H13Z",
  refresh: "M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z",
  check: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z",
  controller: "M6.5 6h11A6.5 6.5 0 0 1 24 12.5l-.8 4.9a2.4 2.4 0 0 1-4.2 1.1L16.8 16H7.2l-2.2 2.5a2.4 2.4 0 0 1-4.2-1.1L0 12.5A6.5 6.5 0 0 1 6.5 6ZM7 9v1.5H5.5v2H7V14h2v-1.5h1.5v-2H9V9H7Zm9 0a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 16 9Zm2 3a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 18 12Z",
  person: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm-8 9a8 8 0 0 1 16 0v1H4v-1Z",
};

// Outline (stroke) icons — Roblox's nav icons are roundish and stroke-dominant,
// but it exposes no icon-regular glyph for games/gear/mail, so we draw matching
// stroke SVGs. These render with fill:none + stroke:currentColor.
CER.ICON_OUTLINE = {
  controller:
    "M9 8.5h6a5 5 0 0 1 4.9 4l.8 4a2 2 0 0 1-3.5 1.7L15 15.5H9l-2.2 2.7A2 2 0 0 1 3.3 16.5l.8-4a5 5 0 0 1 4.9-4Z M7.5 11.5v2.5 M6.25 12.75h2.5 M15.5 11.5h.01 M17 13.5h.01",
  gear:
    "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z M19.1 14.3a1.5 1.5 0 0 0 .3 1.65l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05a1.5 1.5 0 0 0-2.55 1.06V21a2 2 0 0 1-4 0v-.08a1.5 1.5 0 0 0-2.55-1.06l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.5 1.5 0 0 0 4.9 14.3a1.5 1.5 0 0 0-1.37-.9H3a2 2 0 0 1 0-4h.08a1.5 1.5 0 0 0 1.37-1 1.5 1.5 0 0 0-.3-1.65l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.5 1.5 0 0 0 9.7 4.9a1.5 1.5 0 0 0 .9-1.37V3a2 2 0 0 1 4 0v.08a1.5 1.5 0 0 0 2.55 1.06l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05a1.5 1.5 0 0 0 1.06 2.55H21a2 2 0 0 1 0 4h-.08a1.5 1.5 0 0 0-1.37.9Z",
  mail:
    "M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z M3.5 7l8.5 6 8.5-6",
};

CER.svg = function (name, size = 20) {
  const span = CER.el("span", "cer-gear-svg");
  const outline = CER.ICON_OUTLINE[name];
  if (outline) {
    span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${outline}"/></svg>`;
  } else {
    span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="${CER.ICON_PATHS[name] ?? ""}"/></svg>`;
  }
  return span;
};

CER.gearIcon = () => CER.svg("gear");

// Native-look dropdown (replaces browser <select> in the avatar editor).
// options: [[value, label], ...]
CER.dropdown = function (options, initial, onChange) {
  const wrap = CER.el("div", "cer-dd");
  let value = initial ?? options[0][0];
  const btn = CER.el("button", "cer-dd-btn");
  const label = CER.el("span", "", options.find((o) => o[0] === value)?.[1] ?? "");
  btn.appendChild(label);
  btn.appendChild(CER.el("span", "cer-dd-caret", "▾"));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelector(".cer-ctx")?.remove();
    const menu = CER.el("div", "cer-ctx");
    for (const [v, text] of options) {
      const item = CER.el("button", "cer-ctx-item", text);
      item.addEventListener("click", () => {
        menu.remove();
        if (v === value) return;
        value = v;
        label.textContent = text;
        onChange(v);
      });
      menu.appendChild(item);
    }
    const place = () => {
      const r = btn.getBoundingClientRect();
      menu.style.left = r.left + "px";
      menu.style.top = r.bottom + 4 + "px";
    };
    place();
    document.body.appendChild(menu);
    // a fixed-position menu doesn't follow the button on scroll — close it
    const onScroll = () => menu.remove();
    setTimeout(() => {
      document.addEventListener("click", () => menu.remove(), { once: true });
      window.addEventListener("scroll", onScroll, { once: true, capture: true });
    }, 0);
  });
  wrap.appendChild(btn);
  return wrap;
};

// Launch through Roblox's own GameLauncher (bridge.js, page world). Only if
// the bridge doesn't confirm within 500 ms, fall back to the protocol URL.
CER.launch = function (msg, fallbackUrl) {
  const nonce = Math.random().toString(36).slice(2);
  let acked = false;
  const onAck = (e) => {
    if (e.source === window && e.data?.cer === "launch-ack" && e.data.nonce === nonce) acked = true;
  };
  window.addEventListener("message", onAck);
  window.postMessage({ ...msg, nonce }, location.origin);
  setTimeout(() => {
    window.removeEventListener("message", onAck);
    if (!acked && fallbackUrl) location.href = fallbackUrl;
  }, 500);
};

// Native-looking game card (thumbnail or icon) with the rating/CCU row.
// opts: { wide, art, meta: {votesPct, playing}, features, onUnpin }
CER.buildGameCard = function (game, opts) {
  const card = CER.el("div", "cer-card" + (opts.wide ? " cer-card-wide" : ""));

  const link = CER.el("a", "cer-card-link");
  link.href = "https://www.roblox.com/games/" + game.placeId;

  const thumb = CER.el("span", "cer-card-thumb");
  const img = CER.el("img");
  img.src = opts.art ?? "";
  img.alt = game.name;
  img.loading = "lazy";
  thumb.appendChild(img);
  link.appendChild(thumb);

  const name = CER.el("div", "cer-card-name", CER.cleanTitle(game.name, opts.features ?? {}));
  name.title = game.name;
  link.appendChild(name);

  // rating + player count with Roblox's own sprite icons (like native tiles)
  const metaRow = CER.el("div", "cer-card-meta");
  const m = opts.meta ?? {};
  if (m.votesPct != null) {
    const v = CER.el("span", "cer-card-meta-item");
    v.appendChild(CER.svg("like", 15));
    v.appendChild(CER.el("span", "", m.votesPct + "%"));
    metaRow.appendChild(v);
  }
  if (m.playing != null) {
    const p = CER.el("span", "cer-card-meta-item");
    p.appendChild(CER.svg("people", 15));
    p.appendChild(CER.el("span", "", Number(m.playing).toLocaleString()));
    metaRow.appendChild(p);
  }
  link.appendChild(metaRow);
  card.appendChild(link);

  const play = CER.el("button", "cer-card-play");
  play.title = "Play";
  play.appendChild(CER.el("span", "icon-common-play"));
  play.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    CER.launch({ cer: "join-multiplayer", placeId: game.placeId }, "roblox://experiences/start?placeId=" + game.placeId);
  });
  thumb.appendChild(play);

  if (opts.onUnpin) {
    const unpin = CER.el("button", "cer-tile-unpin", "×");
    unpin.title = "Unpin";
    unpin.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      opts.onUnpin(game, card);
    });
    thumb.appendChild(unpin);
  }

  return card;
};

