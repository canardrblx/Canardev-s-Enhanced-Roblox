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

// Some accounts never had the new sidebar, so the key/entry doesn't exist and
// the sync block above can't create it (no user id yet). Fetch the id and
// enable it — takes effect on the next page load.
(async () => {
  try {
    const me = await fetch("https://users.roblox.com/v1/users/authenticated", { credentials: "include" }).then((r) => r.json());
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
  } catch {
    /* ignore */
  }
})();

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
      preset: "", // id from CER.THEMES, "" = leave Roblox alone
      font: "",
    },
    uiState: {
      profileExpanded: false,
      recsNoticeHidden: false,
    },
  },
};

// Theme presets, Discord-Nitro style.
// `native` presets just flip Roblox's own light/dark setting.
// `dark` presets ALSO flip Roblox to native dark first, so Roblox themes its
// own text/chat/search/footer — then we tint backgrounds and accents on top.
// `card` must contrast clearly with `bg` (user feedback: cards were invisible).
// `flat` is the solid fallback for gradient backgrounds — it feeds the design
// tokens, which can't hold gradients.
CER.THEMES = [
  { id: "", name: "Default", accent: "#335fff", swatch: "linear-gradient(135deg,#fff 50%,#232527 50%)" },
  { id: "native-light", name: "Roblox Light", native: "Light", accent: "#335fff", swatch: "#ffffff" },
  { id: "native-dark", name: "Roblox Dark", native: "Dark", accent: "#335fff", swatch: "#232527" },
  { id: "blossom", name: "Blossom", bg: "#fff0f4", header: "#ffdbe6", card: "#ffe4ed", accent: "#f5427e", swatch: "#f5427e" },
  { id: "mint", name: "Mint", bg: "#effbf4", header: "#d5f3e2", card: "#dff7e9", accent: "#00a05f", swatch: "#00a05f" },
  { id: "sky", name: "Sky", bg: "linear-gradient(180deg, #eaf4ff 0%, #d9e9ff 100%)", flat: "#e4f0ff", header: "#cfe5ff", card: "#dcebff", accent: "#0074ff", swatch: "linear-gradient(135deg,#7db8ff,#0074ff)" },
  { id: "cotton", name: "Cotton Candy", bg: "linear-gradient(160deg, #fdeffd 0%, #e8f0ff 100%)", flat: "#f5eefd", header: "#f0dcf7", card: "#f7ebfb", accent: "#b96bff", swatch: "linear-gradient(135deg,#ffb3ec,#9db8ff)" },
  { id: "midnight", name: "Midnight", dark: true, bg: "#16181d", header: "#1f2229", card: "#2c323f", accent: "#5865f2", swatch: "#16181d" },
  { id: "oled", name: "OLED", dark: true, bg: "#000000", header: "#0b0b0b", card: "#1d1d1d", accent: "#00d9a5", swatch: "#000000" },
  { id: "sunset", name: "Sunset", dark: true, bg: "linear-gradient(160deg, #1f1135 0%, #452363 55%, #7a3b5e 100%)", flat: "#2b1844", header: "rgba(20, 10, 40, 0.92)", card: "rgba(72, 44, 108, 0.94)", accent: "#ff7e5f", swatch: "linear-gradient(135deg,#452363,#ff7e5f)" },
  { id: "lava", name: "Lava", dark: true, bg: "linear-gradient(180deg, #1a0d0d 0%, #2d0e0e 100%)", flat: "#210d0d", header: "#240d0d", card: "#4a1a1a", accent: "#ff4433", swatch: "linear-gradient(135deg,#3d1010,#ff4433)" },
  { id: "grape", name: "Grape", dark: true, bg: "#1a1226", header: "#241934", card: "#352450", accent: "#a05cff", swatch: "linear-gradient(135deg,#241934,#a05cff)" },
  { id: "forest", name: "Forest", dark: true, bg: "#0f1a12", header: "#16241a", card: "#22392a", accent: "#3ddc84", swatch: "linear-gradient(135deg,#16241a,#3ddc84)" },
  { id: "ocean", name: "Ocean", dark: true, bg: "#0a1620", header: "#102331", card: "#1a3549", accent: "#00b4ff", swatch: "linear-gradient(135deg,#102331,#00b4ff)" },
  { id: "coffee", name: "Coffee", dark: true, bg: "#191310", header: "#241c16", card: "#37291e", accent: "#c98a4b", swatch: "linear-gradient(135deg,#241c16,#c98a4b)" },
  { id: "cyber", name: "Cyber", dark: true, bg: "#0d0d12", header: "#131320", card: "#1e1e33", accent: "#00f0ff", swatch: "linear-gradient(135deg,#131320,#00f0ff)" },
  // Starfields are TILED (fixed px tile, repeat) so density is identical on
  // 1080p, 4K, and ultrawide — percentage-positioned stars go sparse on big
  // screens. Nebulae/base gradients use % and scale cleanly everywhere.
  {
    id: "nightsky", name: "Night Sky", dark: true, flat: "#05050f",
    bg: "radial-gradient(1.5px 1.5px at 34px 46px, rgba(255,255,255,0.9), transparent 2.5px) 0 0 / 460px 460px repeat, radial-gradient(1px 1px at 198px 122px, rgba(255,255,255,0.6), transparent 2px) 0 0 / 460px 460px repeat, radial-gradient(1.2px 1.2px at 322px 310px, rgba(255,255,255,0.8), transparent 2.5px) 0 0 / 460px 460px repeat, radial-gradient(1px 1px at 118px 372px, rgba(255,255,255,0.5), transparent 2px) 0 0 / 460px 460px repeat, radial-gradient(1.3px 1.3px at 420px 208px, rgba(255,255,255,0.7), transparent 2.5px) 0 0 / 460px 460px repeat, radial-gradient(1px 1px at 262px 34px, rgba(255,255,255,0.45), transparent 2px) 0 0 / 460px 460px repeat, linear-gradient(180deg, #04040d 0%, #0a0a24 65%, #10102e 100%)",
    header: "rgba(8, 8, 26, 0.94)", card: "#191936", accent: "#7aa5ff", swatch: "linear-gradient(135deg,#04040d,#7aa5ff)",
  },
  {
    id: "galaxy", name: "Galaxy", dark: true, flat: "#0a0518",
    bg: "radial-gradient(ellipse 60% 40% at 30% 25%, rgba(140,70,220,0.35), transparent), radial-gradient(ellipse 55% 45% at 78% 70%, rgba(40,120,255,0.28), transparent), radial-gradient(ellipse 40% 30% at 60% 40%, rgba(255,80,180,0.15), transparent), linear-gradient(160deg, #070312 0%, #140a2c 55%, #0a0618 100%)",
    header: "rgba(14, 7, 32, 0.94)", card: "#231343", accent: "#c26bff", swatch: "linear-gradient(135deg,#140a2c,#c26bff)",
  },
  {
    id: "beach", name: "Beach", flat: "#bfe6f7",
    bg: "linear-gradient(180deg, #9fd9ff 0%, #c9edff 38%, #5fb9e6 46%, #7fcbea 55%, #ffedc9 63%, #ffe2ad 100%)",
    header: "#bce4f7", card: "#fff6e6", accent: "#ff8a4d", swatch: "linear-gradient(180deg,#9fd9ff 45%,#ffe2ad 55%)",
  },
  {
    id: "ember", name: "Ember", dark: true, flat: "#140b08",
    bg: "linear-gradient(180deg, #0f0705 0%, #1c0f09 60%, #2b140a 100%)",
    header: "#1a0e08", card: "#33200f", accent: "#ff8c3b", swatch: "linear-gradient(135deg,#1c0f09,#ff8c3b)",
    extra: "@keyframes cer-flicker { 0%, 100% { opacity: 0.5; } 42% { opacity: 0.75; } 68% { opacity: 0.6; } } body::before { content: ''; position: fixed; left: 0; right: 0; bottom: 0; height: 45vh; pointer-events: none; z-index: 0; background: radial-gradient(ellipse at 50% 105%, rgba(255, 128, 40, 0.35), transparent 65%); animation: cer-flicker 3.2s ease-in-out infinite; }",
  },
  {
    id: "aurora", name: "Aurora", dark: true, flat: "#05100f",
    bg: "linear-gradient(180deg, #04100f 0%, #061a1c 60%, #0a1122 100%)",
    header: "rgba(7, 22, 24, 0.94)", card: "#123030", accent: "#4bffd0", swatch: "linear-gradient(135deg,#0a2b2b,#4bffd0)",
    // slow-shifting green/teal light curtains up top
    extra: "@keyframes cer-aurora { 0% { transform: translateX(-8%) skewX(-6deg); opacity: 0.45; } 50% { transform: translateX(8%) skewX(6deg); opacity: 0.7; } 100% { transform: translateX(-8%) skewX(-6deg); opacity: 0.45; } } body::before { content: ''; position: fixed; top: -10%; left: -10%; right: -10%; height: 60vh; pointer-events: none; z-index: 0; background: radial-gradient(ellipse 50% 60% at 30% 0%, rgba(75,255,208,0.28), transparent 70%), radial-gradient(ellipse 45% 55% at 70% 10%, rgba(90,140,255,0.22), transparent 70%), radial-gradient(ellipse 40% 50% at 50% 5%, rgba(180,90,255,0.15), transparent 70%); filter: blur(20px); animation: cer-aurora 12s ease-in-out infinite; }",
  },
];

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
CER.onNavigate = function (cb) {
  let last = location.href;
  const timer = setInterval(() => {
    if (!CER.alive()) {
      clearInterval(timer); // stop the orphaned poll after a reload/update
      return;
    }
    if (location.href !== last) {
      last = location.href;
      setTimeout(cb, 500);
    }
  }, 700);
};

