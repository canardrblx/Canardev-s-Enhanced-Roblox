// Profile header on the home page — replaces the "Home" title with a card
// modeled on Roblox's new profile page: centered full-body avatar preview,
// headshot, names, Edit Avatar / Edit Profile, and an Expand bar underneath.

let cerHomeCard = null;
let cerHomeObserver = null;
let cerHomeBusy = false; // sync in-flight guard: two overlapping runs used to insert two cards

const cerFindHomeTitle = () => [...document.querySelectorAll("h1")].find((h) => h.textContent.trim().toLowerCase() === "home");

async function cerInitProfileHeader() {
  if (typeof CER === "undefined") return;
  // Roblox reaches /home via client-side navigation too — this re-runs on
  // every URL change (CER.onNavigate below) and must be idempotent
  if (!location.pathname.startsWith("/home")) return;
  // CER's own home page (pages/home.js) owns /home now: stand down there
  if (CER.pageFor?.(location.pathname, location.search, (await CER.get()).features)?.tag === "home") return;
  if (document.querySelector(".cer-profile") || cerHomeBusy) return;
  cerHomeBusy = true;
  try {
    await cerBuildProfileHeader();
  } finally {
    cerHomeBusy = false;
  }
}

async function cerBuildProfileHeader() {
  const settings = await CER.get();
  if (!settings.features.profileHeader) return;

  // wait for the title and our user at the same time (CER.me() is shared and
  // usually already in flight), so the card lands as early as possible
  const [homeTitle, me] = await Promise.all([
    CER.waitFor(cerFindHomeTitle, 20000).catch(() => null),
    CER.me().catch(() => null),
  ]);
  if (!homeTitle || !me?.id) return;
  if (document.querySelector(".cer-profile")) return;
  // came back to /home client-side: re-attach the card we already built
  // instead of building (and fetching) a second one
  if (cerHomeCard) {
    homeTitle.parentElement.insertBefore(cerHomeCard, homeTitle);
    homeTitle.style.display = "none";
    return;
  }

  const card = CER.el("div", "cer-profile");
  cerHomeCard = card;
  homeTitle.parentElement.insertBefore(card, homeTitle);
  homeTitle.style.display = "none";

  // Roblox's home feed is React — it re-renders and wipes our injected card
  // (that's the "home doesn't fully load" bug). Re-attach the SAME node whenever
  // it gets detached, and re-hide whatever "Home" title reappears. Set up once.
  if (!cerHomeObserver) {
    cerHomeObserver = new MutationObserver(() => {
      if (!location.pathname.startsWith("/home") || !cerHomeCard) return;
      if (cerHomeCard.isConnected) return;
      const h1 = cerFindHomeTitle();
      if (h1) {
        h1.parentElement.insertBefore(cerHomeCard, h1);
        h1.style.display = "none";
      }
    });
    cerHomeObserver.observe(document.body, { childList: true, subtree: true });
  }

  // banner with the full-body avatar, centered like the profile page
  const banner = CER.el("div", "cer-profile-banner");
  const bodyImg = CER.el("img", "cer-profile-body");
  bodyImg.alt = me.displayName;
  banner.appendChild(bodyImg);
  card.appendChild(banner);

  // headshot + names + edit buttons
  const row = CER.el("div", "cer-profile-row");
  const head = CER.el("img", "cer-profile-head");
  head.alt = me.displayName;
  row.appendChild(head);

  const names = CER.el("div", "cer-profile-names");
  names.appendChild(CER.el("div", "cer-profile-display", me.displayName));
  names.appendChild(CER.el("div", "cer-profile-user", "@" + me.name));
  row.appendChild(names);

  const actions = CER.el("div", "cer-profile-actions");
  const editAvatar = CER.el("a", "cer-profile-btn", "Edit Avatar");
  editAvatar.href = "https://www.roblox.com/my/avatar";
  const editProfile = CER.el("a", "cer-profile-btn", "Edit Profile");
  editProfile.href = "https://www.roblox.com/users/" + me.id + "/profile";
  actions.appendChild(editAvatar);
  actions.appendChild(editProfile);
  row.appendChild(actions);
  card.appendChild(row);

  // details area + full-width expand bar under the whole card
  const details = CER.el("div", "cer-profile-details");
  details.hidden = true;
  card.appendChild(details);

  const expandBar = CER.el("button", "cer-profile-expandbar", "Expand ▾");
  if (!settings.features.profileExpandBtn) expandBar.style.display = "none";
  card.appendChild(expandBar);

  // thumbnails (fire and forget)
  fetch(
    `https://thumbnails.roblox.com/v1/users/avatar?userIds=${me.id}&size=720x720&format=Png&isCircular=false`,
    { credentials: "include" }
  )
    .then((r) => r.json())
    .then((d) => (bodyImg.src = d.data?.[0]?.imageUrl ?? ""))
    .catch(() => {});
  fetch(
    `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${me.id}&size=150x150&format=Png&isCircular=false`,
    { credentials: "include" }
  )
    .then((r) => r.json())
    .then((d) => (head.src = d.data?.[0]?.imageUrl ?? ""))
    .catch(() => {});

  // ---- expand/collapse, persisted across sessions ----

  // the details cost 5+ API calls, so they load on first expand (or on hover
  // of the bar, so the click still feels instant), not on every home visit
  let detailsP = null;
  const ensureDetails = () => (detailsP ??= loadDetails());

  async function setExpanded(expanded, persist) {
    if (expanded) ensureDetails();
    details.hidden = !expanded;
    expandBar.textContent = expanded ? "Collapse ▴" : "Expand ▾";
    if (persist) {
      const cur = await CER.get();
      await CER.set({ uiState: { ...cur.uiState, profileExpanded: expanded } });
    }
  }

  expandBar.addEventListener("click", () => setExpanded(details.hidden, true));
  expandBar.addEventListener("pointerenter", ensureDetails);
  expandBar.addEventListener("focus", ensureDetails);
  if (settings.uiState.profileExpanded) setExpanded(true, false);

  // ---- the expanded content ----

  async function loadDetails() {
    details.appendChild(CER.el("p", "cer-hint", "Loading…"));

    const j = (url) =>
      fetch(url, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    // place visits: page through the games list (50 per page, capped) so big
    // creators aren't undercounted; `more` = still cut off, shown as "+"
    const gamesP = (async () => {
      let visits = 0;
      let cursor = "";
      for (let i = 0; i < 4; i++) {
        const d = await j(`https://games.roblox.com/v2/users/${me.id}/games?limit=50&accessFilter=Public` + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
        if (!d) return i ? { visits, more: true } : null;
        for (const g of d.data ?? []) visits += g.placeVisits ?? 0;
        cursor = d.nextPageCursor;
        if (!cursor) return { visits, more: false };
      }
      return { visits, more: true };
    })();
    const [info, friends, followers, following, games] = await Promise.all([
      j(`https://users.roblox.com/v1/users/${me.id}`),
      j(`https://friends.roblox.com/v1/users/${me.id}/friends/count`),
      j(`https://friends.roblox.com/v1/users/${me.id}/followers/count`),
      j(`https://friends.roblox.com/v1/users/${me.id}/followings/count`),
      gamesP,
    ]);

    details.textContent = "";
    const chips = CER.el("div", "cer-profile-chips");
    const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : "—");

    chips.appendChild(chip(fmt(friends?.count) + " Friends"));
    chips.appendChild(chip(fmt(followers?.count) + " Followers"));
    chips.appendChild(chip(fmt(following?.count) + " Following"));

    chips.appendChild(chip(fmt(games?.visits) + (games?.more ? "+" : "") + " Place Visits"));

    if (info?.created) {
      const joined = new Date(info.created).toLocaleDateString(undefined, { month: "short", year: "numeric" });
      chips.appendChild(chip("Joined " + joined));
    }
    details.appendChild(chips);

    // bio line: pencil FIRST, then the text (or "No bio yet")
    const bioRow = CER.el("div", "cer-profile-biorow");
    const editBtn = CER.el("button", "cer-profile-bioedit", "✎");
    editBtn.title = "Edit bio";
    const bio = CER.el("p", "cer-profile-desc");
    const bioText = info?.description?.trim() ?? "";

    function setBioText(text) {
      bio.textContent = text || "No bio yet";
      bio.classList.toggle("cer-profile-desc-empty", !text);
    }
    setBioText(bioText);
    bio.setBioText = setBioText;

    editBtn.addEventListener("click", () => startBioEdit(bioRow, bio, editBtn));
    bioRow.appendChild(editBtn);
    bioRow.appendChild(bio);
    details.appendChild(bioRow);

    function chip(text) {
      return CER.el("span", "cer-profile-chip", text);
    }
  }

  // inline bio editor — saves through Roblox's own description endpoint
  function startBioEdit(bioRow, bio, editBtn) {
    if (bioRow.querySelector("textarea")) return;
    const original = bio.classList.contains("cer-profile-desc-empty") ? "" : bio.textContent;

    const editor = CER.el("div", "cer-profile-bioeditor");
    const area = CER.el("textarea", "cer-profile-bioarea");
    area.value = original;
    area.maxLength = 1000;
    editor.appendChild(area);

    const save = CER.el("button", "cer-join-menu-action", "Save");
    const cancel = CER.el("button", "cer-profile-btn", "Cancel");
    editor.appendChild(save);
    editor.appendChild(cancel);

    bio.hidden = true;
    editBtn.hidden = true;
    bioRow.appendChild(editor);

    cancel.addEventListener("click", () => {
      editor.remove();
      bio.hidden = false;
      editBtn.hidden = false;
    });

    save.addEventListener("click", async () => {
      save.disabled = true;
      save.textContent = "Saving…";
      const text = area.value.trim();
      // account-information is the endpoint the settings page uses; fall back
      // to the users API variant if it ever 404s
      let res = await CER.robloxWrite("https://accountinformation.roblox.com/v1/description", "POST", { description: text }).catch(() => null);
      if (!res || res.status === 404) {
        res = await CER.robloxWrite("https://users.roblox.com/v1/description", "POST", { description: text }).catch(() => null);
      }
      if (res?.ok) {
        bio.setBioText(text);
        editor.remove();
        bio.hidden = false;
        editBtn.hidden = false;
      } else {
        save.disabled = false;
        save.textContent = "Couldn't save — retry";
      }
    });
  }
}

cerInitProfileHeader();
if (typeof CER !== "undefined") CER.onNavigate(cerInitProfileHeader);
