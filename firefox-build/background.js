// Background service worker.
// Its one job: an authenticated fetch relay. Content scripts run in the page's
// origin, so POSTs to apis.roblox.com (chat send etc.) hit a CORS preflight the
// page isn't allowed to make. The worker holds our host_permissions, so it can
// fetch those hosts directly — cookies included, CSRF dance handled here.
const ext = globalThis.browser ?? globalThis.chrome;

ext.runtime.onInstalled.addListener(() => {
  console.log("Canardev's Enhanced Roblox installed");
  checkForUpdate();
});
ext.runtime.onStartup?.addListener(checkForUpdate);

// ---- update check ----
// Compares the running version to the latest GitHub release and stashes the
// result. Only nags UNPACKED / development installs (people who load CER from a
// git clone). Store installs auto-update, so we never bother them.
const CER_REPO = "canardrblx/Canardev-s-Enhanced-Roblox";
function cerVersionOlder(current, latest) {
  const a = String(current).replace(/^v/, "").split(".").map(Number);
  const b = String(latest).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}
async function checkForUpdate() {
  try {
    // getSelf() works without the "management" permission
    const self = await ext.management?.getSelf?.().catch(() => null);
    if (self && self.installType !== "development") {
      await ext.storage.local.set({ cerUpdate: { available: false } });
      return;
    }
    const res = await fetch(`https://api.github.com/repos/${CER_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    const latest = (await res.json())?.tag_name?.replace(/^v/, "");
    if (!latest) return;
    const current = ext.runtime.getManifest().version;
    await ext.storage.local.set({
      cerUpdate: { available: cerVersionOlder(current, latest), current, latest, checkedAt: Date.now() },
    });
  } catch {
    /* offline or rate-limited — try again next time */
  }
}

async function robloxFetch({ url, method = "GET", body }) {
  const opts = { method, credentials: "include", headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res = await fetch(url, opts);
  // CSRF: first write 403s with a token, retry once with it
  if (res.status === 403 && method !== "GET") {
    const token = res.headers.get("x-csrf-token");
    if (token) {
      opts.headers["X-CSRF-TOKEN"] = token;
      res = await fetch(url, opts);
    }
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, data, text: data ? undefined : text.slice(0, 500) };
}

// ---- playtime tracker ----
// The page can't see into a game, but the presence API reports OUR OWN status.
// Poll every minute; when we're in-game (presenceType 2), bank the elapsed
// time against that universe, bucketed per day. This is exactly how the
// big extensions do it — all local, no telemetry.

const POLL_MS = 60000;

ext.alarms?.create("cer-playtime", { periodInMinutes: 1 });
ext.alarms?.onAlarm.addListener((a) => {
  // never let a failed presence poll surface as an uncaught rejection (which
  // Chrome flags as a persistent service-worker error on the extensions page)
  if (a.name === "cer-playtime") tickPlaytime().catch(() => {});
});

function todayKey(now) {
  // local-date YYYY-MM-DD
  const d = new Date(now);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

let playtimeBusy = false;
async function tickPlaytime() {
  // the alarm and the settings Playtime tab can both fire this; without a lock
  // two overlapping runs read the same stale lastTick and one clobbers the
  // other's write (lost or double-counted minutes)
  if (playtimeBusy) return;
  playtimeBusy = true;
  try {
    await tickPlaytimeInner();
  } finally {
    playtimeBusy = false;
  }
}

async function tickPlaytimeInner() {
  const now = Date.now();
  const store = await ext.storage.local.get(["playtime", "playtimeState", "cerUserId"]);
  const playtime = store.playtime ?? {};
  const state = store.playtimeState ?? { lastTick: null, lastUniverse: null };

  // cache our own user id
  let userId = store.cerUserId;
  if (!userId) {
    try {
      userId = (await (await fetch("https://users.roblox.com/v1/users/authenticated", { credentials: "include" })).json()).id;
      if (userId) await ext.storage.local.set({ cerUserId: userId });
    } catch {
      return;
    }
  }
  if (!userId) return;

  // presence write needs the bg CSRF path
  const res = await robloxFetch({
    url: "https://presence.roblox.com/v1/presence/users",
    method: "POST",
    body: { userIds: [userId] },
  });
  const pres = res.data?.userPresences?.[0];
  const inGame = pres?.userPresenceType === 2 && pres?.universeId;

  if (inGame) {
    const uni = String(pres.universeId);
    // bank the gap since last tick (capped so a slept worker can't over-count)
    let delta = POLL_MS;
    if (state.lastTick && state.lastUniverse === uni) {
      delta = Math.min(now - state.lastTick, 2 * POLL_MS);
    }
    const day = todayKey(now);
    const entry = playtime[uni] ?? { name: pres.lastLocation || "Game", total: 0, days: {} };
    entry.name = pres.lastLocation || entry.name;
    entry.total += delta;
    entry.days[day] = (entry.days[day] ?? 0) + delta;
    // prune days older than ~14 months
    for (const k of Object.keys(entry.days)) {
      if (now - new Date(k).getTime() > 3.7e10) delete entry.days[k];
    }
    playtime[uni] = entry;
    state.lastUniverse = uni;
  } else {
    state.lastUniverse = null;
  }
  state.lastTick = now;
  await ext.storage.local.set({ playtime, playtimeState: state });
}

// Feedback webhook. The URL lives ONLY here (not in any content script), and
// the content script can only send { text } — never a URL — so it can't be
// tricked into posting elsewhere. The page can't reach Discord directly
// (Roblox CSP blocks it), so this relays it.
const FEEDBACK_WEBHOOK =
  "https://discord.com/api/webhooks/1522790720040075406/JRxhPZt8FiBZJ2cHBwpsU03873F6xWBXux2c_SsgBI1DRFTDaX-ve77OTRXNHg2g2DC4";

async function sendFeedback(text) {
  const res = await fetch(FEEDBACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: String(text).slice(0, 1900) }),
  });
  return { ok: res.ok, status: res.status };
}

ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.cer === "playtime-tick") {
    tickPlaytime().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.cer === "check-update") {
    checkForUpdate().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.cer === "feedback") {
    sendFeedback(msg.text).then(sendResponse, (e) => sendResponse({ ok: false, status: 0, error: String(e) }));
    return true;
  }
  if (msg?.cer !== "fetch") return false;
  // only same-site hosts, ever
  try {
    if (!/^https:\/\/([a-z0-9-]+\.)?roblox\.com\//i.test(msg.url)) {
      sendResponse({ ok: false, status: 0, error: "blocked host" });
      return true;
    }
  } catch {
    sendResponse({ ok: false, status: 0, error: "bad url" });
    return true;
  }
  robloxFetch(msg).then(sendResponse, (e) => sendResponse({ ok: false, status: 0, error: String(e) }));
  return true; // async response
});