// Read all settings, filling in defaults for anything not saved yet.
// (Like DataStore reads in BAC: never trust the stored shape blindly.)
CER.get = async function () {
  let stored = {};
  try {
    stored = await CER.ext.storage.local.get(null);
  } catch {
    // context invalidated (reload/update) — hand back defaults, don't reject
    return structuredClone(CER.DEFAULTS);
  }
  const merged = {
    ...structuredClone(CER.DEFAULTS),
    ...stored,
    features: { ...CER.DEFAULTS.features, ...(stored.features ?? {}) },
    joinPrefs: { ...CER.DEFAULTS.joinPrefs, ...(stored.joinPrefs ?? {}) },
    sectionPrefs: { ...(stored.sectionPrefs ?? {}) },
    theme: { ...CER.DEFAULTS.theme, ...(stored.theme ?? {}) },
    uiState: { ...CER.DEFAULTS.uiState, ...(stored.uiState ?? {}) },
  };
  // One-time heal: an early version had a "Profile header" toggle that was later
  // removed from the UI. Accounts that had turned it off got stuck with the home
  // profile card permanently hidden and no way to re-enable it. Restore it once
  // (guarded by cerHealV1 so a deliberate future toggle still sticks).
  if (!stored.cerHealV1 && stored.features && stored.features.profileHeader === false) {
    merged.features.profileHeader = true;
    CER.set({ features: { ...merged.features, profileHeader: true }, cerHealV1: true });
  }
  return merged;
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
    me = await (await fetch("https://users.roblox.com/v1/users/authenticated", { credentials: "include" })).json();
  } catch {}
  const who = me ? `${me.name} (${me.id})` : "unknown user";
  const v = CER.ext.runtime.getManifest().version;
  const text = `**[${kind}]** from **${who}** · v${v}\n${message}`;
  const res = await new Promise((resolve) => CER.ext.runtime.sendMessage({ cer: "feedback", text }, resolve));
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
    if (res.status === 403) {
      const fresh = res.headers.get("x-csrf-token");
      if (fresh) CER._csrf = fresh;
      const next = fresh || CER._csrf;
      if (next && next !== token) {
        token = next;
        continue;
      }
    }
    return res;
  }
};

