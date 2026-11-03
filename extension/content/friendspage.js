// Redesigned Friends page (/users/friends) — clean grid of friend cards with
// presence, plus a Requests tab with accept/decline. Replaces the native UI
// (features.friendsPage).

(async function () {
  if (typeof CER === "undefined") return;
  if (!location.pathname.startsWith("/users/friends")) return;
  // pages/friends.js owns this page now (CER.ui redesign); stand down.
  if ((await CER.takeover) === "friends") return;
  if (/[?&]cer=native\b/.test(location.search)) return; // escape hatch: Roblox's own page
  const settings = await CER.get();
  if (!settings.features.friendsPage) return CER.dismissSkeleton?.();

  const me = await CER.me().catch(() => null);
  if (!me?.id) return CER.dismissSkeleton?.(); // logged out: show Roblox's own page

  const host = await CER.waitFor(() => document.querySelector("#content, main"), 20000).catch(() => null);
  if (!host) return CER.dismissSkeleton?.();
  if (host.querySelector(":scope > .cer-page")) return; // another run owns the page

  const root = CER.el("div", "cer-page");
  for (const child of host.children) child.style.display = "none";
  host.appendChild(root);
  new MutationObserver(() => {
    for (const child of host.children) {
      if (child !== root && child.style.display !== "none") child.style.display = "none";
    }
  }).observe(host, { childList: true });

  const head = CER.el("div", "cer-avatar-head");
  head.appendChild(CER.el("h1", "cer-avatar-title", "Friends"));
  root.appendChild(head);

  const tabs = CER.el("div", "cer-gp-tabs");
  const body = CER.el("div");
  root.appendChild(tabs);
  root.appendChild(body);

  let activeTab = null;
  for (const name of ["Friends", "Requests"]) {
    const tab = CER.el("button", "cer-tab", name);
    tab.addEventListener("click", () => {
      activeTab?.classList.remove("cer-tab-active");
      activeTab = tab;
      tab.classList.add("cer-tab-active");
      name === "Friends" ? renderFriends() : renderRequests();
    });
    tabs.appendChild(tab);
    if (!activeTab) {
      activeTab = tab;
      tab.classList.add("cer-tab-active");
    }
  }

  const PRESENCE = { 0: ["Offline", ""], 1: ["Online", "cer-presence-online"], 2: ["In game", "cer-presence-game"], 3: ["In Studio", "cer-presence-studio"] };

  // every render bumps this; a load that finishes after the user switched tabs
  // sees a newer token and drops its result instead of overwriting the page
  let renderToken = 0;

  const chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  // headshots, 100 ids per GET (bigger lists get rejected → blank avatars)
  async function getHeads(ids) {
    const map = {};
    await Promise.all(
      chunk(ids, 100).map(async (c) => {
        try {
          const r = await fetch(
            "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + c.join(",") + "&size=150x150&format=Png&isCircular=false",
            { credentials: "include" }
          );
          if (!r.ok) return;
          for (const d of (await r.json()).data ?? []) if (d.imageUrl) map[d.targetId] = d.imageUrl;
        } catch {
          /* these stay blank */
        }
      })
    );
    return map;
  }

  // { id: { name, displayName } }, 100 ids per POST
  async function getNames(ids) {
    const byId = {};
    await Promise.all(
      chunk(ids, 100).map(async (c) => {
        try {
          const res = await CER.robloxWrite("https://users.roblox.com/v1/users", "POST", { userIds: c, excludeBannedUsers: false });
          if (!res?.ok) return;
          for (const u of (await res.json()).data ?? []) byId[u.id] = u;
        } catch {
          /* names stay as-is */
        }
      })
    );
    return byId;
  }

  // { id: presence }, 50 ids per POST
  async function getPresence(ids) {
    const map = {};
    await Promise.all(
      chunk(ids, 50).map(async (c) => {
        try {
          const res = await CER.robloxWrite("https://presence.roblox.com/v1/presence/users", "POST", { userIds: c });
          if (!res?.ok) return;
          for (const p of (await res.json()).userPresences ?? []) map[p.userId] = p;
        } catch {
          /* cards render without presence */
        }
      })
    );
    return map;
  }

  // a write that must really succeed before the card goes away. Returns true
  // on success; on failure toasts and re-enables the button.
  async function act(btn, url, failMsg) {
    btn.disabled = true;
    const res = await CER.robloxWrite(url, "POST", {}).catch(() => null);
    if (res?.ok) return true;
    btn.disabled = false;
    CER.toast(res?.status === 429 ? "Too fast! Wait a moment." : failMsg, "error");
    return false;
  }

  async function renderFriends() {
    const token = ++renderToken;
    body.textContent = "";
    body.appendChild(CER.skelGrid(8, 150, 150));
    let friends = [];
    try {
      const res = await fetch(`https://friends.roblox.com/v1/users/${me.id}/friends`, { credentials: "include" });
      if (!res.ok) throw new Error(res.status);
      friends = (await res.json()).data ?? [];
    } catch {
      if (token === renderToken) body.textContent = "Couldn't load friends.";
      return;
    }
    if (token !== renderToken) return;
    const ids = friends.map((f) => f.id);
    // the friends list now returns empty name/displayName, so backfill from
    // the users endpoint. Names, presence and heads all load at once.
    const [byId, presence, heads] = await Promise.all([getNames(ids), getPresence(ids), getHeads(ids)]);
    if (token !== renderToken) return;
    for (const f of friends) {
      if (byId[f.id]) {
        f.name = byId[f.id].name;
        f.displayName = byId[f.id].displayName;
      }
    }

    body.textContent = "";
    if (friends.length === 0) {
      body.appendChild(CER.el("p", "cer-hint", "No friends yet."));
      return;
    }
    // online first
    friends.sort((a, b) => (presence[b.id]?.userPresenceType ?? 0) - (presence[a.id]?.userPresenceType ?? 0));

    const grid = CER.el("div", "cer-friend-grid");
    for (const f of friends) {
      const p = presence[f.id];
      const [label, cls] = PRESENCE[p?.userPresenceType ?? 0] ?? PRESENCE[0];
      const card = CER.el("div", "cer-friend-card");
      const link = CER.el("a", "cer-friend-link");
      link.href = "https://www.roblox.com/users/" + f.id + "/profile";
      const img = CER.el("img", "cer-friend-avatar " + cls);
      img.src = heads[f.id] ?? "";
      link.appendChild(img);
      link.appendChild(CER.el("div", "cer-friend-name", f.displayName || f.name || "User " + f.id));
      const status = CER.el("div", "cer-friend-status " + cls, p?.userPresenceType === 2 && p?.lastLocation ? p.lastLocation : label);
      link.appendChild(status);
      card.appendChild(link);

      // same card layout as requests — Chat + Unfriend (matching roundedness)
      const row = CER.el("div", "cer-friend-actions");
      const chat = CER.el("button", "cer-friend-btn cer-friend-btn-primary", "Chat");
      chat.addEventListener("click", () => {
        if (CER.toggleChat) CER.toggleChat();
        else location.href = "https://www.roblox.com/my/messages";
      });
      const unfriend = CER.el("button", "cer-friend-btn cer-friend-btn-danger", "Unfriend");
      unfriend.addEventListener("click", async () => {
        if (!unfriend.dataset.arm) {
          unfriend.dataset.arm = "1";
          unfriend.textContent = "Sure?";
          setTimeout(() => {
            delete unfriend.dataset.arm;
            unfriend.textContent = "Unfriend";
          }, 3000);
          return;
        }
        if (await act(unfriend, `https://friends.roblox.com/v1/users/${f.id}/unfriend`, "Couldn't unfriend. Try again.")) card.remove();
      });
      row.appendChild(chat);
      row.appendChild(unfriend);
      card.appendChild(row);
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }

  async function renderRequests() {
    const token = ++renderToken;
    body.textContent = "";
    body.appendChild(CER.skelGrid(6, 150, 150));
    let requests = [];
    try {
      // the request inbox is /my/friends/requests, not /users/{id}/...
      const res = await fetch("https://friends.roblox.com/v1/my/friends/requests?limit=50&sortOrder=Desc", { credentials: "include" });
      if (!res.ok) throw new Error(res.status);
      requests = (await res.json()).data ?? [];
    } catch {
      if (token === renderToken) body.textContent = "Couldn't load requests.";
      return;
    }
    if (token !== renderToken) return;
    if (requests.length === 0) {
      body.textContent = "";
      body.appendChild(CER.el("p", "cer-hint", "No pending requests."));
      return;
    }

    // some request payloads omit name/displayName, so backfill those (in
    // parallel with the heads)
    const needNames = requests.filter((r) => !r.name && !r.displayName).map((r) => r.id);
    const [heads, byId] = await Promise.all([getHeads(requests.map((r) => r.id)), needNames.length ? getNames(needNames) : {}]);
    if (token !== renderToken) return;
    for (const r of requests) {
      if (byId[r.id]) {
        r.name = byId[r.id].name;
        r.displayName = byId[r.id].displayName;
      }
    }
    body.textContent = "";
    const grid = CER.el("div", "cer-friend-grid");
    for (const r of requests) {
      const card = CER.el("div", "cer-friend-card");
      const link = CER.el("a", "cer-friend-link");
      link.href = "https://www.roblox.com/users/" + r.id + "/profile";
      const img = CER.el("img", "cer-friend-avatar");
      img.src = heads[r.id] ?? "";
      link.appendChild(img);
      link.appendChild(CER.el("div", "cer-friend-name", r.displayName || r.name || "User " + r.id));
      card.appendChild(link);
      const row = CER.el("div", "cer-friend-actions");
      const accept = CER.el("button", "cer-friend-btn cer-friend-btn-primary", "Accept");
      accept.addEventListener("click", async () => {
        if (await act(accept, `https://friends.roblox.com/v1/users/${r.id}/accept-friend-request`, "Couldn't accept. Try again.")) card.remove();
      });
      const decline = CER.el("button", "cer-friend-btn cer-friend-btn-danger", "Decline");
      decline.addEventListener("click", async () => {
        if (await act(decline, `https://friends.roblox.com/v1/users/${r.id}/decline-friend-request`, "Couldn't decline. Try again.")) card.remove();
      });
      row.appendChild(accept);
      row.appendChild(decline);
      card.appendChild(row);
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }

  renderFriends();
  // the shell (title, tabs, skeleton grid) is up; cards fill in when loaded
  CER.skelDone?.("friends");
})();
