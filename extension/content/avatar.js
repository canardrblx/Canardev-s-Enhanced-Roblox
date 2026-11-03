// CER avatar editor: a game-style character screen on /my/avatar.
//
//   [ big avatar stage ]  [ category picker | item tiles ]
//   [ what you wear    ]
//
// Mounted with ui.page("avatar"), so it sits next to Roblox's #content (hidden
// by html.cer-takeover) and a React re-render in Roblox's editor can't touch
// it. "Classic editor" reloads the page with ?cer=native (Roblox's own editor,
// fresh, so it never shows a stale look).
//
// How it stays in sync (the old version glitched on all of these):
//  - `want` is what the user asked for; `server` is the last state Roblox
//    confirmed. Clicks only touch `want`, then ONE debounced write sends it,
//    so spam-clicking is a single request instead of a pile of racing ones.
//  - A failed or rate-limited read never replaces state. (It used to: an
//    error body turned into "wearing nothing", and the next click stripped
//    the whole avatar.) Nothing writes until the first read has worked.
//  - Every tile and worn item is painted from `want` by paint(), so
//    highlights can never drift from what is actually worn.

(async function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const settings = await CER.get();
  if (!settings.features.avatarEditor) return;
  // the "Classic editor" link: Roblox's own editor for this visit
  if (/[?&]cer=native\b/.test(location.search)) return CER.dismissSkeleton?.();

  const ui = CER.ui;
  const h = ui.h;
  const API = "https://avatar.roblox.com";
  const ANIM_TYPES = [48, 49, 50, 51, 52, 53, 54, 55, 56];
  // not shown as removable items: animations, emotes, mood, and the head and
  // body parts that would leave a broken avatar if removed one by one
  // (17 Head, 27-31 body, 78 Mood, 79 Dynamic Head)
  const HIDDEN_CHIP_TYPES = new Set([...ANIM_TYPES, 17, 24, 27, 28, 29, 30, 31, 61, 78, 79]);

  // category icons (24 grid, stroke, currentColor), drawn for this page
  const ICONS = {
    outfits: '<path d="M10 5.5a2 2 0 1 1 2.9 1.8c-.55.27-.9.78-.9 1.38V9.5"/><path d="M12 9.5 2.9 15.7a1.2 1.2 0 0 0 .68 2.2h16.84a1.2 1.2 0 0 0 .68-2.2Z"/>',
    hair: '<path d="M4.5 20v-7.5a7.5 7.5 0 0 1 15 0V20"/><path d="M4.5 12.5c3.2 0 6.3-1.9 7.5-5 1.2 3.1 4.3 5 7.5 5"/><path d="M8.5 20v-4M15.5 20v-4"/>',
    hats: '<path d="M2.5 18h19"/><path d="M6.5 18V8.5A2.5 2.5 0 0 1 9 6h6a2.5 2.5 0 0 1 2.5 2.5V18"/><path d="M6.5 14h11"/>',
    extras: '<circle cx="6.5" cy="14" r="3.5"/><circle cx="17.5" cy="14" r="3.5"/><path d="M10 13.5c1.3-.9 2.7-.9 4 0M3 14l1.6-6.5M21 14l-1.6-6.5"/>',
    shirts: ui.ICONS.shirt,
    pants: '<path d="M6 3h12l1.5 18h-5L12 10l-2.5 11h-5Z"/><path d="M6.2 6.5h11.6"/>',
    shoes: '<path d="M3 9.5V16a2 2 0 0 0 2 2h14.5a1.5 1.5 0 0 0 1.5-1.5c0-1.7-1.3-3-3-3.3l-5-1L10 9l-3 2-4-1.5Z"/><path d="M3 15h18"/>',
    faces: '<circle cx="12" cy="12" r="9.5"/><path d="M8 14.5a5 5 0 0 0 8 0M9 9.5h.01M15 9.5h.01"/>',
    emotes: '<circle cx="13" cy="4.5" r="2"/><path d="m4 9 4.5-2 4 1.5 3 4L20 13M12.5 8.5 11 14l3.5 3 1 4.5M11 14l-3.5 2.5L5 21"/>',
  };
  const icon = (name, size = 24) => {
    const s = ui.icon("", size);
    s.innerHTML = ICONS[name] ?? ui.ICONS[name] ?? ""; // static strings above only
    return s;
  };

  // [label, assetType or [types]] per sub chip
  const CATEGORIES = [
    { id: "outfits", label: "Outfits", outfits: true },
    { id: "hair", label: "Hair", type: 41 },
    { id: "hats", label: "Hats", type: 8 },
    {
      id: "extras",
      label: "Extras",
      sub: [
        ["Face", 42],
        ["Neck", 43],
        ["Shoulder", 44],
        ["Front", 45],
        ["Back", 46],
        ["Waist", 47],
      ],
    },
    {
      id: "shirts",
      label: "Shirts",
      sub: [
        ["Shirts", 11],
        ["T-Shirts", 2],
        ["Jackets", 67],
        ["Sweaters", 68],
        ["Layered", [65, 64]],
      ],
    },
    {
      id: "pants",
      label: "Pants",
      sub: [
        ["Pants", 12],
        ["Shorts", 69],
        ["Skirts", 72],
        ["Layered", 66],
      ],
    },
    { id: "shoes", label: "Shoes", type: [70, 71] },
    { id: "faces", label: "Faces", type: 18 },
    { id: "emotes", label: "Moves", moves: true },
  ];

  const getJSON = async (url) => {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  };

  // ---- shell: built synchronously so the page is usable at once ----

  const { page } = ui.page("avatar", "cer-av");

  const img = h("img", { class: "cer-av-img", alt: "", draggable: "false" });
  const refreshBtn = ui.button("", { icon: "refresh", variant: "ghost", size: "sm", title: "Redraw", class: "cer-av-redraw" });
  const nameSlot = h("div", { class: "cer-av-name" });
  const bodyBtn = h("button", { type: "button", class: "cer-av-bodybtn", "aria-pressed": "false" }, ui.icon("sliders", 17), h("span", { text: "Body" }));
  const preview = h(
    "div",
    { class: "cer-av-preview" },
    h("div", { class: "cer-av-floor" }),
    img,
    h("div", { class: "cer-av-spin" }),
    h("div", { class: "cer-av-top" }, nameSlot, refreshBtn),
    bodyBtn
  );
  const strip = h("div", { class: "cer-av-worn" });
  const classic = h("a", { class: "cer-av-classic", href: ui.nativeUrl() }, "Classic editor");
  const stage = h(
    "aside",
    { class: "cer-av-stage" },
    preview,
    h("section", { class: "cer-av-wearing" }, h("h2", { class: "cer-av-h", text: "Wearing" }), strip),
    classic
  );

  const cats = h("nav", { class: "cer-av-cats", "aria-label": "Categories" });
  const subRow = h("div", { class: "cer-av-sub" });
  const grid = h("div", { class: "cer-av-grid" });
  const closet = h("div", { class: "cer-av-closet" }, cats, h("div", { class: "cer-av-shelf" }, subRow, grid));
  page.appendChild(h("div", { class: "cer-av-layout" }, stage, closet));

  const skel = (n = 18) => ui.skeleton("tile", n);
  const skelWorn = () => Array.from({ length: 6 }, () => h("div", { class: "cer-sk cer-av-worn-sk" }));

  // categories exist now; contents load below. Picked before the user is
  // known: remembered, opened once `me` is in.
  let me = null;
  let activeCat = null;
  const catBtns = new Map();
  for (const cat of CATEGORIES) {
    const b = h("button", { type: "button", class: "cer-av-cat", "aria-pressed": "false", title: cat.label }, icon(cat.id), h("span", { text: cat.label }));
    b.addEventListener("click", () => {
      if (activeCat === cat) return;
      if (!me) return markCat(cat);
      openTab(cat);
    });
    cats.appendChild(b);
    catBtns.set(cat, b);
  }
  function markCat(cat) {
    activeCat = cat;
    for (const [c, b] of catBtns) {
      b.classList.toggle("is-on", c === cat);
      b.setAttribute("aria-pressed", c === cat ? "true" : "false");
    }
    bodyBtn.classList.toggle("is-on", !cat);
    bodyBtn.setAttribute("aria-pressed", cat ? "false" : "true");
  }
  markCat(CATEGORIES[0]);
  grid.replaceChildren(...skel());
  strip.replaceChildren(...skelWorn());

  me = await CER.me();
  if (!me) {
    if (CER.loggedOut) return ui.release(); // Roblox's page sends them to log in
    subRow.replaceChildren();
    grid.replaceChildren(ui.empty("Couldn't load your avatar.", { icon: "info", action: ui.button("Try again", { variant: "soft", onClick: () => location.reload() }) }));
    strip.replaceChildren();
    return;
  }
  img.alt = me.displayName || me.name;
  nameSlot.appendChild(ui.nameTag({ type: "user", id: me.id, name: me.displayName || me.name, size: "lg" }));

  // ---- worn state ----

  let server = new Map(); // assetId -> { id, name, assetType, meta }
  let want = new Map();
  let avatarCache = null; // last good GET v1/avatar
  // Nothing writes until a read of the avatar has worked. With `server`
  // unknown, one click would send only that item and strip everything else.
  let loaded = false;
  let loadFailed = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function readAvatar() {
    const av = await getJSON(API + "/v1/avatar");
    if (!Array.isArray(av.assets)) throw new Error("bad avatar body");
    avatarCache = av;
    return av;
  }
  // a 429 or a blip should not leave us without the avatar: back off and retry
  async function readAvatarRetry() {
    for (let i = 0; ; i++) {
      try {
        return await readAvatar();
      } catch (e) {
        if (i >= 3) throw e;
      }
      await sleep(1000 * 2 ** i);
    }
  }
  const toMap = (assets) => new Map(assets.map((a) => [a.id, a]));

  // (re)load what is worn. On failure every write stays blocked and the
  // wearing area offers "Try again".
  let loadRun = null;
  function reload() {
    if (!loadRun) {
      loadFailed = false;
      loadRun = (async () => {
        try {
          server = toMap((await readAvatarRetry()).assets);
          want = new Map(server);
          loaded = true;
        } catch {
          loaded = false;
          loadFailed = true;
        }
        loadRun = null;
        paint();
      })();
      paint();
    }
    return loadRun;
  }

  // per-type wear limits (Shirt 1, Pants 1, Face 1...). Roblox's defaults
  // until avatar-rules answers; unknown types allow 1, like Roblox's own
  // editor. Accessories are left out: Roblox accepts more than their
  // maxNumber (2 hairs, extra hats) and checks its own total, so taking
  // one off here could remove something the user wanted.
  const ACCESSORY_TYPES = new Set([8, 41, 42, 43, 44, 45, 46, 47]);
  const typeMax = new Map([
    [88, 6],
    [89, 6],
    [90, 6],
  ]);
  let rulesRun = null; // cached only when it works
  const avatarRules = () =>
    (rulesRun ??= getJSON(API + "/v1/avatar-rules").catch(() => {
      rulesRun = null;
      return null;
    }));
  avatarRules().then((r) => {
    for (const w of r?.wearableAssetTypes ?? []) if (w.maxNumber > 0) typeMax.set(w.id, w.maxNumber);
  });

  // paint every tile and worn item from `want`
  function paint() {
    for (const t of grid.querySelectorAll(".cer-av-tile[data-asset-id]")) {
      const id = Number(t.dataset.assetId);
      const on = t.dataset.kind === "emote" ? emotes.has(id) : want.has(id);
      t.classList.toggle("is-worn", on);
      t.setAttribute("aria-pressed", on ? "true" : "false");
    }
    renderStrip();
  }

  // Character and outfit wears replace the whole look, so they run one at a
  // time, after any pending save, and block single-item clicks meanwhile.
  // Clicked several quickly: only the last one is put on.
  let opChain = Promise.resolve();
  let opSeq = 0;
  let opBusy = 0;
  function exclusive(fn) {
    const seq = ++opSeq;
    opBusy++;
    const run = opChain.then(async () => {
      if (seq !== opSeq || !loaded) return false;
      await flushWrites();
      await fn();
      return true;
    });
    opChain = run.catch(() => {}).finally(() => opBusy--);
    return run;
  }
  // `queue`: wears may line up behind a running wear
  function canWrite(queue) {
    if (!loaded) {
      CER.toast(loadFailed ? "Couldn't load your avatar." : "Loading your avatar…", loadFailed ? "error" : undefined);
      return false;
    }
    if (opBusy && !queue) {
      CER.toast("Wait a moment.");
      return false;
    }
    return true;
  }

  let syncTimer = null;
  let syncRun = null;
  let dirty = false;
  // debounce: a burst of clicks becomes one write
  function scheduleSync() {
    dirty = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, 450);
  }
  // one sync at a time; the running one loops until nothing is queued
  function runSync() {
    clearTimeout(syncTimer);
    if (!syncRun) syncRun = doSync().finally(() => (syncRun = null));
    return syncRun;
  }
  let flushScales = async () => {}; // set by the Body panel
  // send anything still waiting, and wait for writes in flight
  async function flushWrites() {
    if (dirty || syncRun) await runSync();
    await flushScales();
  }
  async function doSync() {
    while (dirty && loaded) {
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
  }

  function toggleAsset(item) {
    if (!canWrite()) return;
    if (want.has(item.id)) want.delete(item.id);
    else {
      // at the limit for this type (a 2nd shirt): take off the oldest one
      // first, or Roblox rejects the whole change
      const type = item.assetType?.id;
      if (type && !ACCESSORY_TYPES.has(type)) {
        const max = typeMax.get(type) ?? 1;
        const same = [...want.values()].filter((a) => a.assetType?.id === type);
        for (const a of same.slice(0, Math.max(0, same.length - max + 1))) want.delete(a.id);
      }
      want.set(item.id, item);
    }
    paint();
    scheduleSync();
  }

  // ---- emotes (own slot API; set-wearing-assets ignores them) ----

  let emotes = new Map(); // assetId -> slot 1..8
  const emoteNames = new Map(); // assetId -> name
  let emotesOk = false; // the last emote read worked
  async function refreshEmotes() {
    try {
      const list = await getJSON(API + "/v1/emotes");
      if (!Array.isArray(list)) throw 0;
      emotes = new Map(list.map((e) => [e.assetId, e.position]));
      for (const e of list) if (e.assetName) emoteNames.set(e.assetId, e.assetName);
      emotesOk = true;
    } catch {
      emotesOk = false; // keep old state, but don't write on top of it
    }
  }
  // all 8 slots full: ask before swapping one out
  function askSwap(oldName, newName) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (yes, close) => {
        if (!done) {
          done = true;
          resolve(yes);
        }
        close?.();
      };
      ui.modal({
        title: "All 8 emote slots are full",
        body: h("p", { text: "Swap “" + oldName + "” for “" + newName + "”?" }),
        actions: [
          { label: "Cancel", onClick: (close) => finish(false, close) },
          { label: "Swap", variant: "primary", onClick: (close) => finish(true, close) },
        ],
        onClose: () => finish(false),
      });
    });
  }
  let emoteQ = Promise.resolve();
  function toggleEmote(assetId, name) {
    emoteQ = emoteQ
      .then(async () => {
        if (!emotesOk) {
          await refreshEmotes();
          if (!emotesOk) {
            CER.toast("Couldn't load your emotes. Try again.", "error");
            return;
          }
        }
        if (emotes.has(assetId)) {
          const r = await CER.robloxWrite(`${API}/v1/emotes/${assetId}`, "DELETE");
          if (!r?.ok) throw 0;
          emotes.delete(assetId);
          return;
        }
        const used = new Set(emotes.values());
        let slot = 0;
        let swapped = 0;
        for (let p = 1; p <= 8 && !slot; p++) if (!used.has(p)) slot = p;
        if (!slot) {
          // all 8 full: offer to free the lowest slot
          const [firstId, firstPos] = [...emotes].sort((a, b) => a[1] - b[1])[0];
          if (!(await askSwap(emoteNames.get(firstId) ?? "your first emote", name))) return;
          const d = await CER.robloxWrite(`${API}/v1/emotes/${firstId}`, "DELETE");
          if (!d?.ok) throw 0;
          emotes.delete(firstId);
          slot = firstPos;
          swapped = firstId;
        }
        const r = await CER.robloxWrite(`${API}/v1/emotes/${assetId}/${slot}`, "POST", {}).catch(() => null);
        if (!r?.ok) {
          // put back the emote we just took out of that slot
          if (swapped) {
            const back = await CER.robloxWrite(`${API}/v1/emotes/${swapped}/${slot}`, "POST", {}).catch(() => null);
            if (back?.ok) emotes.set(swapped, slot);
          }
          throw 0;
        }
        emotes.set(assetId, slot);
        emoteNames.set(assetId, name);
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
    preview.classList.add("is-busy");
    let tries = 0;
    const tick = async () => {
      if (token !== pollToken) return;
      const changed = await fetchPreview();
      if (token !== pollToken) return;
      if (changed || ++tries >= 16) {
        preview.classList.remove("is-busy");
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
  img.addEventListener("load", () => preview.classList.add("is-ready"));

  // ---- art ----
  // <img> that fades in once its url is known (set later with im.set(url))
  function artImg(url) {
    const im = h("img", { class: "cer-img", alt: "", loading: "lazy", decoding: "async", draggable: "false" });
    im.set = (u) => {
      if (!u) return;
      im.addEventListener("load", () => im.classList.add("cer-img-in"), { once: true });
      im.src = u;
    };
    im.set(url);
    return im;
  }
  // outfit renders at 420 (ui's "outfit" thumb is 150, blurry on big cards);
  // still-rendering ones get one more try
  async function outfitThumbs(ids, onEach) {
    let todo = ids;
    for (let attempt = 0; attempt < 2 && todo.length; attempt++) {
      if (attempt) await sleep(1500);
      const pending = [];
      for (let i = 0; i < todo.length; i += 100) {
        try {
          const d = await getJSON(`https://thumbnails.roblox.com/v1/users/outfits?userOutfitIds=${todo.slice(i, i + 100).join(",")}&size=420x420&format=Webp`);
          for (const t of d.data ?? []) {
            if (t.state === "Completed" && t.imageUrl) onEach(t.targetId, t.imageUrl);
            else if (t.state === "Pending") pending.push(t.targetId);
          }
        } catch {
          /* cards keep their blank art */
        }
      }
      todo = pending;
    }
  }

  // ---- wearing ----
  // worn items keep their element between paints, so art never flickers

  const wornEls = new Map(); // assetId -> button
  function renderStrip() {
    if (!loaded) {
      wornEls.clear();
      // still loading (placeholders), or failed: say so and offer a retry
      if (!loadFailed) return strip.replaceChildren(...skelWorn());
      return strip.replaceChildren(
        h("p", { class: "cer-av-note", text: "Couldn't load your avatar." }),
        ui.button("Try again", { variant: "soft", size: "sm", onClick: () => reload() })
      );
    }
    const items = [...want.values()].filter((a) => !a.assetType || !HIDDEN_CHIP_TYPES.has(a.assetType.id));
    const keep = new Set(items.map((a) => a.id));
    for (const id of [...wornEls.keys()]) if (!keep.has(id)) wornEls.delete(id);
    const els = items.map((a) => {
      let el = wornEls.get(a.id);
      if (!el) {
        const name = a.name ?? String(a.id);
        el = h(
          "button",
          { type: "button", class: "cer-av-worn-item", title: name, "aria-label": "Take off " + name },
          ui.thumb("asset", a.id, { class: "cer-av-worn-img" }),
          h("span", { class: "cer-av-worn-x" }, ui.icon("x", 12))
        );
        wornEls.set(a.id, el);
      }
      el.onclick = () => toggleAsset(a);
      return el;
    });
    strip.replaceChildren(...(els.length ? els : [h("p", { class: "cer-av-note", text: "Nothing on yet." })]));
  }

  // ---- grid ----

  let loadSeq = 0; // a newer view cancels older loads
  function startView() {
    const seq = ++loadSeq;
    grid.className = "cer-av-grid";
    grid.replaceChildren(...skel());
    return seq;
  }
  const stale = (seq) => seq !== loadSeq;
  const shopBtn = () => ui.button("Shop", { variant: "soft", icon: "bag", href: "https://www.roblox.com/catalog" });
  function showMsg(text, opts = {}) {
    grid.replaceChildren(ui.empty(text, { icon: opts.icon ?? "shirt", action: opts.shop ? shopBtn() : null }));
  }

  // a div, not a <button>: outfit cards hold their own buttons, and nested
  // buttons swallow clicks in Firefox
  function tile(name, art, cls = "") {
    const t = h(
      "div",
      { class: "cer-av-tile " + cls, tabindex: "0", role: "button", title: name },
      h("div", { class: "cer-av-tile-art" }, art),
      h("span", { class: "cer-av-tile-name", text: name })
    );
    t.addEventListener("keydown", (e) => {
      // only the tile itself: Enter on its Update/Delete buttons must not wear it
      if (e.target !== t) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        t.click();
      }
    });
    return t;
  }

  function itemTile(item, isEmote) {
    const name = item.assetName ?? item.name ?? String(item.assetId);
    const t = tile(name, ui.thumb("asset", item.assetId));
    t.dataset.assetId = item.assetId;
    if (isEmote) {
      t.dataset.kind = "emote";
      t.addEventListener("click", () => {
        if (!canWrite(true)) return;
        t.classList.toggle("is-worn");
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
      if (stale(seq)) return;
      if (first) {
        grid.replaceChildren();
        first = false;
        if (!items.length) return showMsg("You don't have any yet.", { shop: true });
      }
      grid.querySelector(".cer-av-more")?.remove();
      const frag = document.createDocumentFragment();
      for (const it of items) frag.appendChild(itemTile(it, isEmote));
      grid.appendChild(frag);
      paint();
      if (cursors.size) {
        // loads by itself when scrolled near; the button is the fallback
        const more = ui.button("Show more", { variant: "soft", class: "cer-av-more" });
        const go = () => {
          if (more.disabled) return;
          more.busy(true);
          page().catch(() => more.busy(false));
        };
        more.addEventListener("click", go);
        grid.appendChild(more);
        ui.whenVisible(more, () => !stale(seq) && go());
      }
    }
    try {
      await page();
    } catch {
      if (!stale(seq)) showMsg("Couldn't load these. Try again.", { icon: "info" });
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

  // wear a saved character (Roblox swaps the whole look), then adopt what
  // Roblox reports. Runs inside exclusive().
  async function wearOutfitNow(outfitId) {
    const r = await CER.robloxWrite(`${API}/v1/outfits/${outfitId}/wear`, "POST", {}).catch(() => null);
    if (!r?.ok) throw 0;
    await reload(); // if this read fails, writes stay blocked until "Try again"
    redraw();
  }

  function wearBundle(bundle, kind) {
    if (!canWrite(true)) return;
    exclusive(async () => {
      const toast = CER.toast("Putting on " + bundle.name + "…");
      try {
        const details = await getJSON(`https://catalog.roblox.com/v1/bundles/${bundle.id}/details`);
        const items = details.items ?? [];
        const outfit = items.find((i) => i.type === "UserOutfit");
        if (kind === "BodyParts" && outfit) {
          await wearOutfitNow(outfit.id);
        } else {
          // animation packs: swap out the current animations for the pack's.
          // Body bundles without an outfit only add their parts.
          if (kind === "AvatarAnimations") for (const [id, a] of want) if (a.assetType && ANIM_TYPES.includes(a.assetType.id)) want.delete(id);
          const ids = [];
          for (const i of items) if (i.type === "Asset") {
            want.set(i.id, { id: i.id, name: i.name });
            ids.push(i.id);
          }
          paint();
          dirty = true;
          await runSync(); // finish here, so the next wear starts from it
          if (!ids.some((id) => server.has(id))) throw 0;
        }
        toast.textContent = "Wearing " + bundle.name;
      } catch {
        toast.textContent = "Couldn't put on " + bundle.name;
        toast.classList.add("cer-toast-error");
      }
    });
  }

  async function loadBundles(kind) {
    const seq = startView();
    try {
      const bundles = await ownedBundles(kind);
      if (stale(seq)) return;
      if (!bundles.length) return showMsg(kind === "BodyParts" ? "You don't have any characters yet." : "You don't have any animations yet.", { shop: true });
      grid.classList.toggle("is-big", kind === "BodyParts");
      const frag = document.createDocumentFragment();
      for (const b of bundles) {
        const t = tile(b.name, ui.thumb("bundle", b.id));
        t.addEventListener("click", () => wearBundle(b, kind));
        frag.appendChild(t);
      }
      grid.replaceChildren(frag);
    } catch {
      if (!stale(seq)) showMsg("Couldn't load these. Try again.", { icon: "info" });
    }
  }

  // small popover anchored to a card button (yes/no, or a name field)
  function popover(anchor, kids) {
    document.querySelector(".cer-av-pop")?.remove();
    const pop = h("div", { class: "cer-av-pop cer-ui", role: "dialog" }, kids);
    const close = () => {
      pop.remove();
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
    const onKey = (e) => e.key === "Escape" && close();
    pop.addEventListener("click", (e) => e.stopPropagation());
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 268)) + "px";
    pop.style.top = Math.min(r.bottom + 8, window.innerHeight - 150) + "px";
    document.body.appendChild(pop);
    setTimeout(() => {
      document.addEventListener("click", close);
      document.addEventListener("keydown", onKey);
      window.addEventListener("scroll", close, true);
    }, 0);
    return close;
  }
  function confirmMenu(anchor, message, onYes) {
    const yes = ui.button("Yes", { variant: "primary", size: "sm" });
    const no = ui.button("Cancel", { variant: "soft", size: "sm" });
    const close = popover(anchor, [h("p", { class: "cer-av-pop-msg", text: message }), h("div", { class: "cer-av-pop-row" }, no, yes)]);
    no.addEventListener("click", close);
    yes.addEventListener("click", () => {
      close();
      onYes();
    });
    yes.focus();
  }
  function nameMenu(anchor, initial, onSave) {
    const input = h("input", { class: "cer-av-pop-input", type: "text", maxlength: "25", value: initial, spellcheck: "false", "aria-label": "Outfit name" });
    const save = ui.button("Save", { variant: "primary", size: "sm" });
    const no = ui.button("Cancel", { variant: "soft", size: "sm" });
    const close = popover(anchor, [h("p", { class: "cer-av-pop-msg", text: "Name your outfit" }), input, h("div", { class: "cer-av-pop-row" }, no, save)]);
    const go = () => {
      const name = input.value.trim();
      if (!name) return input.focus();
      close();
      onSave(name);
    };
    no.addEventListener("click", close);
    save.addEventListener("click", go);
    input.addEventListener("keydown", (e) => e.key === "Enter" && go());
    input.focus();
    input.select();
  }

  // v2 outfit body (what Roblox's own editor sends with BrickColor ids):
  // assets keep their meta, so layered clothing order/puffiness and
  // accessory position/rotation/scale survive. The v1 shape (assetIds) lost them.
  const outfitPayload = (name, av) => ({
    name,
    bodyColors: av.bodyColors,
    assets: av.assets.map((a) => (a.meta ? { id: a.id, meta: a.meta } : { id: a.id })),
    scale: av.scales,
    playerAvatarType: av.playerAvatarType,
  });
  // the look as Roblox has it, after every pending change has landed
  async function snapshotLook() {
    await opChain;
    await flushWrites();
    return readAvatar();
  }

  async function loadOutfits() {
    const seq = startView();
    grid.classList.add("is-big");
    const create = tile("Save look", h("span", { class: "cer-av-save-art" }, ui.icon("plus", 34)), "is-save");
    let saving = false;
    create.addEventListener("click", () => {
      if (saving) return;
      nameMenu(create, "My Outfit", async (name) => {
        saving = true;
        create.classList.add("is-busy");
        try {
          const r = await CER.robloxWrite(API + "/v2/outfits/create", "POST", outfitPayload(name.slice(0, 25), await snapshotLook()));
          if (r?.ok) {
            CER.toast("Saved " + name, "success");
            loadOutfits();
          } else CER.toast("Couldn't save. Try again.", "error");
        } catch {
          CER.toast("Couldn't save. Try again.", "error");
        } finally {
          saving = false;
          create.classList.remove("is-busy");
        }
      });
    });
    try {
      const outfits = [];
      for (let p = 1; p <= 6; p++) {
        const d = await getJSON(`${API}/v1/users/${me.id}/outfits?page=${p}&itemsPerPage=50&isEditable=true`);
        outfits.push(...(d.data ?? []));
        if ((d.data ?? []).length < 50) break;
      }
      if (stale(seq)) return;
      const arts = new Map();
      const frag = document.createDocumentFragment();
      frag.appendChild(create);
      for (const o of outfits) {
        const art = artImg();
        arts.set(String(o.id), art);
        const t = tile(o.name, art, "is-outfit");
        t.addEventListener("click", () => {
          if (!canWrite(true)) return;
          exclusive(async () => {
            const toast = CER.toast("Putting on " + o.name + "…");
            try {
              await wearOutfitNow(o.id);
              toast.textContent = "Wearing " + o.name;
            } catch {
              toast.textContent = "Couldn't put on " + o.name;
              toast.classList.add("cer-toast-error");
            }
          });
        });
        const upd = h("button", { type: "button", class: "cer-av-card-btn", title: "Save my look here", "aria-label": "Save my look here" }, ui.icon("refresh", 15));
        upd.addEventListener("click", (e) => {
          e.stopPropagation();
          confirmMenu(upd, "Put your look on “" + o.name + "”?", async () => {
            try {
              const r = await CER.robloxWrite(`${API}/v2/outfits/${o.id}`, "PATCH", outfitPayload(o.name, await snapshotLook()));
              if (!r?.ok) throw 0;
              CER.toast("Updated " + o.name, "success");
              redrawOutfit(o.id, art);
            } catch {
              CER.toast("Couldn't update. Try again.", "error");
            }
          });
        });
        const del = h("button", { type: "button", class: "cer-av-card-btn is-del", title: "Delete", "aria-label": "Delete" }, ui.icon("trash", 15));
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          confirmMenu(del, "Delete “" + o.name + "”? You can't undo this.", async () => {
            const r = await CER.robloxWrite(`${API}/v1/outfits/${o.id}/delete`, "POST", {}).catch(() => null);
            if (r?.ok) t.remove();
            CER.toast(r?.ok ? "Deleted " + o.name : "Couldn't delete. Try again.", r?.ok ? "success" : "error");
          });
        });
        t.appendChild(h("div", { class: "cer-av-card-tools" }, upd, del));
        frag.appendChild(t);
      }
      grid.replaceChildren(frag);
      outfitThumbs(outfits.map((o) => o.id), (id, url) => !stale(seq) && arts.get(String(id))?.set(url));
    } catch {
      if (!stale(seq)) {
        grid.classList.remove("is-big");
        grid.replaceChildren(create, ui.empty("Couldn't load your outfits.", { icon: "info" }));
      }
    }
  }
  // an updated outfit renders again under a new url: pick it up once
  function redrawOutfit(id, art) {
    setTimeout(() => outfitThumbs([id], (_, url) => art.set(url)), 2500);
  }

  // ---- body: R6/R15 + scale sliders ----

  async function renderScale() {
    const seq = startView();
    grid.replaceChildren(ui.skeleton("hero"));
    let av, rules;
    try {
      // read after any wear or size save still in flight
      await flushScales();
      await opChain;
      if (loadRun) await loadRun;
      if (!loaded) throw 0;
      [av, rules] = await Promise.all([readAvatar(), avatarRules()]);
    } catch {
      if (!stale(seq)) showMsg("Couldn't load your body.", { icon: "info" });
      return;
    }
    if (stale(seq)) return;
    const scales = { ...av.scales };
    const panel = h("div", { class: "cer-av-body" });

    // R6 ignores scales: show them dimmed so it's clear why nothing changes
    const sliders = h("div", { class: "cer-av-sliders" });
    let curType = av.playerAvatarType ?? "R15";
    const typeWrap = h("div", { class: "cer-seg cer-av-type", role: "group", "aria-label": "Body type" });
    for (const type of ["R6", "R15"]) {
      const b = h("button", { type: "button", class: "cer-chip" + (curType === type ? " is-active" : ""), text: type });
      b.addEventListener("click", async () => {
        if (curType === type || !canWrite()) return;
        const r = await CER.robloxWrite(API + "/v1/avatar/set-player-avatar-type", "POST", { playerAvatarType: type }).catch(() => null);
        if (!r?.ok) return CER.toast("Couldn't switch. Try again.", "error");
        curType = type;
        for (const x of typeWrap.children) x.classList.toggle("is-active", x.textContent === type);
        sliders.classList.toggle("is-off", type === "R6");
        redraw();
      });
      typeWrap.appendChild(b);
    }
    sliders.classList.toggle("is-off", curType === "R6");
    panel.append(h("div", { class: "cer-av-body-head" }, h("h2", { class: "cer-av-h", text: "Body" }), typeWrap), sliders);

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
    // Roblox's own editor never sends depth (its set-scales body is height,
    // width, head, proportion, bodyType). So send depth exactly as read, and
    // leave it out, like Roblox, only once the width slider has moved. (This
    // used to copy width into depth on every save, silently changing it.)
    let widthMoved = false;
    let widthSaved = false;
    let saveTimer = null;
    let saveRun = null;
    let scaleDirty = false;
    let lastGood = { ...scales };
    const inputs = {};
    function scheduleSave() {
      scaleDirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNow, 500);
    }
    // one save at a time; loops until the sliders stop moving
    function saveNow() {
      clearTimeout(saveTimer);
      if (!saveRun)
        saveRun = (async () => {
          while (scaleDirty) {
            scaleDirty = false;
            const sent = { ...scales }; // what this request saves
            const sentWidth = widthMoved;
            const body = { ...sent };
            if (sentWidth) delete body.depth;
            const r = await CER.robloxWrite(API + "/v1/avatar/set-scales", "POST", body).catch(() => null);
            if (r?.ok) {
              lastGood = sent;
              widthSaved = sentWidth;
              redraw();
            } else {
              // undo every unsaved move, and drop any save queued after it
              clearTimeout(saveTimer);
              scaleDirty = false;
              Object.assign(scales, lastGood);
              widthMoved = widthSaved;
              for (const k in inputs) inputs[k].reset();
              CER.toast("Couldn't save that size.", "error");
            }
          }
        })().finally(() => (saveRun = null));
      return saveRun;
    }
    flushScales = () => (scaleDirty || saveRun ? saveNow() : Promise.resolve());
    for (const [key, label, min, max, step] of DEFS) {
      const s = h("input", { class: "cer-av-range", type: "range", min: String(min), max: String(max), step: String(step), "aria-label": label });
      const val = h("span", { class: "cer-av-val" });
      // the filled part of the track follows the thumb
      const show = () => {
        val.textContent = Math.round(Number(s.value) * 100) + "%";
        s.style.setProperty("--fill", ((Number(s.value) - min) / (max - min || 1)) * 100 + "%");
      };
      inputs[key] = {
        reset() {
          s.value = String(scales[key] ?? min);
          show();
        },
      };
      inputs[key].reset();
      s.addEventListener("input", () => {
        if (!loaded || opBusy) return inputs[key].reset(); // a wear is running
        if (key === "width") widthMoved = true;
        scales[key] = Number(s.value);
        show();
        scheduleSave();
      });
      sliders.appendChild(h("label", { class: "cer-av-slider" }, h("span", { class: "cer-av-slider-top" }, h("span", { text: label }), val), s));
    }
    grid.className = "cer-av-grid is-panel";
    grid.replaceChildren(panel);
  }

  function openTab(cat) {
    markCat(cat);
    subRow.replaceChildren();
    if (!cat) return renderScale(); // the stage's Body button
    const picker = (items, onChange) => subRow.appendChild(ui.chips(items, items[0].id, onChange, { wrap: true }));
    if (cat.outfits) {
      picker(
        [
          { id: "saved", label: "Saved" },
          { id: "characters", label: "Characters" },
        ],
        (v) => (v === "saved" ? loadOutfits() : loadBundles("BodyParts"))
      );
      loadOutfits();
    } else if (cat.moves) {
      picker(
        [
          { id: "emotes", label: "Emotes" },
          { id: "packs", label: "Animations" },
        ],
        (v) => (v === "emotes" ? loadCategory(61, true) : loadBundles("AvatarAnimations"))
      );
      loadCategory(61, true);
    } else if (cat.sub) {
      picker(
        cat.sub.map(([label], i) => ({ id: String(i), label })),
        (v) => loadCategory(cat.sub[Number(v)][1])
      );
      loadCategory(cat.sub[0][1]);
    } else {
      loadCategory(cat.type);
    }
  }
  let lastCat = CATEGORIES[0];
  bodyBtn.addEventListener("click", () => {
    if (!me) return;
    if (activeCat) {
      lastCat = activeCat;
      openTab(null);
    } else openTab(lastCat);
  });

  // first paint: worn state + preview + first tab, all in parallel
  fetchPreview().then((ok) => {
    if (!ok) pollPreview(); // render still generating
  });
  openTab(activeCat ?? CATEGORIES[0]);
  reload(); // writes stay blocked until this works
})();