// Fetch via the background worker — needed for hosts that reject the page's
// CORS preflight (apis.roblox.com writes). Returns { ok, status, data }.
CER.bgFetch = function (url, method = "GET", body) {
  return new Promise((resolve) => {
    try {
      CER.ext.runtime.sendMessage({ cer: "fetch", url, method, body }, (r) =>
        resolve(r ?? { ok: false, status: 0 })
      );
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
  document.body?.classList.toggle("dark-theme", type === "Dark");
  document.body?.classList.toggle("light-theme", type === "Light");
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
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return icons;
    const body = await res.json();
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

// placeId → universeId, cached in storage so Continue-tab thumbnail swaps
// don't refetch on every page load.
CER.getUniverseIds = async function (placeIds) {
  const { placeUniverseCache = {} } = await CER.ext.storage.local.get("placeUniverseCache");
  const result = {};
  const missing = [];
  for (const p of placeIds) {
    if (placeUniverseCache[p]) result[p] = placeUniverseCache[p];
    else missing.push(p);
  }
  await Promise.all(
    missing.map(async (p) => {
      try {
        const r = await fetch("https://apis.roblox.com/universes/v1/places/" + p + "/universe");
        if (!r.ok) return; // non-2xx with a JSON body would otherwise cache a bad/undefined id
        const id = (await r.json()).universeId;
        if (id) {
          result[p] = String(id);
          placeUniverseCache[p] = String(id);
        }
      } catch {
        /* leave unresolved */
      }
    })
  );
  if (missing.length) await CER.ext.storage.local.set({ placeUniverseCache });
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
    window.postMessage({ cer: "join-multiplayer", placeId: game.placeId }, location.origin);
    setTimeout(() => {
      location.href = "roblox://experiences/start?placeId=" + game.placeId;
    }, 400);
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

