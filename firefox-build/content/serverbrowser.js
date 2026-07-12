// Enhanced server browser (Servers tab on game pages).
// Adds sorting, small/empty/full filters, locally-tracked server age, a
// one-click "best server" join, and join/copy by ID.
//
// NOTE ON REGION: showing each server's region requires its IP, obtained from
// gamejoin.roblox.com/v1/join-game-instance. Roblox now hard-blocks that call
// from anywhere but the real game client (returns status 12, "Unable to join"),
// verified live. So region badges are not built here — the Join-tab region
// preference stays parked until/unless that endpoint reopens. Everything below
// works with the public server-list API alone.

(async function () {
  if (typeof CER === "undefined") return;
  const placeId = location.pathname.match(/\/games\/(\d+)/)?.[1];
  if (!placeId) return;

  // wait for the native Servers tab/pane to exist
  const pane = await CER.waitFor(() => document.querySelector("#game-instances"), 20000).catch(() => null);
  if (!pane) return;

  // local first-seen tracking → server age
  const AGE_KEY = "serverFirstSeen";
  async function markSeen(ids) {
    const { [AGE_KEY]: seen = {} } = await CER.ext.storage.local.get(AGE_KEY);
    const now = Date.now();
    let changed = false;
    for (const id of ids) if (!seen[id]) { seen[id] = now; changed = true; }
    // prune anything older than 7 days so storage doesn't grow forever
    for (const [id, t] of Object.entries(seen)) if (now - t > 6.048e8) { delete seen[id]; changed = true; }
    if (changed) await CER.ext.storage.local.set({ [AGE_KEY]: seen });
    return seen;
  }

  function ageText(ms) {
    if (ms == null) return "";
    const s = Math.floor(ms / 1000);
    if (s < 60) return "seen just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `seen ${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `seen ${h}h ago`;
    return `seen ${Math.floor(h / 24)}d ago`;
  }

  // ---- our panel, injected above the native list ----

  const panel = CER.el("div", "cer-sb");
  panel.innerHTML = "";

  const controls = CER.el("div", "cer-sb-controls");
  const sortSel = CER.dropdown(
    [
      ["mostFull", "Sort: Most players"],
      ["leastFull", "Sort: Fewest players"],
      ["newest", "Sort: Newest seen"],
      ["oldest", "Sort: Oldest seen"],
    ],
    "mostFull",
    () => render()
  );
  const filterSel = CER.dropdown(
    [
      ["all", "All servers"],
      ["hasRoom", "Has room"],
      ["nearlyEmpty", "Nearly empty"],
      ["nearlyFull", "Nearly full"],
    ],
    "hasRoom",
    () => render()
  );
  const refreshBtn = CER.el("button", "cer-profile-btn", "↻ Refresh");
  refreshBtn.addEventListener("click", () => load());
  const bestBtn = CER.el("button", "cer-join-menu-action cer-sb-best", "Join best server");
  bestBtn.addEventListener("click", joinBest);

  controls.append(sortSel, filterSel, refreshBtn);
  panel.appendChild(controls);
  panel.appendChild(bestBtn);

  // join-by-id row
  const idRow = CER.el("div", "cer-sb-idrow");
  const idInput = CER.el("input", "cer-chat-input");
  idInput.placeholder = "Join by server (job) ID…";
  const idBtn = CER.el("button", "cer-profile-btn", "Join");
  idBtn.addEventListener("click", () => {
    const id = idInput.value.trim();
    if (id) window.postMessage({ cer: "join-instance", placeId, jobId: id }, location.origin);
  });
  idRow.append(idInput, idBtn);
  panel.appendChild(idRow);

  const list = CER.el("div", "cer-sb-list");
  panel.appendChild(list);

  pane.prepend(panel);

  // Hide only Roblox's PUBLIC server lists (our panel replaces those) while
  // keeping the native "Your private servers" section visible — its Create
  // button and per-server config are wired by Roblox and there's no safe public
  // API to rebuild them. The lists load and re-render async, so re-hide on every
  // mutation; keep the private-servers container shown.
  function hideNativePublicLists() {
    for (const el of pane.querySelectorAll(":scope > *:not(.cer-sb)")) el.style.display = "";
    for (const sec of pane.querySelectorAll(".server-list-section")) sec.style.display = "none";
    for (const fb of pane.querySelectorAll(".sg-system-feedback")) fb.style.display = "none";
    // private servers belong ABOVE the public browser
    const priv = pane.querySelector("#running-game-instances-container");
    if (priv && panel.previousElementSibling !== priv) pane.insertBefore(priv, panel);
  }
  hideNativePublicLists();
  new MutationObserver(hideNativePublicLists).observe(pane, { childList: true, subtree: true });

  let servers = [];
  let firstSeen = {};
  let visibleCount = 10; // how many public servers to show before "Load more"

  async function load() {
    visibleCount = 10;
    list.textContent = "";
    list.appendChild(CER.el("p", "cer-hint", "Loading servers…"));
    let all = [];
    let cursor = "";
    // pull up to ~500 servers (5 pages) so sorting/filtering is meaningful
    for (let page = 0; page < 5; page++) {
      const url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`;
      const res = await fetch(url, { credentials: "include" }).then((r) => r.json()).catch(() => null);
      if (!res?.data) break;
      all = all.concat(res.data);
      cursor = res.nextPageCursor;
      if (!cursor) break;
    }
    servers = all;
    firstSeen = await markSeen(all.map((s) => s.id));
    render();
  }

  function render() {
    const sort = sortSel.querySelector(".cer-dd-btn span").textContent;
    const filter = filterSel.querySelector(".cer-dd-btn span").textContent;
    let rows = servers.slice();

    if (/Has room/.test(filter)) rows = rows.filter((s) => s.playing < s.maxPlayers);
    else if (/Nearly empty/.test(filter)) rows = rows.filter((s) => s.playing <= Math.max(1, s.maxPlayers * 0.25));
    else if (/Nearly full/.test(filter)) rows = rows.filter((s) => s.playing >= s.maxPlayers * 0.75 && s.playing < s.maxPlayers);

    const age = (s) => firstSeen[s.id] ?? Date.now();
    if (/Most players/.test(sort)) rows.sort((a, b) => b.playing - a.playing);
    else if (/Fewest players/.test(sort)) rows.sort((a, b) => a.playing - b.playing);
    else if (/Newest/.test(sort)) rows.sort((a, b) => age(b) - age(a));
    else if (/Oldest/.test(sort)) rows.sort((a, b) => age(a) - age(b));

    list.textContent = "";
    if (rows.length === 0) {
      list.appendChild(CER.el("p", "cer-hint", "No servers match."));
      return;
    }
    list.appendChild(CER.el("p", "cer-sb-count", `${rows.length} servers`));
    for (const s of rows.slice(0, visibleCount)) list.appendChild(serverRow(s));
    // show only a handful at a time; reveal more on demand
    if (visibleCount < rows.length) {
      const more = CER.el("button", "cer-profile-btn cer-sb-more", `Load more (${rows.length - visibleCount} more)`);
      more.addEventListener("click", () => {
        visibleCount += 10;
        render();
      });
      list.appendChild(more);
    }
  }

  function serverRow(s) {
    const row = CER.el("div", "cer-sb-row");
    const info = CER.el("div", "cer-sb-info");
    const bar = CER.el("div", "cer-sb-bar");
    const fill = CER.el("div", "cer-sb-fill");
    fill.style.width = (s.maxPlayers > 0 ? Math.round((s.playing / s.maxPlayers) * 100) : 0) + "%";
    if (s.playing >= s.maxPlayers) fill.classList.add("cer-sb-fill-full");
    bar.appendChild(fill);
    info.appendChild(CER.el("div", "cer-sb-players", `${s.playing} / ${s.maxPlayers} players`));
    info.appendChild(bar);
    const sub = CER.el("div", "cer-sb-sub");
    sub.textContent = ageText(Date.now() - (firstSeen[s.id] ?? Date.now()));
    info.appendChild(sub);
    row.appendChild(info);

    const actions = CER.el("div", "cer-sb-actions");
    const join = CER.el("button", "cer-profile-btn", "Join");
    join.disabled = s.playing >= s.maxPlayers;
    join.addEventListener("click", () => window.postMessage({ cer: "join-instance", placeId, jobId: s.id }, location.origin));
    const copy = CER.el("button", "cer-profile-btn", "Copy ID");
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(s.id).catch(() => {});
      copy.textContent = "Copied!";
      setTimeout(() => (copy.textContent = "Copy ID"), 1500);
    });
    actions.append(join, copy);
    row.appendChild(actions);
    return row;
  }

  async function joinBest() {
    // most-populated server that still has room (fullest lobbies feel alive
    // but aren't locked) — respects "avoid friends" from the Join tab
    const settings = await CER.get();
    let open = servers.filter((s) => s.playing < s.maxPlayers);
    if (settings.joinPrefs.avoidFriends) {
      try {
        const me = await (await fetch("https://users.roblox.com/v1/users/authenticated", { credentials: "include" })).json();
        const friends = (await (await fetch(`https://friends.roblox.com/v1/users/${me.id}/friends`, { credentials: "include" })).json()).data ?? [];
        if (friends.length) {
          const pres = await CER.bgFetch("https://presence.roblox.com/v1/presence/users", "POST", { userIds: friends.map((f) => f.id) });
          const inServers = new Set((pres.data?.userPresences ?? []).filter((p) => p.userPresenceType === 2 && p.gameId).map((p) => p.gameId));
          const filtered = open.filter((s) => !inServers.has(s.id));
          if (filtered.length) open = filtered;
        }
      } catch {
        /* skip filter */
      }
    }
    if (open.length === 0) return;
    open.sort((a, b) => b.playing - a.playing);
    window.postMessage({ cer: "join-instance", placeId, jobId: open[0].id }, location.origin);
  }

  await load();
})();
