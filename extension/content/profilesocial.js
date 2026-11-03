// Profile enhancements on /users/{id}/profile:
//  - private local Player Notes
//  - Mutual friends
//  - Last online + Friendship duration (from friend since / presence)
//  - Copy user ID
// All rendered as a themed card slotted under the profile header.

(async function () {
  if (typeof CER === "undefined") return;
  // retired where CER owns the page: pages/profile.js has notes, mutual
  // friends and the right friends links built in. This runs only on Roblox's
  // own profile (feature off or ?cer=native).
  if ((await CER.takeover) === "profile") return;
  const userId = location.pathname.match(/\/users\/(\d+)\/profile/)?.[1];
  if (!userId) return;

  let me = null;
  try {
    me = await CER.me();
  } catch {
    /* not logged in — notes still work */
  }
  const isSelf = String(me?.id) === userId;

  // The modern profile's "N Friends" control is a React <a> with no href, and
  // its router can land on the WRONG friends list (yours instead of theirs).
  // Force it at THIS profile's friends page, which natively shows the right
  // person's friends. (Your own goes to /users/friends so our redesign runs.)
  (function fixFriendsLink() {
    const target = isSelf
      ? "https://www.roblox.com/users/friends"
      : "https://www.roblox.com/users/" + userId + "/friends";
    const patch = () => {
      for (const a of document.querySelectorAll("a:not([data-cer-friends])")) {
        if (!/^\d[\d,]*\s*friends?$/i.test(a.textContent.trim())) continue;
        a.dataset.cerFriends = "1";
        a.href = target;
        a.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            location.href = target;
          },
          true // capture phase, so we beat React's own click handler
        );
      }
    };
    patch();
    let t = null;
    const obs = new MutationObserver(() => {
      if (!CER.alive?.()) return obs.disconnect();
      // throttle, not debounce: a page that never stops mutating can't
      // starve the patch forever
      if (t) return;
      t = setTimeout(() => {
        t = null;
        patch();
      }, 300);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // Roblox can leave the profile client-side: stop watching once we're gone
    CER.onNavigate(() => {
      if (!location.pathname.includes(`/users/${userId}/profile`)) {
        obs.disconnect();
        clearTimeout(t);
      }
    });
  })();

  // anchor under the names block (the profile header)
  const anchor = await CER.waitFor(
    () => [...document.querySelectorAll("h1, [class*='profile-name'], [class*='profile-display']")].find((h) => h.offsetParent),
    20000
  ).catch(() => null);
  if (!anchor || document.querySelector(".cer-psocial")) return;

  const card = CER.el("div", "cer-psocial");

  // --- chips row: copy id, last online, friendship ---
  const chips = CER.el("div", "cer-psocial-chips");

  const idChip = CER.el("button", "cer-psocial-chip", "Copy ID: " + userId);
  idChip.addEventListener("click", () => {
    navigator.clipboard?.writeText(userId).catch(() => {});
    idChip.textContent = "Copied!";
    setTimeout(() => (idChip.textContent = "Copy ID: " + userId), 1400);
  });
  chips.appendChild(idChip);
  card.appendChild(chips);

  const j = (url, method, body) =>
    method
      ? CER.bgFetch(url, method, body).then((r) => r.data)
      : fetch(url, { credentials: "include" }).then((r) => r.json()).catch(() => null);

  // presence → last online (best effort; Roblox has trimmed this field)
  if (!isSelf) {
    j("https://presence.roblox.com/v1/presence/users", "POST", { userIds: [Number(userId)] }).then((p) => {
      const pr = p?.userPresences?.[0];
      if (!pr) return;
      const TYPES = { 0: "Offline", 1: "Online", 2: "In game", 3: "In Studio" };
      let text = TYPES[pr.userPresenceType] ?? "";
      if (pr.userPresenceType === 0 && pr.lastOnline) {
        text = "Last online " + new Date(pr.lastOnline).toLocaleDateString();
      }
      if (text) chips.appendChild(CER.el("span", "cer-psocial-chip cer-psocial-stat", text));
    });

    // MY friends list: fetched once per page and shared by the friendship
    // chip and the mutual friends row (it used to be fetched twice, plus a
    // statuses call whose result was thrown away)
    const myFriendsP = me ? j(`https://friends.roblox.com/v1/users/${me.id}/friends`) : Promise.resolve(null);

    // friendship duration: no reliable public "friends since", so approximate
    // via our own first-seen record (honest rather than fabricated)
    myFriendsP.then(async (mine) => {
      const list = mine?.data;
      if (!Array.isArray(list)) return; // lookup failed: don't touch the record
      const KEY = "friendSince";
      let since = {};
      try {
        ({ [KEY]: since = {} } = await CER.ext.storage.local.get(KEY));
      } catch {
        return; // context invalidated
      }
      // keep only current friends: bounds the map to the friend list, and an
      // unfriend + re-friend starts counting again instead of the old date
      const ids = new Set(list.map((f) => String(f.id)));
      let changed = false;
      for (const k of Object.keys(since)) {
        if (!ids.has(k)) {
          delete since[k];
          changed = true;
        }
      }
      const areFriends = ids.has(userId);
      if (areFriends && !since[userId]) {
        since[userId] = Date.now();
        changed = true;
      }
      if (changed) await CER.set({ [KEY]: since });
      if (!areFriends) return;
      const days = Math.floor((Date.now() - since[userId]) / 8.64e7);
      chips.appendChild(
        CER.el("span", "cer-psocial-chip cer-psocial-stat", days === 0 ? "Friends (tracked from today)" : `Friendship: ${days} day${days === 1 ? "" : "s"}`)
      );
    });

    // mutual friends
    if (me) {
      Promise.all([myFriendsP, j(`https://friends.roblox.com/v1/users/${userId}/friends`)]).then(([mine, theirs]) => {
        const mineIds = new Set((mine?.data ?? []).map((f) => f.id));
        const mutuals = (theirs?.data ?? []).filter((f) => mineIds.has(f.id));
        if (mutuals.length === 0) return;
        const section = CER.el("div", "cer-psocial-mutuals");
        section.appendChild(CER.el("h3", "cer-h3", `${mutuals.length} Mutual Friend${mutuals.length === 1 ? "" : "s"}`));
        const row = CER.el("div", "cer-bf-row");
        // build the tiles (with names) up front and show the section right away,
        // then fill in avatars when the thumbnail call returns — otherwise an
        // empty row flashes in before the images load
        const imgById = {};
        const nameById = {};
        for (const m of mutuals.slice(0, 20)) {
          const tile = CER.el("a", "cer-bf-tile");
          tile.href = "https://www.roblox.com/users/" + m.id + "/profile";
          const img = CER.el("img", "cer-bf-avatar");
          imgById[m.id] = img;
          tile.appendChild(img);
          nameById[m.id] = tile.appendChild(CER.el("span", "cer-bf-name", m.displayName || m.name || ""));
          row.appendChild(tile);
        }
        section.appendChild(row);
        card.appendChild(section);
        // the friends list now comes back with blank names: backfill them
        const shown = mutuals.slice(0, 20).map((m) => m.id);
        j("https://users.roblox.com/v1/users", "POST", { userIds: shown, excludeBannedUsers: false }).then((d) => {
          for (const u of d?.data ?? []) if (nameById[u.id]) nameById[u.id].textContent = u.displayName || u.name || "";
        });
        fetch(
          "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + mutuals.slice(0, 20).map((m) => m.id).join(",") + "&size=150x150&format=Png&isCircular=true",
          { credentials: "include" }
        )
          .then((r) => r.json())
          .then((d) => {
            for (const it of d.data ?? []) if (imgById[it.targetId]) imgById[it.targetId].src = it.imageUrl;
          })
          .catch(() => {});
      });
    }
  }

  // --- player notes (local, private) ---
  const notesWrap = CER.el("div", "cer-psocial-notes");
  notesWrap.appendChild(CER.el("h3", "cer-h3", "Private note (only you see this)"));
  const area = CER.el("textarea", "cer-psocial-note");
  area.placeholder = "Add a note about this user…";
  area.maxLength = 2000; // notes are never pruned, so keep each one small
  let playerNotes = {};
  try {
    ({ playerNotes = {} } = await CER.ext.storage.local.get("playerNotes"));
  } catch {
    /* context invalidated: start blank, the card still mounts */
  }
  area.value = playerNotes[userId] ?? "";
  let saveTimer = null;
  area.addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      let cur = {};
      try {
        ({ playerNotes: cur = {} } = await CER.ext.storage.local.get("playerNotes"));
      } catch {
        return; // context invalidated
      }
      if (area.value.trim()) cur[userId] = area.value.trim();
      else delete cur[userId];
      await CER.set({ playerNotes: cur });
    }, 500);
  });
  notesWrap.appendChild(area);
  card.appendChild(notesWrap);

  anchor.closest("div")?.insertAdjacentElement("afterend", card) ?? anchor.insertAdjacentElement("afterend", card);
})();
