// CER Avatar Editor — replaces the avatar page interface.
//
// How it stays in sync (the old version glitched on all of these):
//  - `want` is what the user asked for; `server` is the last state Roblox
//    confirmed. Clicks only touch `want`, then ONE debounced write sends it,
//    so spam-clicking is a single request instead of a pile of racing ones.
//  - A failed or rate-limited read never replaces state. (It used to: an
//    error body turned into "wearing nothing", and the next click stripped
//    the whole avatar.)
//  - Every tile and chip is painted from `want` by paint(), so highlights can
//    never drift from what is actually worn.
//  - Our UI is a sibling of Roblox's React root, never inside it, so a React
//    re-render can't wipe it.

(async function () {
  if (typeof CER === "undefined") return;
  const settings = await CER.get();
  if (!settings.features.avatarEditor) return;

  const API = "https://avatar.roblox.com";
  const ANIM_TYPES = [48, 49, 50, 51, 52, 53, 54, 55, 56];
  // not shown as removable chips: animations, emotes, body parts that would
  // leave a broken avatar if removed one by one
  const HIDDEN_CHIP_TYPES = new Set([...ANIM_TYPES, 24, 27, 28, 29, 30, 31, 61]);

  const CATEGORIES = [
    { label: "Characters", characters: true },
    {
      label: "Accessories",
      sub: [
        ["Hats", 8],
        ["Hair", 41],
        ["Face", 42],
        ["Neck", 43],
        ["Shoulder", 44],
        ["Front", 45],
        ["Back", 46],
        ["Waist", 47],
      ],
    },
    {
      label: "Shirts",
      sub: [
        ["Classic", 11],
        ["Layered", 65],
        ["Jackets", 67],
        ["Sweaters", 68],
      ],
    },
    {
      label: "Pants",
      sub: [
        ["Classic", 12],
        ["Layered", 66],
        ["Shorts", 69],
        ["Skirts", 72],
      ],
    },
    {
      label: "T-Shirts",
      sub: [
        ["Classic", 2],
        ["Layered", 64],
      ],
    },
    { label: "Shoes", type: [70, 71] },
    { label: "Faces", type: 18 },
    { label: "Animations", animations: true },
    { label: "Body", scale: true },
  ];

  const getJSON = async (url) => {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  };

  const host = await CER.waitFor(() => document.querySelector("#avatar-web-app"), 12000).catch(() => null);
  if (!host) {
    CER.dismissSkeleton?.();
    return;
  }

  // ---- shell: built synchronously so the page is usable at once ----
  // Skin: CER design system (ui.js / ui.css tokens, pages/avatar.css). The
  // `ui` helpers only build markup; editor behavior is unchanged without them.
  const ui = CER.ui;
  const skel = () => (ui ? ui.skeleton("tile", 12) : CER.skelGrid(12, 130, 110));
  // sub-category picker: chips when the design system is loaded
  const subPicker = (options, initial, onChange) =>
    ui ? ui.chips(options.map(([id, label]) => ({ id, label })), initial, onChange) : CER.dropdown(options, initial, onChange);

  const root = CER.el("div", "cer-avatar-inline cer-ui");
  const classic = ui ? ui.button("Use classic editor", { variant: "outline", size: "sm" }) : CER.el("button", "cer-profile-btn", "Use classic editor");
  let head;
  if (ui) head = ui.header({ title: "Avatar", icon: "shirt", sub: "Tap an item to put it on or take it off.", actions: [classic] });
  else {
    head = CER.el("div", "cer-avatar-head");
    head.appendChild(CER.el("h1", "cer-avatar-title", "Avatar Editor"));
    head.appendChild(classic);
  }
  root.appendChild(head);

  const body = CER.el("div", "cer-avatar-body");
  root.appendChild(body);

  const side = CER.el("div", "cer-avatar-side");
  const preview = CER.el("div", "cer-avatar-preview");
  const img = CER.el("img", "cer-avatar-preview-img");
  img.alt = "";
  preview.appendChild(img);
  const spinner = CER.el("div", "cer-avatar-spinner");
  preview.appendChild(spinner);
  const refreshBtn = CER.el("button", "cer-avatar-refresh");
  refreshBtn.appendChild(ui ? ui.icon("refresh", 17) : CER.svg("refresh", 16));
  refreshBtn.title = "Redraw preview";
  preview.appendChild(refreshBtn);
  side.appendChild(preview);
  const wearingWrap = CER.el("div", "cer-avatar-wearing");
  wearingWrap.appendChild(CER.el("h3", "cer-h3", "Wearing"));
  const strip = CER.el("div", "cer-avatar-strip");
  wearingWrap.appendChild(strip);
  side.appendChild(wearingWrap);
  body.appendChild(side);

  const main = CER.el("div", "cer-avatar-main");
  const tabs = CER.el("div", "cer-avatar-tabs");
  const subRow = CER.el("div", "cer-avatar-subrow");
  const grid = CER.el("div", "cer-avatar-grid");
  main.append(tabs, subRow, grid);
  body.appendChild(main);

  // mount BESIDE Roblox's app and hide it whole (inline style, so a React
  // re-render inside it can't undo it). Roblox's #content is a fixed 1238px
  // column; widen it so the editor fits any window, and undo that on exit.
  let active = true;
  const content = host.closest(".content, #content");
  const saved = { hostDisplay: host.style.display, cw: content?.style.width ?? "", cmw: content?.style.maxWidth ?? "" };
  host.style.display = "none";
  host.insertAdjacentElement("beforebegin", root);
  if (content) content.style.width = content.style.maxWidth = "100%";
  new MutationObserver(() => {
    if (!active) return;
    if (host.style.display !== "none") host.style.display = "none";
    if (!root.isConnected && host.isConnected) host.insertAdjacentElement("beforebegin", root);
  }).observe(host.parentElement, { childList: true, attributes: true, subtree: false, attributeFilter: ["style"] });
  classic.addEventListener("click", () => {
    active = false;
    root.remove();
    host.style.display = saved.hostDisplay;
    if (content) {
      content.style.width = saved.cw;
      content.style.maxWidth = saved.cmw;
    }
  });

  // tabs exist now; contents load below
  let activeBtn = null;
  const tabBtns = [];
  for (const cat of CATEGORIES) {
    const b = CER.el("button", "cer-tab", cat.label);
    b.addEventListener("click", () => {
      if (activeBtn === b) return;
      activeBtn?.classList.remove("cer-tab-active");
      activeBtn = b;
      b.classList.add("cer-tab-active");
      openTab(cat);
    });
    tabs.appendChild(b);
    tabBtns.push(b);
  }
  activeBtn = tabBtns[0];
  activeBtn.classList.add("cer-tab-active");
  grid.append(...[skel()].flat());
  CER.skelDone?.("avatar");

  const me = await CER.me();
  if (!me) {
    grid.textContent = "";
    grid.appendChild(CER.el("p", "cer-hint", "Log in to edit your avatar."));
    return;
  }
  img.alt = me.displayName || me.name;

  // ---- worn state ----

  let server = new Map(); // assetId -> { id, name, assetType, meta }
  let want = new Map();
  let avatarCache = null; // last good GET v1/avatar

  async function readAvatar() {
    const av = await getJSON(API + "/v1/avatar");
    if (!Array.isArray(av.assets)) throw new Error("bad avatar body");
    avatarCache = av;
    return av;
  }
  const toMap = (assets) => new Map(assets.map((a) => [a.id, a]));

  // paint every tile and chip from `want`
  function paint() {
    for (const t of grid.querySelectorAll(".cer-avatar-item[data-asset-id]")) {
      const id = Number(t.dataset.assetId);
      const on = t.dataset.kind === "emote" ? emotes.has(id) : want.has(id);
      t.classList.toggle("cer-avatar-item-worn", on);
    }
    renderStrip();
  }

  let syncTimer = null;
  let syncing = false;
  let dirty = false;
  // debounce: a burst of clicks becomes one write
  function scheduleSync() {
    dirty = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, 450);
  }
  async function runSync() {
    if (syncing) return; // the running sync loops until clean
    syncing = true;
    try {
      while (dirty) {
        dirty = false;
        const sent = new Map(want);
        const assets = [...sent.values()].map((a) => (a.meta ? { id: a.id, meta: a.meta } : { id: a.id }));
        let res = null;
        try {
          res = await CER.robloxWrite(API + "/v2/avatar/set-wearing-assets", "POST", { assets });
        } catch {
          /* network error: handled as a failure below */
        }
        let body = null;
        try {
          body = res ? await res.json() : null;
        } catch {}
        const okWrite = !!res?.ok && body?.success !== false;
        if (!okWrite) {
          // roll back to what Roblox has, unless more clicks already queued
          if (!dirty) want = new Map(server);
          paint();
          CER.toast(res?.status === 429 ? "Too fast! Wait a moment." : "Couldn't save that change.", "error");
          continue;
        }
        const bad = body?.invalidAssetIds ?? [];
        if (bad.length) {
          for (const id of bad) want.delete(id);
          CER.toast("Some items can't be worn together.", "error");
        }
        // pull real meta + asset types for what we sent; keep any clicks that
        // landed while the write was in flight
        try {
          const av = await readAvatar();
          server = toMap(av.assets);
          if (!dirty) want = new Map(server);
          else for (const [id, a] of server) if (want.has(id)) want.set(id, a);
        } catch {
          server = new Map([...sent].filter(([id]) => !bad.includes(id)));
        }
        paint();
        redraw();
      }
    } finally {
      syncing = false;
    }
  }

  function toggleAsset(item) {
    if (want.has(item.id)) want.delete(item.id);
    else want.set(item.id, item);
    paint();
    scheduleSync();
  }

  // ---- emotes (own slot API; set-wearing-assets ignores them) ----

  let emotes = new Map(); // assetId -> slot 1..8
  async function refreshEmotes() {
    try {
      const list = await getJSON(API + "/v1/emotes");
      if (Array.isArray(list)) emotes = new Map(list.map((e) => [e.assetId, e.position]));
    } catch {
      /* keep old state */
    }
  }
  let emoteQ = Promise.resolve();
  function toggleEmote(assetId, name) {
    emoteQ = emoteQ
      .then(async () => {
        if (emotes.has(assetId)) {
          const r = await CER.robloxWrite(`${API}/v1/emotes/${assetId}`, "DELETE");
          if (!r?.ok) throw 0;
          emotes.delete(assetId);
          return;
        }
        const used = new Set(emotes.values());
        let slot = 0;
        for (let p = 1; p <= 8 && !slot; p++) if (!used.has(p)) slot = p;
        if (!slot) {
          // all 8 full: free the lowest slot
          const [firstId, firstPos] = [...emotes].sort((a, b) => a[1] - b[1])[0];
          const d = await CER.robloxWrite(`${API}/v1/emotes/${firstId}`, "DELETE");
          if (!d?.ok) throw 0;
          emotes.delete(firstId);
          slot = firstPos;
        }
        const r = await CER.robloxWrite(`${API}/v1/emotes/${assetId}/${slot}`, "POST", {});
        if (!r?.ok) throw 0;
        emotes.set(assetId, slot);
      })
      .catch(() => CER.toast("Couldn't update " + name, "error"))
      .finally(paint);
  }

  // ---- preview ----
  // Roblox regenerates the render under a NEW url once a redraw finishes, so
  // polling the thumbnail API until the url changes is the "done" signal.

  let lastUrl = "";
  let pollToken = 0;
  let lastRedraw = 0;
  async function fetchPreview() {
    try {
      const d = (await getJSON(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${me.id}&size=720x720&format=Png&isCircular=false`)).data?.[0];
      if (d?.state === "Completed" && d.imageUrl) {
        if (d.imageUrl === lastUrl) return false;
        lastUrl = d.imageUrl;
        img.src = d.imageUrl;
        return true;
      }
    } catch {}
    return false;
  }
  function pollPreview() {
    const token = ++pollToken;
    preview.classList.add("cer-avatar-preview-busy");
    let tries = 0;
    const tick = async () => {
      if (token !== pollToken) return;
      const changed = await fetchPreview();
      if (token !== pollToken) return;
      if (changed || ++tries >= 16) {
        preview.classList.remove("cer-avatar-preview-busy");
        return;
      }
      setTimeout(tick, tries < 5 ? 700 : 1400);
    };
    setTimeout(tick, 500);
  }
  function redraw(force) {
    // Roblox rate-limits redraws hard; one per 2 s is plenty
    const now = Date.now();
    if (force || now - lastRedraw > 2000) {
      lastRedraw = now;
      CER.robloxWrite(API + "/v1/avatar/redraw-thumbnail", "POST", {}).catch(() => {});
    }
    pollPreview();
  }
  refreshBtn.addEventListener("click", () => redraw(true));
  img.addEventListener("load", () => preview.classList.add("cer-avatar-preview-ready"));

  // ---- asset thumbnails (cached, batched to the API's 100-id limit) ----

  const thumbCache = {};
  async function assetThumbs(ids) {
    const missing = [...new Set(ids.filter((id) => !(id in thumbCache)))];
    for (let i = 0; i < missing.length; i += 100) {
      try {
        const d = await getJSON(`https://thumbnails.roblox.com/v1/assets?assetIds=${missing.slice(i, i + 100).join(",")}&size=150x150&format=Png`);
        for (const t of d.data ?? []) if (t.imageUrl) thumbCache[t.targetId] = t.imageUrl;
      } catch {
        /* tiles render without images */
      }
    }
    return thumbCache;
  }

  // ---- wearing strip ----

  let stripSeq = 0;
  async function renderStrip() {
    const seq = ++stripSeq;
    const items = [...want.values()].filter((a) => !a.assetType || !HIDDEN_CHIP_TYPES.has(a.assetType.id));
    const thumbs = await assetThumbs(items.map((a) => a.id));
    if (seq !== stripSeq) return; // a newer render won
    const frag = document.createDocumentFragment();
    for (const a of items) {
      const chip = CER.el("button", "cer-avatar-wornchip");
      const t = CER.el("img");
      t.src = thumbs[a.id] ?? "";
      t.alt = "";
      chip.appendChild(t);
      chip.appendChild(CER.el("span", "", a.name ?? String(a.id)));
      chip.title = "Take off";
      chip.addEventListener("click", () => toggleAsset(a));
      frag.appendChild(chip);
    }
    if (!items.length) frag.appendChild(CER.el("p", "cer-hint", "Nothing on yet."));
    strip.replaceChildren(frag);
  }

  // ---- grid ----

  let loadSeq = 0; // a newer view cancels older loads
  function startView() {
    const seq = ++loadSeq;
    grid.replaceChildren(...[skel()].flat());
    return seq;
  }
  const stale = (seq) => seq !== loadSeq;
  function showMsg(text) {
    grid.replaceChildren(ui ? ui.empty(text, { icon: "shirt" }) : CER.el("p", "cer-hint", text));
  }

  function tile(name, thumb) {
    // a div, not a <button>: outfit tiles hold their own buttons, and nested
    // buttons swallow clicks in Firefox
    const t = CER.el("div", "cer-avatar-item");
    t.tabIndex = 0;
    t.setAttribute("role", "button");
    const im = CER.el("img");
    im.src = thumb ?? "";
    im.alt = "";
    im.loading = "lazy";
    t.appendChild(im);
    const label = CER.el("span", "", name);
    label.title = name;
    t.appendChild(label);
    t.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        t.click();
      }
    });
    return t;
  }

  function itemTile(item, isEmote) {
    const name = item.assetName ?? item.name ?? String(item.assetId);
    const t = tile(name, thumbCache[item.assetId]);
    t.dataset.assetId = item.assetId;
    if (isEmote) {
      t.dataset.kind = "emote";
      t.addEventListener("click", () => {
        t.classList.toggle("cer-avatar-item-worn");
        toggleEmote(item.assetId, name);
      });
    } else {
      t.addEventListener("click", () =>
        toggleAsset(want.get(item.assetId) ?? { id: item.assetId, name, assetType: { id: item.assetType ?? item.assetTypeId } })
      );
    }
    return t;
  }

  // inventory for one or more asset types, each with its own paging cursor
  async function loadCategory(typeIds, isEmote) {
    const seq = startView();
    typeIds = Array.isArray(typeIds) ? typeIds : [typeIds];
    const cursors = new Map(typeIds.map((t) => [t, ""]));
    if (isEmote) await refreshEmotes();
    let first = true;
    async function page() {
      const items = [];
      for (const [t, c] of [...cursors]) {
        const d = await getJSON(
          `https://inventory.roblox.com/v2/users/${me.id}/inventory/${t}?limit=100&sortOrder=Desc` + (c ? "&cursor=" + encodeURIComponent(c) : "")
        );
        for (const it of d.data ?? []) items.push({ ...it, assetType: it.assetType ?? t });
        if (d.nextPageCursor) cursors.set(t, d.nextPageCursor);
        else cursors.delete(t);
      }
      await assetThumbs(items.map((i) => i.assetId));
      if (stale(seq)) return;
      if (first) {
        grid.textContent = "";
        first = false;
        if (!items.length) return showMsg("You don't own anything here yet.");
      }
      grid.querySelector(".cer-avatar-more")?.remove();
      const frag = document.createDocumentFragment();
      for (const it of items) frag.appendChild(itemTile(it, isEmote));
      grid.appendChild(frag);
      paint();
      if (cursors.size) {
        const more = CER.el("button", ui ? "cer-btn cer-btn-soft cer-avatar-more" : "cer-profile-btn cer-avatar-more", "Load more");
        more.addEventListener("click", () => {
          more.disabled = true;
          more.textContent = "Loading…";
          page().catch(() => {
            more.disabled = false;
            more.textContent = "Load more";
          });
        });
        grid.appendChild(more);
      }
    }
    try {
      await page();
    } catch {
      if (!stale(seq)) showMsg("Couldn't load items. Try again.");
    }
  }

  // owned bundles of one kind, all pages. The typed endpoint filters on the
  // server (the untyped one is heavily rate-limited: 429 on first call, live
  // 2026-11-03).
  async function ownedBundles(kind) {
    const out = [];
    let cursor = "";
    for (let i = 0; i < 10; i++) {
      const d = await getJSON(
        `https://catalog.roblox.com/v1/users/${me.id}/bundles/${kind}?limit=100&sortOrder=Desc` + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "")
      );
      for (const b of d.data ?? []) out.push(b);
      cursor = d.nextPageCursor;
      if (!cursor) break;
    }
    return out;
  }

  async function wearBundle(bundle, kind) {
    const toast = CER.toast("Putting on " + bundle.name + "…");
    try {
      const details = await getJSON(`https://catalog.roblox.com/v1/bundles/${bundle.id}/details`);
      const items = details.items ?? [];
      const outfit = items.find((i) => i.type === "UserOutfit");
      if (kind === "BodyParts" && outfit) {
        const r = await CER.robloxWrite(`${API}/v1/outfits/${outfit.id}/wear`, "POST", {});
        if (!r?.ok) throw 0;
        const av = await readAvatar();
        server = toMap(av.assets);
        want = new Map(server);
        paint();
        redraw();
      } else {
        // animation packs: swap out the current animations for the pack's
        for (const [id, a] of want) if (a.assetType && ANIM_TYPES.includes(a.assetType.id)) want.delete(id);
        for (const i of items) if (i.type === "Asset") want.set(i.id, { id: i.id, name: i.name });
        paint();
        scheduleSync();
      }
      toast.textContent = "Wearing " + bundle.name;
    } catch {
      toast.textContent = "Couldn't put on " + bundle.name;
      toast.classList.add("cer-toast-error");
    }
  }

  async function loadBundles(kind) {
    const seq = startView();
    try {
      const bundles = await ownedBundles(kind);
      if (stale(seq)) return;
      if (!bundles.length) return showMsg(kind === "BodyParts" ? "You don't own any characters yet." : "You don't own any animation packs yet.");
      const thumbs = {};
      for (let i = 0; i < bundles.length; i += 100) {
        try {
          const d = await getJSON(
            `https://thumbnails.roblox.com/v1/bundles/thumbnails?bundleIds=${bundles.slice(i, i + 100).map((b) => b.id).join(",")}&size=150x150&format=Png`
          );
          for (const t of d.data ?? []) thumbs[t.targetId] = t.imageUrl;
        } catch {}
      }
      if (stale(seq)) return;
      const frag = document.createDocumentFragment();
      for (const b of bundles) {
        const t = tile(b.name, thumbs[b.id]);
        t.addEventListener("click", () => wearBundle(b, kind));
        frag.appendChild(t);
      }
      grid.replaceChildren(frag);
    } catch {
      if (!stale(seq)) showMsg("Couldn't load these. Try again.");
    }
  }

  // small yes/no popover anchored to a button
  function confirmMenu(anchor, message, onYes) {
    document.querySelector(".cer-confirm-pop")?.remove();
    const pop = CER.el("div", "cer-confirm-pop cer-ui");
    pop.appendChild(CER.el("div", "cer-confirm-msg", message));
    const row = CER.el("div", "cer-confirm-row");
    const yes = CER.el("button", ui ? "cer-btn cer-btn-primary cer-btn-sm" : "cer-join-menu-action", "Yes");
    const no = CER.el("button", ui ? "cer-btn cer-btn-soft cer-btn-sm" : "cer-profile-btn", "Cancel");
    row.append(yes, no);
    pop.appendChild(row);
    const close = () => {
      pop.remove();
      document.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
    pop.addEventListener("click", (e) => e.stopPropagation());
    no.addEventListener("click", close);
    yes.addEventListener("click", () => {
      close();
      onYes();
    });
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 248)) + "px";
    pop.style.top = r.bottom + 6 + "px";
    document.body.appendChild(pop);
    setTimeout(() => {
      document.addEventListener("click", close);
      window.addEventListener("scroll", close, true);
    }, 0);
  }

  const outfitPayload = (name, av) => ({
    name,
    bodyColors: av.bodyColors,
    assetIds: av.assets.map((a) => a.id),
    scale: av.scales,
    playerAvatarType: av.playerAvatarType,
  });

  async function loadOutfits() {
    const seq = startView();
    const create = ui
      ? ui.button("Save this look", { variant: "primary", icon: "plus", class: "cer-avatar-create" })
      : CER.el("button", "cer-join-menu-action cer-avatar-create", "＋ Save this look");
    create.addEventListener("click", async () => {
      const name = prompt("Name your character:", "My Character");
      if (!name) return;
      create.disabled = true;
      try {
        const r = await CER.robloxWrite(API + "/v1/outfits/create", "POST", outfitPayload(name.slice(0, 25), await readAvatar()));
        if (r?.ok) {
          CER.toast("Saved " + name, "success");
          loadOutfits();
        } else CER.toast("Couldn't save. Try again.", "error");
      } catch {
        CER.toast("Couldn't save. Try again.", "error");
      } finally {
        create.disabled = false;
      }
    });
    try {
      const outfits = [];
      for (let p = 1; p <= 6; p++) {
        const d = await getJSON(`${API}/v1/users/${me.id}/outfits?page=${p}&itemsPerPage=50&isEditable=true`);
        outfits.push(...(d.data ?? []));
        if ((d.data ?? []).length < 50) break;
      }
      const thumbs = {};
      for (let i = 0; i < outfits.length; i += 100) {
        try {
          const d = await getJSON(
            `https://thumbnails.roblox.com/v1/users/outfits?userOutfitIds=${outfits.slice(i, i + 100).map((o) => o.id).join(",")}&size=150x150&format=Png`
          );
          for (const t of d.data ?? []) thumbs[t.targetId] = t.imageUrl;
        } catch {}
      }
      if (stale(seq)) return;
      const frag = document.createDocumentFragment();
      frag.appendChild(create);
      if (!outfits.length) frag.appendChild(ui ? ui.empty("No saved characters yet.", { icon: "user" }) : CER.el("p", "cer-hint", "No saved characters yet."));
      for (const o of outfits) {
        const t = tile(o.name, thumbs[o.id]);
        t.addEventListener("click", async () => {
          const toast = CER.toast("Putting on " + o.name + "…");
          try {
            const r = await CER.robloxWrite(`${API}/v1/outfits/${o.id}/wear`, "POST", {});
            if (!r?.ok) throw 0;
            const av = await readAvatar();
            server = toMap(av.assets);
            want = new Map(server);
            paint();
            redraw();
            toast.textContent = "Wearing " + o.name;
          } catch {
            toast.textContent = "Couldn't put on " + o.name;
            toast.classList.add("cer-toast-error");
          }
        });
        const controls = CER.el("div", "cer-outfit-controls");
        const upd = CER.el("button", "cer-outfit-btn");
        upd.appendChild(ui ? ui.icon("refresh", 15) : CER.svg("refresh", 16));
        upd.title = "Save current look here";
        upd.addEventListener("click", (e) => {
          e.stopPropagation();
          confirmMenu(upd, "Replace “" + o.name + "” with your current look?", async () => {
            try {
              const r = await CER.robloxWrite(`${API}/v1/outfits/${o.id}`, "POST", outfitPayload(o.name, await readAvatar()));
              if (!r?.ok) throw 0;
              CER.toast("Updated " + o.name, "success");
            } catch {
              CER.toast("Couldn't update. Try again.", "error");
            }
          });
        });
        const del = CER.el("button", "cer-outfit-btn cer-outfit-del");
        del.appendChild(ui ? ui.icon("trash", 15) : CER.svg("trash", 16));
        del.title = "Delete";
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          confirmMenu(del, "Delete “" + o.name + "”? You can't undo this.", async () => {
            const r = await CER.robloxWrite(`${API}/v1/outfits/${o.id}/delete`, "POST", {}).catch(() => null);
            if (r?.ok) t.remove();
            CER.toast(r?.ok ? "Deleted " + o.name : "Couldn't delete. Try again.", r?.ok ? "success" : "error");
          });
        });
        controls.append(upd, del);
        t.appendChild(controls);
        frag.appendChild(t);
      }
      grid.replaceChildren(frag);
    } catch {
      if (!stale(seq)) {
        grid.replaceChildren(create);
        grid.appendChild(ui ? ui.empty("Couldn't load your characters.", { icon: "info" }) : CER.el("p", "cer-hint", "Couldn't load your characters."));
      }
    }
  }

  // ---- body: R6/R15 + scale sliders ----

  async function renderScale() {
    const seq = startView();
    let av, rules;
    try {
      [av, rules] = await Promise.all([readAvatar(), getJSON(API + "/v1/avatar-rules").catch(() => null)]);
    } catch {
      if (!stale(seq)) showMsg("Couldn't load your body settings.");
      return;
    }
    if (stale(seq)) return;
    const scales = { ...av.scales };
    const panel = CER.el("div", "cer-scale-panel");

    const typeRow = CER.el("div", "cer-scale-row");
    typeRow.appendChild(CER.el("span", "cer-scale-label", "Body type"));
    const typeWrap = CER.el("div", "cer-avatar-typeswitch");
    let curType = av.playerAvatarType ?? "R15";
    for (const type of ["R6", "R15"]) {
      const b = CER.el("button", "cer-avatar-typebtn", type);
      b.classList.toggle("cer-avatar-typebtn-on", curType === type);
      b.addEventListener("click", async () => {
        if (curType === type) return;
        const r = await CER.robloxWrite(API + "/v1/avatar/set-player-avatar-type", "POST", { playerAvatarType: type }).catch(() => null);
        if (!r?.ok) return CER.toast("Couldn't switch. Try again.", "error");
        curType = type;
        for (const x of typeWrap.children) x.classList.toggle("cer-avatar-typebtn-on", x.textContent === type);
        sliders.classList.toggle("cer-scale-off", type === "R6");
        redraw();
      });
      typeWrap.appendChild(b);
    }
    typeRow.appendChild(typeWrap);
    panel.appendChild(typeRow);

    // R6 ignores scales — show them dimmed so it's clear why nothing changes
    const sliders = CER.el("div", "cer-scale-sliders");
    sliders.classList.toggle("cer-scale-off", curType === "R6");
    panel.appendChild(sliders);

    const range = (key, lo, hi) => {
      const r = rules?.scales?.[key];
      return r && typeof r.min === "number" ? [r.min, r.max, r.increment || 0.01] : [lo, hi, 0.01];
    };
    const DEFS = [
      ["height", "Height", ...range("height", 0.9, 1.05)],
      ["width", "Width", ...range("width", 0.7, 1.0)],
      ["head", "Head", ...range("head", 0.95, 1.0)],
      ["proportion", "Proportions", ...range("proportion", 0, 1)],
      ["bodyType", "Body shape", ...range("bodyType", 0, 1)],
    ];
    let saveTimer = null;
    let lastGood = { ...scales };
    const inputs = {};
    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        scales.depth = scales.width; // Roblox's editor ties depth to width
        const r = await CER.robloxWrite(API + "/v1/avatar/set-scales", "POST", scales).catch(() => null);
        if (r?.ok) {
          lastGood = { ...scales };
          redraw();
        } else {
          Object.assign(scales, lastGood);
          for (const k in inputs) inputs[k].reset();
          CER.toast("Couldn't save that size.", "error");
        }
      }, 500);
    }
    for (const [key, label, min, max, step] of DEFS) {
      const row = CER.el("div", "cer-scale-row");
      row.appendChild(CER.el("span", "cer-scale-label", label));
      const s = CER.el("input", "cer-scale-slider");
      s.type = "range";
      s.min = String(min);
      s.max = String(max);
      s.step = String(step);
      const val = CER.el("span", "cer-scale-val");
      const show = () => (val.textContent = Math.round(Number(s.value) * 100) + "%");
      inputs[key] = {
        reset() {
          s.value = String(scales[key] ?? min);
          show();
        },
      };
      inputs[key].reset();
      s.addEventListener("input", () => {
        scales[key] = Number(s.value);
        show();
        scheduleSave();
      });
      row.append(s, val);
      sliders.appendChild(row);
    }
    grid.replaceChildren(panel);
  }

  function openTab(cat) {
    subRow.textContent = "";
    if (cat.characters) {
      subRow.appendChild(
        subPicker(
          [
            ["owned", "Owned"],
            ["created", "Saved by me"],
          ],
          "owned",
          (v) => (v === "owned" ? loadBundles("BodyParts") : loadOutfits())
        )
      );
      loadBundles("BodyParts");
    } else if (cat.animations) {
      subRow.appendChild(
        subPicker(
          [
            ["packs", "Animation packs"],
            ["emotes", "Emotes"],
          ],
          "packs",
          (v) => (v === "packs" ? loadBundles("AvatarAnimations") : loadCategory(61, true))
        )
      );
      loadBundles("AvatarAnimations");
    } else if (cat.scale) {
      renderScale();
    } else if (cat.sub) {
      subRow.appendChild(subPicker(cat.sub.map(([n, t]) => [String(t), n]), String(cat.sub[0][1]), (v) => loadCategory(Number(v))));
      loadCategory(cat.sub[0][1]);
    } else {
      loadCategory(cat.type);
    }
  }

  // first paint: worn state + preview + first tab, all in parallel
  fetchPreview().then((ok) => {
    if (!ok) pollPreview(); // render still generating
  });
  openTab(CATEGORIES[0]);
  try {
    server = toMap((await readAvatar()).assets);
    want = new Map(server);
  } catch {
    // keep going: the grid still works, and the first save re-reads the avatar
  }
  paint();
})();
