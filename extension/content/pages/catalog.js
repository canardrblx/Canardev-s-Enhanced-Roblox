// CER catalog: a game-platform shop. Built on CER.ui (content/ui.js).
//
//   /catalog                          shop front: search, a "Popular now"
//                                     spotlight, category art tiles, rails
//                                     (Popular, New, Free, Limiteds)
//   /catalog?cat=hair&show=new&...    one shelf: big art grid, quick chips
//   /catalog/{id}/{slug}              item page: huge art, try-on, one Buy
//   /bundles/{id}/{slug}              bundle page (same, plus what is inside)
//
// Data comes only from Roblox's web APIs. Buying is NOT done here: Buy / Get
// opens the same item with ui.nativeUrl() so Roblox's own buy flow runs.
// Moving around the shop is client-side (pushState); shelf views are kept in
// memory, so Back is instant and keeps the scroll.
//
// catalog.roblox.com has a very strict rate limit (about 3 calls, then 429
// for seconds, shared with every tab of the account). So: one queue with a
// single call in flight and a real 429 backoff, results cached in memory and
// sessionStorage, rows from any list reused for the item page (opening an
// item from a card costs no catalog call), category art and sub-categories
// are fixed ids (no menu call), and rails load only when scrolled near.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;
  const TAG = "catalog";
  const own = (obj, k) => k != null && Object.hasOwn(obj, k); // ?cat=constructor must not pass

  // ------------------------------------------------------------ constants
  // tax = catalog taxonomy id (what Roblox's own catalog sends).
  // art = a Roblox-made item whose picture stands for the category.
  const CATS = [
    { id: "all", label: "All", tax: "tZsUsd2BqGViQrJ9Vs3Wah", tile: false },
    { id: "hair", label: "Hair", tax: "d6a7M7r9MMrpf7z7VxW9ZS", art: ["asset", 451221329] },
    { id: "faces", label: "Faces", tax: "s5NLP7BS9PRLKvUVca4XKg", art: ["bundle", 299652] },
    {
      id: "clothing", label: "Clothes", tax: "5G3bZScC9Hxp2D2EUtGSNm", art: ["asset", 607785314],
      subs: [["Shirts", "pJ71PxerdfEuarTNRtSZYs"], ["T-Shirts", "fLRqNzGqjX7MzcqeMro9hc"], ["Jackets", "kPZpEVNdProGcqMbj1jDKJ"], ["Sweaters", "31M6WgEMmyq9TTfk3pUUpZ"], ["Pants", "1MvRtnnsy2FJWmkErSBxBa"], ["Shorts", "etAPg889P243JyjdbZCXhw"], ["Dresses", "oSSCBSqkQPZu6HataAUAxB"], ["Bodysuits", "u5jaNLyf2ZhvR95GS37ui5"], ["Classic Shirts", "2a2rf9qyeTd8W5iegK2Prc"], ["Classic T-Shirts", "43H35nJKHzCQM63q3wPaJG"], ["Classic Pants", "49cFNAJWuwiJJVUSADG6DR"]],
    },
    {
      id: "accessories", label: "Accessories", tax: "wNYJso48d1XnhMyFWT3oX3", art: ["asset", 139152472],
      subs: [["Hats", "thukPQUFe5EHxRrtsgq43u"], ["Face", "b5rkQhGSfwhfTK177y6ERa"], ["Neck", "tvckLAbtDAGwF9Y2sph2Ce"], ["Shoulder", "8i1sggNTrxoN799hpRrR1S"], ["Front", "kj535RzJxHTCnXPBLo5KaE"], ["Back", "7yGywzp5JeDsNjhXWJqSw3"], ["Waist", "6jYQPDtkVwQZcKtvVpyYAN"], ["Gear", "gUtxkR951g3VPgRkb5ay8u"]],
    },
    { id: "bodies", label: "Bodies", tax: "kfHzJwaNYM8s2CWRqYUhRa", art: ["bundle", 192] },
    { id: "shoes", label: "Shoes", tax: "uLRgNoJ1awZkhpVw9WyvKo", art: ["bundle", 872] },
    { id: "emotes", label: "Emotes", tax: "ioNxAT977DFP2hMnAJbsbF", art: ["asset", 3576686446] },
    { id: "animations", label: "Animations", tax: "whf6kUVBwk2xdwKUmRYN6G", art: ["bundle", 82] },
    {
      id: "makeup", label: "Makeup", tax: "dBM565GC3YYTdi9UKvr87Z", art: ["asset", 128355658815589],
      subs: [["Eyes", "1e7vNivWk2To6BdYJt5RGF"], ["Lips", "c3PEmGVddwsc6bKqtuR7rC"], ["Face", "tm9VSS61JdHJGtKvbjKa4D"], ["Lashes", "4zqsNnG4Tp7xZThAEpv2dN"], ["Brows", "1cMbsG373EMD4ncRqGhtyZ"]],
    },
    // old links only: no tile
    { id: "backgrounds", label: "Backgrounds", tax: "ijFKKMZq6jV4gkJQC4v7L1", tile: false },
  ];
  const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
  // ids from round 1 and Roblox's old ?Category= / ?Subcategory= numbers
  const OLD_CAT = { featured: "all", heads: "faces", hats: ["accessories", "thukPQUFe5EHxRrtsgq43u"], gear: ["accessories", "gUtxkR951g3VPgRkb5ay8u"] };
  const LEGACY_CAT = { 0: "all", 1: "all", 3: "clothing", 11: "accessories", 12: "animations", 17: "all", 18: "bodies" };
  const LEGACY_SUB = { 20: "hair", 66: "faces", 37: "bodies", 54: "hats", 64: "shoes", 38: "animations", 39: "emotes", 5: "gear" };

  // Quick chips on a shelf: one choice at a time, kid-simple.
  const MODES = [
    { id: "best", label: "Best match", sort: 0, onlyQ: true },
    { id: "popular", label: "Popular", sort: 2, agg: 3 },
    { id: "new", label: "New", sort: 3 },
    { id: "free", label: "Free", sort: 2, agg: 3, free: true },
    { id: "limited", label: "Limited", sort: 2, agg: 3, limited: true },
    { id: "cheap", label: "Cheap", sort: 4, min: 1 },
  ];
  const MODE = Object.fromEntries(MODES.map((m) => [m.id, m]));
  const OLD_SORT = { relevance: null, favorites: "popular", bestselling: "popular", new: "new", low: "cheap", high: "popular" };
  const LEGACY_SORT = { 0: null, 1: "popular", 2: "popular", 3: "new", 4: "cheap", 5: "popular" };

  const ASSET_TYPES = {
    2: "T-Shirt", 8: "Hat", 11: "Shirt", 12: "Pants", 17: "Head", 18: "Face", 19: "Gear", 24: "Animation",
    27: "Torso", 28: "Right Arm", 29: "Left Arm", 30: "Left Leg", 31: "Right Leg", 41: "Hair",
    42: "Face Accessory", 43: "Neck Accessory", 44: "Shoulder Accessory", 45: "Front Accessory",
    46: "Back Accessory", 47: "Waist Accessory", 48: "Climb Animation", 50: "Fall Animation",
    51: "Idle Animation", 52: "Jump Animation", 53: "Run Animation", 54: "Swim Animation",
    55: "Walk Animation", 56: "Pose Animation", 61: "Emote", 64: "T-Shirt", 65: "Shirt", 66: "Pants",
    67: "Jacket", 68: "Sweater", 69: "Shorts", 70: "Left Shoe", 71: "Right Shoe", 72: "Dress or Skirt",
    76: "Eyebrows", 77: "Eyelashes", 78: "Mood", 79: "Head", 88: "Face Makeup", 89: "Lip Makeup", 90: "Eye Makeup",
  };
  const BUNDLE_TYPES = { 1: "Body", 2: "Animation Pack", 3: "Shoes", 4: "Face", 5: "Face", BodyParts: "Body", AvatarAnimations: "Animation Pack", Shoes: "Shoes", DynamicHead: "Face", DynamicHeadAvatar: "Face" };
  const BUNDLE_TYPE_NUM = { BodyParts: 1, AvatarAnimations: 2, Shoes: 3, DynamicHead: 4, DynamicHeadAvatar: 5 };
  // try-on: asset types a still picture can show, and the ones that take a
  // slot (wearing a new one replaces the old one)
  const SHOWABLE = new Set([2, 8, 11, 12, 17, 18, 27, 28, 29, 30, 31, 41, 42, 43, 44, 45, 46, 47, 64, 65, 66, 67, 68, 69, 70, 71, 72, 76, 77, 79, 88, 89, 90]);
  const ONE_SLOT = new Set([2, 11, 12, 17, 18, 27, 28, 29, 30, 31, 41, 70, 71, 76, 77, 78, 79, 88, 89, 90]);
  const LAYERED = new Set([64, 65, 66, 67, 68, 69, 70, 71, 72]);
  const PAGE_SIZE = 60;

  // ------------------------------------------------------------ data
  // One queue for catalog.roblox.com: one call in flight; a 429 waits 2 s,
  // 4 s, 8 s before giving up. A queued call whose view is gone is skipped
  // (returns undefined) so a fresh page never waits behind an old one.
  const memo = new Map();
  const inflight = new Map();
  let busy = false;
  const waiting = [];
  const slot = () => (busy ? new Promise((r) => waiting.push(r)) : ((busy = true), Promise.resolve()));
  const release = () => (waiting.length ? waiting.shift()() : (busy = false));
  const SS = "cer:cat:";
  function cacheGet(key, ttl) {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
    try {
      const s = sessionStorage.getItem(SS + key);
      if (s) {
        const o = JSON.parse(s);
        if (Date.now() - o.t < ttl) {
          memo.set(key, o);
          return o.v;
        }
      }
    } catch {
      /* storage off */
    }
    return undefined;
  }
  function cacheSet(key, v) {
    const o = { t: Date.now(), v };
    memo.set(key, o);
    try {
      const s = JSON.stringify(o);
      if (s.length < 300000) sessionStorage.setItem(SS + key, s);
    } catch {
      /* quota: memory cache still works */
    }
  }
  function cat(url, { ttl = 300000, alive } = {}) {
    const hit = cacheGet(url, ttl);
    if (hit !== undefined) return Promise.resolve(hit);
    if (inflight.has(url)) return inflight.get(url);
    const p = (async () => {
      await slot();
      let v = null;
      try {
        if (alive && !alive()) return undefined;
        for (let attempt = 0; attempt < 4; attempt++) {
          let res = null;
          try {
            res = await fetch(url, { credentials: "include" });
          } catch {
            res = null;
          }
          if (res?.status === 429 && attempt < 3) {
            await api.sleep(2000 * 2 ** attempt);
            if (alive && !alive()) return undefined;
            continue;
          }
          v = res?.ok ? await res.json().catch(() => null) : null;
          break;
        }
      } finally {
        release();
        inflight.delete(url);
      }
      if (v != null) cacheSet(url, v);
      return v;
    })();
    inflight.set(url, p);
    return p;
  }

  // Rows seen in any list, by "Asset:123" / "Bundle:45". The item page paints
  // from these at once instead of asking the catalog again.
  const ROWS = new Map();
  const rowKey = (kind, id) => kind + ":" + id;
  const kindOf = (it) => (it.itemType === "Bundle" ? "Bundle" : "Asset");
  function keepRows(list) {
    for (const it of list ?? []) if (it && it.id && it.name) ROWS.set(rowKey(kindOf(it), it.id), it);
    if (ROWS.size > 1500) for (const k of [...ROWS.keys()].slice(0, 500)) ROWS.delete(k);
    return list;
  }

  // Search. st: { q, cat, sub, mode, creator }. Returns { data, next },
  // null on failure, undefined when skipped (view gone).
  async function search(st, cursor, opts = {}) {
    const p = new URLSearchParams();
    const c = own(CAT, st.cat) ? CAT[st.cat] : CAT.all;
    const m = modeOf(st);
    p.set("taxonomy", st.sub || c.tax);
    p.set("salesTypeFilter", m.limited ? "2" : "1");
    p.set("limit", String(opts.limit ?? PAGE_SIZE));
    if (st.q) p.set("keyword", st.q);
    // a typed search ranks by match inside Free / Limited too
    const sort = st.q && (m.free || m.limited) ? 0 : m.sort;
    if (sort) {
      p.set("sortType", String(sort));
      if (m.agg) p.set("sortAggregation", String(m.agg));
    }
    if (m.free) {
      p.set("minPrice", "0");
      p.set("maxPrice", "0");
    } else if (m.min || opts.paid) p.set("minPrice", "1");
    if (st.creator) p.set("creatorName", st.creator);
    if (cursor) p.set("cursor", cursor);
    const j = await cat("https://catalog.roblox.com/v2/search/items/details?" + p, { alive: opts.alive });
    if (j === undefined) return undefined;
    return j ? { data: keepRows((j.data ?? []).filter((x) => x && typeof x === "object" && x.name)), next: j.nextPageCursor ?? null } : null;
  }
  const modeOf = (st) => (own(MODE, st.mode) ? MODE[st.mode] : st.q ? MODE.best : MODE.popular);

  // One catalog row (same shape as search, plus owned).
  const itemRow = (kind, id) => cat(`https://catalog.roblox.com/v1/catalog/items/${id}/details?itemType=${kind}`, { ttl: 60000 });

  // ------------------------------------------------------------ helpers
  const slug = (name) =>
    String(name ?? "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item";
  const itemHref = (kind, id, name) => `https://www.roblox.com/${kind === "Bundle" ? "bundles" : "catalog"}/${id}/${slug(name)}`;
  const creatorHref = (type, id) => (String(type) === "Group" || type === 2 ? `https://www.roblox.com/communities/${id}` : `https://www.roblox.com/users/${id}/profile`);
  const isGroup = (type) => String(type) === "Group" || type === 2;
  const robux = (n) => h("span", { class: "ct-robux" }, ui.icon("robux", 16), h("span", { text: fmt.full(n) }));
  // Item picture that retries: the thumbnail API is shared and sometimes
  // answers 429 for a whole batch, which would leave cards blank for good.
  function art(kind, id) {
    const img = h("img", { class: "cer-img", alt: "", loading: "lazy", decoding: "async", draggable: "false" });
    const tryLoad = (n) =>
      api.thumb(kind, id).then((u) => {
        if (u) {
          img.addEventListener("load", () => img.classList.add("cer-img-in"), { once: true });
          img.src = u;
        } else if (n < 3) setTimeout(() => tryLoad(n + 1), 1500 * 2 ** n);
      });
    tryLoad(0);
    return img;
  }
  const bg = (url) => `url("${String(url).replace(/"/g, "")}")`;

  // Price facts for a search/details row.
  function priceOf(it) {
    const r = it.itemRestrictions ?? [];
    const limited = r.includes("LimitedUnique") ? "Unique" : r.includes("Limited") || r.includes("Collectible") ? "Limited" : null;
    const off = it.priceStatus === "Off Sale" || it.priceStatus === "No Resellers";
    let price = null, state = "sale", fromResale = false;
    if (limited) {
      // still sold by the creator (in stock), else the cheapest reseller
      const original = !off && it.price != null && (it.unitsAvailableForConsumption > 0 || !it.totalQuantity);
      const resale = it.lowestResalePrice > 0 ? it.lowestResalePrice : it.hasResellers && it.lowestPrice > 0 ? it.lowestPrice : 0;
      if (original) it.price > 0 ? (price = it.price) : (state = "free");
      else if (resale) (price = resale), (fromResale = true);
      else state = "off";
    } else if (it.priceStatus === "Free" || (it.price === 0 && !off)) state = "free";
    else if (off || it.price == null) state = "off";
    else price = it.price;
    const left = limited && it.totalQuantity > 0 && it.unitsAvailableForConsumption > 0 ? it.unitsAvailableForConsumption : null;
    const timed = it.offSaleDeadline && new Date(it.offSaleDeadline) > Date.now() ? it.offSaleDeadline : null;
    return { limited, price, state, left, timed, fromResale };
  }
  function priceNode(p, cls = "") {
    if (p.state === "free") return h("span", { class: "ct-price is-free " + cls, text: "Free" });
    if (p.state === "off") return h("span", { class: "ct-price is-off " + cls, text: "Off sale" });
    return h("span", { class: "ct-price " + cls }, robux(p.price));
  }
  // "Ends in 3 days" for timed items
  function endsIn(date) {
    const s = (new Date(date).getTime() - Date.now()) / 1000;
    if (!(s > 0)) return "";
    const [n, u] = s >= 86400 ? [Math.floor(s / 86400), "day"] : s >= 3600 ? [Math.floor(s / 3600), "hour"] : [Math.max(1, Math.floor(s / 60)), "min"];
    return `Ends in ${n} ${u}${n === 1 ? "" : "s"}`;
  }
  const creatorTag = (c, size = "sm", href = false) =>
    ui.nameTag({ type: isGroup(c.type) ? "group" : "user", id: c.id, name: c.name ?? "", verified: !!c.verified, size, href: href ? creatorHref(c.type, c.id) : undefined, cls: "ct-by" });
  const rowCreator = (it) => ({ id: it.creatorTargetId, name: it.creatorName ?? "", type: it.creatorType, verified: !!it.creatorHasVerifiedBadge });

  // SPA link: plain left clicks inside the shop stay client-side.
  function spaLink(el, url) {
    el.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      // Roblox's body click handler would push a second copy of this URL
      e.stopPropagation();
      go(url);
    });
    return el;
  }

  // Item card: big art, name, price + creator.
  function itemCard(it) {
    const kind = kindOf(it);
    const p = priceOf(it);
    const href = itemHref(kind, it.id, it.name);
    return spaLink(
      h(
        "a",
        { class: "ct-card", href, title: it.name },
        h("div", { class: "ct-card-art" }, art(kind === "Bundle" ? "bundle" : "asset", it.id), p.limited && h("span", { class: "ct-tag", text: p.limited })),
        h("div", { class: "ct-card-name", text: it.name ?? "" }),
        h("div", { class: "ct-card-meta" }, priceNode(p), creatorTag(rowCreator(it)))
      ),
      href
    );
  }
  const cardSkeletons = (n) =>
    Array.from({ length: n }, () => h("div", { class: "ct-card is-sk", "aria-hidden": "true" }, h("div", { class: "ct-card-art cer-sk" }), h("div", { class: "cer-sk cer-sk-line" }), h("div", { class: "cer-sk cer-sk-line short" })));
  const railOf = (items) => ui.rail(items.map(itemCard), { item: 184 });
  const railSkeleton = () => h("div", { class: "ct-rail-sk" }, cardSkeletons(8));

  // ------------------------------------------------------------ router
  // S.lists: shop views kept alive by URL (front + shelves), so Back shows
  // them as they were. S.browse is the one shown last.
  const S = { key: null, browse: null, lists: new Map(), item: null };
  const keyNow = () => location.pathname + location.search;
  function keepList(entry) {
    S.lists.delete(entry.key);
    S.lists.set(entry.key, entry);
    while (S.lists.size > 6) S.lists.delete(S.lists.keys().next().value);
  }

  function go(url) {
    const u = new URL(url, location.origin);
    const site = (host) => host.replace(/^www\./i, "").toLowerCase();
    if (u.protocol !== location.protocol || site(u.host) !== site(location.host)) return void (location.href = url);
    if (u.pathname + u.search === keyNow()) return;
    saveBrowse();
    // Roblox's page script swaps our history.state, so remember the hop here
    S.fromBrowse = ours() ? itemKey(u.pathname) : null;
    S.pushing = true;
    try {
      history.pushState({ cer: TAG }, "", u.pathname + u.search);
    } finally {
      S.pushing = false;
    }
    render();
  }
  function saveBrowse() {
    if (S.browse && S.browse.view.isConnected) S.browse.scrollY = window.scrollY;
  }

  function fixRobloxUrl() {
    const q = new URLSearchParams(location.search);
    if (!(S.browse?.view.isConnected && /^\/catalog\/?$/i.test(location.pathname) && (q.has("taxonomy") || q.has("salesTypeFilter")))) return false;
    history.replaceState(history.state, "", S.browse.key);
    S.key = keyNow();
    return true;
  }
  // it does that a moment after load and after Back, so check a few times
  const guardUrl = () => [250, 800, 2000].forEach((ms) => setTimeout(fixRobloxUrl, ms));

  async function start() {
    const root = document.getElementById("cer-app");
    // our own pushState / replaceState already rendered this URL
    if (S.key === keyNow() && root?.dataset.page === TAG && root.firstChild) return;
    // Roblox's hidden catalog app rewrites the URL to its own params
    // (?taxonomy=...&salesTypeFilter=1) after load. Put ours back, no rebuild.
    if (fixRobloxUrl()) return;
    // same item, only the slug changed
    if (S.item && root?.firstChild === S.item.view && itemKey(S.key) && itemKey(S.key) === itemKey(keyNow())) {
      S.key = keyNow();
      return;
    }
    saveBrowse();
    render();
  }

  function render() {
    unguard?.(); // a pending shelf-scroll restore must not fight the next view
    const path = location.pathname;
    let m;
    S.key = keyNow();
    if ((m = path.match(/^\/catalog\/(\d+)(\/|$)/i))) return itemPage("Asset", m[1]);
    if ((m = path.match(/^\/bundles\/(\d+)(\/|$)/i))) return itemPage("Bundle", m[1]);
    if (/^\/(catalog|bundles)\/?$/i.test(path)) return browsePage();
    S.key = null;
    ui.release(); // some other /catalog/... page: Roblox's own
  }

  // Back / Forward between our own views: render now instead of waiting for
  // the shared 300 ms URL poll (ui.route's later call sees S.key and skips).
  // Roblox's hidden catalog app pushes its own copies of the page we show
  // (the item again, or the list with its own URL params) and can swallow
  // popstate for them, so where the Navigation API exists we follow its
  // traverse events and tag Roblox's pushes as copies (its entry state is
  // ours alone; Roblox only rewrites history.state).
  const NAV = (() => {
    try {
      return window.navigation?.currentEntry ? window.navigation : null;
    } catch {
      return null;
    }
  })();
  const ours = () => document.getElementById("cer-app")?.dataset.page === TAG;
  const itemKey = (k) => k?.match(/^\/(catalog|bundles)\/(\d+)/i)?.slice(1, 3).join(":").toLowerCase() ?? null;
  const viewOf = (k) => itemKey(k) ?? (/^\/(catalog|bundles)\/?(\?|$)/i.test(k) ? "list" : "other");

  // dir: -1 back, 1 forward, 0 unknown; dup: the entry is Roblox's copy
  function onHistoryMove(dir, dup) {
    if (!ours()) return;
    if (!/^\/(catalog|bundles)(\/|$)/i.test(location.pathname) || /[?&]cer=native\b/.test(location.search)) return;
    // one view can own several entries: walk past the extras so Back and
    // Forward take one press
    const sameItem = S.item?.view.isConnected && itemKey(S.key) && itemKey(S.key) === itemKey(keyNow());
    const sameList = S.browse?.view.isConnected && (dup || S.browse.key === keyNow());
    if (sameItem || sameList) {
      // no Navigation API: Roblox's copy of an item carries { referrer }
      const back = dir ? dir < 0 : sameItem && !history.state?.referrer;
      if (back) history.back();
      else if (dir > 0 && dup) history.forward();
      else if (sameList && S.browse.key !== keyNow()) history.replaceState(history.state, "", S.browse.key);
      S.key = keyNow();
      return;
    }
    saveBrowse();
    render();
  }

  if (NAV) {
    NAV.addEventListener("currententrychange", (e) => {
      const cur = NAV.currentEntry;
      if (e.navigationType === "traverse") return onHistoryMove(Math.sign(cur.index - (e.from?.index ?? cur.index)), !!cur.getState()?.cerDup);
      // our own updateCurrentEntry below fires this too: ignore it
      if (e.navigationType !== "push" && e.navigationType !== "replace") return;
      // a replaceState (ours or Roblox's) drops the tag, so carry it over
      const copy = e.navigationType === "push" ? !S.pushing && ours() : !!e.from?.getState()?.cerDup;
      if (!copy) return;
      NAV.updateCurrentEntry({ state: { cerDup: true } });
      // Roblox's copy can land late, after a quick Back, with the item's slug
      // as a relative URL (/that-item-name): put back the URL of what we show
      const showing = S.item?.view.isConnected ? itemKey(S.key) : S.browse?.view.isConnected ? "list" : null;
      if (e.navigationType === "push" && showing && viewOf(keyNow()) !== showing) history.replaceState(history.state, "", S.key);
    });
  }
  // Roblox's catalog scripts still load (only their mount point is gone) and
  // answer Back by pushing their own copy of the list, which wipes Forward.
  // While a view of ours shows, page scripts do not get popstate (capture on
  // window runs first). shared.js's URL poll still sees the change.
  const ourRoute = () => ours() && /^\/(catalog|bundles)(\/|$)/i.test(location.pathname) && !/[?&]cer=native\b/.test(location.search);
  window.addEventListener(
    "popstate",
    (e) => {
      if (!ourRoute()) return;
      e.stopImmediatePropagation();
      if (!NAV) onHistoryMove(0, false);
    },
    true
  );

  // Restore a shelf's scroll. Roblox's page script smooth-scrolls to the top
  // about half a second after a history change, and the height settles over a
  // few frames, so for 2.5 s every frame puts the scroll back. Wheel, touch,
  // keys or a pointer press hand control back to the user at once.
  let unguard = null;
  const USER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"];
  function restoreScroll(view, y) {
    unguard?.();
    const until = performance.now() + 2500;
    let raf = 0;
    const tick = () => {
      if (!view.isConnected || performance.now() > until) return stop();
      if (Math.abs(window.scrollY - y) > 2) window.scrollTo({ top: y, behavior: "instant" });
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      for (const ev of USER_INPUT) removeEventListener(ev, stop, true);
      unguard = null;
    };
    for (const ev of USER_INPUT) addEventListener(ev, stop, { capture: true, passive: true });
    unguard = stop;
    tick();
  }

  function show(view) {
    const root = ui.mount(TAG);
    try {
      history.scrollRestoration = "manual"; // we restore the shelf scroll ourselves
    } catch {
      /* not allowed */
    }
    root.replaceChildren(view);
    return root;
  }

  // ------------------------------------------------------------ state <-> URL
  function readState() {
    const q = new URLSearchParams(location.search);
    const get = (...ks) => {
      for (const k of ks) {
        const v = q.get(k);
        if (v != null) return v;
      }
      return null;
    };
    let catId = get("cat");
    let sub = get("sub") ?? "";
    if (own(OLD_CAT, catId)) {
      const o = OLD_CAT[catId];
      [catId, sub] = Array.isArray(o) ? [o[0], sub || o[1]] : [o, sub];
    }
    if (!own(CAT, catId)) {
      const tax = get("taxonomy");
      const top = tax && CATS.find((c) => c.tax === tax);
      const subNum = get("Subcategory", "subcategory");
      let legacy = own(LEGACY_SUB, subNum) ? LEGACY_SUB[subNum] : null;
      if (own(OLD_CAT, legacy)) {
        const o = OLD_CAT[legacy];
        [legacy, sub] = Array.isArray(o) ? o : [o, sub];
      }
      const legacyCat = get("Category", "category");
      catId = top ? top.id : legacy ?? (own(LEGACY_CAT, legacyCat) ? LEGACY_CAT[legacyCat] : "all");
      if (tax && !top) {
        // a sub-taxonomy from Roblox's own links: find its parent
        const parent = CATS.find((c) => c.subs?.some((s) => s[1] === tax));
        if (parent) catId = parent.id;
        sub = tax;
      }
    }
    if (sub && !/^[A-Za-z0-9]{8,40}$/.test(sub)) sub = "";
    let mode = get("show");
    if (!own(MODE, mode)) {
      const s = get("sort");
      const t = get("SortType", "sortType");
      mode = own(OLD_SORT, s) ? OLD_SORT[s] : own(LEGACY_SORT, t) ? LEGACY_SORT[t] : null;
      if (get("free") === "1") mode = "free";
      if (get("limited") === "1" || get("salesTypeFilter", "SalesTypeFilter") === "2") mode = "limited";
    }
    const st = {
      q: (get("Keyword", "keyword") ?? "").trim().slice(0, 100),
      cat: catId,
      sub,
      mode,
      creator: (get("creator", "CreatorName", "creatorName") ?? "").trim().slice(0, 50),
    };
    if (st.mode === "best" && !st.q) st.mode = null;
    return st;
  }
  function stateUrl(st) {
    const q = new URLSearchParams();
    if (st.q) q.set("Keyword", st.q);
    if (st.cat && st.cat !== "all") q.set("cat", st.cat);
    if (st.sub) q.set("sub", st.sub);
    if (st.mode && !(st.mode === "best" && !st.q)) q.set("show", st.mode);
    if (st.creator) q.set("creator", st.creator);
    const s = q.toString();
    return "/catalog" + (s ? "?" + s : "");
  }
  const blank = () => ({ q: "", cat: "all", sub: "", mode: null, creator: "" });
  const isFront = (st) => !st.q && st.cat === "all" && !st.sub && !st.mode && !st.creator;

  // ------------------------------------------------------------ shop views
  function browsePage() {
    let key = keyNow();
    const st = readState();
    // one clean URL in our own format (Roblox-style links are accepted too)
    if (stateUrl(st) !== key) {
      history.replaceState(history.state, "", stateUrl(st));
      S.key = key = keyNow();
    }
    const hit = S.lists.get(key);
    if (hit) {
      S.browse = hit;
      S.item = null;
      show(hit.view);
      document.title = hit.title;
      // Roblox renames the tab a moment after Back
      setTimeout(() => hit.view.isConnected && (document.title = hit.title), 1500);
      restoreScroll(hit.view, hit.scrollY ?? 0);
      guardUrl();
      return;
    }
    const view = h("div", { class: "cer-view ct-view " + (isFront(st) ? "ct-front" : "ct-shelf") });
    const entry = { key, view, scrollY: 0, title: "Catalog" };
    S.browse = entry;
    S.item = null;
    keepList(entry);
    guardUrl();
    show(view);
    window.scrollTo(0, 0);
    if (isFront(st)) buildFront(entry);
    else buildShelf(entry, st);
    document.title = entry.title;
  }

  // Big search field. In a category it searches that category.
  function searchBar(st) {
    const c = own(CAT, st.cat) && st.cat !== "all" ? CAT[st.cat] : null;
    const box = ui.search(c ? "Search " + c.label.toLowerCase() : "Search hair, faces, clothes and more", {
      value: st.q,
      class: "ct-search",
      delay: 300,
      onSubmit: (v) => {
        if (v === st.q) return;
        go(stateUrl(v ? { ...blank(), q: v, cat: st.cat, sub: st.sub } : { ...blank(), cat: st.cat, sub: st.sub }));
      },
    });
    box.input.setAttribute("enterkeyhint", "search");
    return h("div", { class: "ct-top" }, box);
  }

  // Category art tiles (front) and the compact category bar (shelves).
  function catTiles() {
    const tiles = CATS.filter((c) => c.tile !== false).map((c) => {
      const href = "https://www.roblox.com" + stateUrl({ ...blank(), cat: c.id });
      return spaLink(h("a", { class: "ct-tile", href }, h("span", { class: "ct-tile-art" }, art(c.art[0], c.art[1])), h("span", { class: "ct-tile-name", text: c.label })), href);
    });
    const r = ui.rail(tiles, { item: 138 });
    r.classList.add("ct-tiles");
    return r;
  }
  function catBar(st) {
    const bar = h(
      "nav",
      { class: "ct-catbar" },
      CATS.filter((c) => c.id === "all" || c.tile !== false || c.id === st.cat).map((c) => {
        const next = c.id === "all" && !st.q && !st.creator ? blank() : { ...blank(), q: st.q, creator: st.creator, cat: c.id };
        const href = "https://www.roblox.com" + stateUrl(next);
        const on = c.id === st.cat;
        return spaLink(
          h(
            "a",
            { class: "ct-pill" + (on ? " is-on" : ""), href, "aria-current": on ? "page" : null },
            c.art ? h("span", { class: "ct-pill-art" }, art(c.art[0], c.art[1])) : h("span", { class: "ct-pill-art is-icon" }, ui.icon("grid", 16)),
            h("span", { text: c.label })
          ),
          href
        );
      })
    );
    // keep the chosen one in sight
    requestAnimationFrame(() => {
      const on = bar.querySelector(".is-on");
      if (on && on.offsetLeft + on.offsetWidth > bar.clientWidth) bar.scrollLeft = on.offsetLeft - 24;
    });
    return bar;
  }

  // ---- front: spotlight, tiles, rails
  function buildFront(entry) {
    const { view } = entry;
    const alive = () => view.isConnected;
    const hero = h("section", { class: "ct-hero is-loading" }, h("div", { class: "ct-hero-bg" }), h("div", { class: "ct-hero-shade" }));
    const rails = [
      { title: "Popular now", mode: "popular" },
      { title: "New", mode: "new" },
      { title: "Free", mode: "free" },
      { title: "Limiteds", mode: "limited" },
    ].map((r) => {
      const href = stateUrl({ ...blank(), mode: r.mode });
      const sec = ui.section(r.title, { action: { label: "See all", href: "https://www.roblox.com" + href } });
      spaLink(sec.head.querySelector(".cer-link"), href);
      sec.classList.add("ct-railsec");
      sec.body.append(railSkeleton());
      return { ...r, sec };
    });
    view.append(searchBar(blank()), hero, catTiles(), ...rails.map((r) => r.sec));

    // Popular feeds the spotlight AND its rail: one call
    let popP = null;
    const popular = () => (popP ??= search({ ...blank(), mode: "popular" }, null, { limit: 30, alive, paid: true }).then((r) => (r === undefined && (popP = null), r)));
    const spot = () =>
      popular().then((res) => {
        if (res === undefined) return void ui.whenVisible(hero, spot);
        fillSpotlight(hero, spotPicks(res?.data));
      });
    spot();
    for (const r of rails) {
      const load = () => {
        const p = r.mode === "popular" ? popular() : search({ ...blank(), mode: r.mode }, null, { limit: 30, alive });
        p.then((res) => {
          if (res === undefined) return void ui.whenVisible(r.sec, load); // skipped while away: try when back
          // Popular: what the spotlight did not take
          const shown = r.mode === "popular" ? new Set(spotPicks(res?.data)) : null;
          fillRail(r.sec, shown ? res?.data?.filter((x) => !shown.has(x)) : res?.data);
        });
      };
      r.mode === "popular" ? load() : ui.whenVisible(r.sec, load);
    }
  }
  // the spotlight shows things you can see on a still picture (no emotes,
  // no animations: those are grey stick figures)
  const MOVES = new Set([24, 48, 50, 51, 52, 53, 54, 55, 56, 61]);
  const spotPicks = (list) => (list ?? []).filter((x) => (kindOf(x) === "Bundle" ? Number(x.bundleType) !== 2 : !MOVES.has(x.assetType))).slice(0, 5);
  function fillRail(sec, items) {
    if (!items) return void sec.body.replaceChildren(ui.empty("The shop is busy. Try again soon.", { icon: "refresh" }));
    if (!items.length) return void sec.remove();
    sec.body.replaceChildren(railOf(items));
  }

  // Spotlight: one big item with its art, four more to flip through.
  function fillSpotlight(hero, items) {
    if (!items.length) return void hero.remove();
    hero.classList.remove("is-loading");
    const bgEl = hero.querySelector(".ct-hero-bg");
    const stage = h("a", { class: "ct-hero-art" });
    const name = h("h1", { class: "ct-hero-name" });
    const by = h("div", { class: "ct-hero-by" });
    const price = h("div", { class: "ct-hero-price" });
    const cta = ui.button("See it", { variant: "light", size: "lg", class: "ct-hero-cta", href: "#" });
    const picks = h("div", { class: "ct-hero-picks" });
    let at = 0;
    const paint = (i) => {
      at = i;
      const it = items[i];
      const kind = kindOf(it);
      const href = itemHref(kind, it.id, it.name);
      const thumbKind = kind === "Bundle" ? "bundle" : "asset";
      const img = art(thumbKind, it.id);
      stage.href = cta.href = href;
      stage.replaceChildren(img);
      api.thumb(thumbKind, it.id).then((u) => u && items[at] === it && (bgEl.style.backgroundImage = bg(u)));
      name.textContent = it.name;
      ui.clear(by, creatorTag(rowCreator(it), "md"));
      ui.clear(price, priceNode(priceOf(it), "is-big"));
      [...picks.children].forEach((b, j) => b.classList.toggle("is-on", j === i));
    };
    for (const el of [stage, cta])
      el.addEventListener("click", (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(el.href);
      });
    picks.append(
      ...items.map((it, i) =>
        h("button", { type: "button", class: "ct-hero-pick", title: it.name, "aria-label": it.name, onClick: () => (paint(i), (paused = true)) }, art(kindOf(it) === "Bundle" ? "bundle" : "asset", it.id))
      )
    );
    hero.append(h("div", { class: "ct-hero-text" }, h("span", { class: "ct-hero-eyebrow", text: "Popular now" }), name, by, price, cta), stage, picks);
    paint(0);
    // flips every 6 s while nobody is pointing at it
    let paused = false;
    hero.addEventListener("pointerenter", () => (paused = true));
    hero.addEventListener("pointerleave", () => (paused = false));
    const timer = setInterval(() => {
      if (!hero.isConnected) {
        // kept views come back; stop only once this one is dropped
        if (![...S.lists.values()].some((e) => e.view.contains(hero))) clearInterval(timer);
        return;
      }
      if (!paused && !document.hidden) paint((at + 1) % items.length);
    }, 6000);
  }

  // ---- shelf: one category / search / creator, big grid
  function buildShelf(entry, st) {
    const { view } = entry;
    const alive = () => view.isConnected;
    const c = own(CAT, st.cat) ? CAT[st.cat] : CAT.all;
    const ALL_TITLES = { popular: "Popular now", new: "New", free: "Free", limited: "Limiteds", cheap: "Cheap" };
    const title = st.creator || (st.q ? "“" + st.q + "”" : c.id === "all" ? ALL_TITLES[modeOf(st).id] ?? "Catalog" : c.label);
    entry.title = (st.q || st.creator || c.label) + " - Catalog";
    const head = h(
      "div",
      { class: "ct-shelf-head" },
      h("h1", { class: "ct-shelf-title" }, h("span", { text: title }), st.creator && ui.button("", { icon: "x", variant: "ghost", size: "sm", title: "Everyone", onClick: () => update({ creator: "" }, true) })),
      h("div", { class: "ct-modes" })
    );
    const modes = head.lastChild;
    const subs = h("div", { class: "ct-subs" });
    const grid = h("div", { class: "ct-grid" });
    const sentinel = h("div", { class: "ct-sentinel" });
    view.append(searchBar(st), catBar(st), head, subs, grid, sentinel);

    function paintChips() {
      const cur = modeOf(st).id;
      ui.clear(
        modes,
        MODES.filter((m) => !m.onlyQ || st.q).map((m) => ui.chip(m.label, { active: m.id === cur, onClick: () => m.id !== cur && update({ mode: m.id }) }))
      );
      ui.clear(
        subs,
        c.subs && [
          ui.chip("All", { active: !st.sub, onClick: () => st.sub && update({ sub: "" }) }),
          c.subs.map(([label, tax]) => ui.chip(label, { active: st.sub === tax, onClick: () => st.sub !== tax && update({ sub: tax }) })),
        ]
      );
      subs.hidden = !c.subs;
    }

    let token = 0, cursor = null, loading = false, done = false, count = 0, gotFirst = false;
    const seen = new Set();
    async function loadPage() {
      if (loading || done) return;
      const first = !gotFirst;
      loading = true;
      const my = token;
      const sk = first ? [] : cardSkeletons(6);
      grid.append(...sk);
      const res = await search(st, first ? null : cursor, { alive });
      if (my !== token) return;
      loading = false;
      for (const s of sk) s.remove();
      if (res === undefined) return; // left before it ran: the sentinel retries
      if (first) grid.replaceChildren();
      gotFirst = true;
      if (!res) {
        if (first) {
          grid.classList.add("is-empty");
          grid.replaceChildren(ui.empty("The shop is busy. Try again soon.", { icon: "refresh", action: ui.button("Try again", { variant: "soft", icon: "refresh", onClick: () => reload() }) }));
        }
        return;
      }
      const fresh = res.data.filter((it) => {
        const k = it.itemType + it.id;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      count += fresh.length;
      grid.append(...fresh.map(itemCard));
      cursor = res.next;
      done = !cursor;
      if (first && !count) {
        grid.classList.add("is-empty");
        grid.replaceChildren(
          ui.empty(st.q ? "Nothing found. Try other words." : "Nothing here yet.", {
            icon: "search",
            action: (st.q && st.cat !== "all") || st.sub || st.mode ? ui.button("Show everything", { variant: "soft", onClick: () => go(stateUrl({ ...blank(), q: st.q })) }) : null,
          })
        );
      }
      // the sentinel may still be on screen (short page): keep going
      if (!done) requestAnimationFrame(() => near() && loadPage());
    }
    const near = () => sentinel.isConnected && sentinel.getBoundingClientRect().top < window.innerHeight + 900;
    new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && !loading && !done && loadPage(), { rootMargin: "900px" }).observe(sentinel);

    function reload() {
      token++;
      loading = false;
      done = false;
      cursor = null;
      count = 0;
      gotFirst = false;
      seen.clear();
      grid.classList.remove("is-empty");
      grid.replaceChildren(...cardSkeletons(18));
      loadPage();
    }
    // chips change this shelf in place (no new history entry)
    function update(patch, rebuild) {
      Object.assign(st, patch);
      const url = stateUrl(st);
      if (rebuild || isFront(st)) return go(url);
      S.lists.delete(entry.key);
      history.replaceState(history.state, "", url);
      S.key = entry.key = keyNow();
      keepList(entry);
      paintChips();
      window.scrollTo({ top: 0, behavior: "instant" });
      reload();
    }
    paintChips();
    reload();
  }

  // ------------------------------------------------------------ item page
  async function itemPage(kind, id) {
    const view = h("div", { class: "cer-view ct-view ct-item" });
    S.item = { view };
    show(view);
    window.scrollTo(0, 0);
    // stale = another page took over (the slug fix below changes the URL
    // of THIS item, which must not count)
    const myItem = kind + ":" + id;
    const itemOf = (k) => {
      const m = k?.match(/^\/(catalog|bundles)\/(\d+)/i);
      return m ? (m[1].toLowerCase() === "bundles" ? "Bundle" : "Asset") + ":" + m[2] : null;
    };
    const stale = () => itemOf(S.key) !== myItem || S.item?.view !== view;
    const alive = () => !stale();
    const thumbKind = kind === "Bundle" ? "bundle" : "asset";

    // shell right away
    const fromShop = S.fromBrowse === itemKey(keyNow());
    const back = ui.button("", { icon: "arrowLeft", variant: "ghost", class: "ct-back", title: "Back", href: "https://www.roblox.com" + (S.browse?.key ?? "/catalog") });
    back.addEventListener("click", (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (fromShop) history.back();
      else go("/catalog");
    });
    const backdrop = h("div", { class: "ct-item-bg" });
    const pic = art(thumbKind, id);
    const stage = h("div", { class: "ct-stage" }, pic);
    const info = h("div", { class: "ct-info" }, h("div", { class: "cer-sk ct-sk-title" }), h("div", { class: "cer-sk cer-sk-line short" }), h("div", { class: "cer-sk ct-sk-price" }), h("div", { class: "cer-sk ct-sk-btn" }));
    const top = h("section", { class: "ct-item-top" }, backdrop, h("div", { class: "ct-item-shade" }), stage, info);
    const below = h("div", { class: "ct-item-below" });
    view.append(back, top, below);
    api.thumb(thumbKind, id).then((u) => u && (backdrop.style.backgroundImage = bg(u)));
    // a sharper picture for the big stage (assets go up to 700 px)
    if (kind === "Asset")
      api.json(`https://thumbnails.roblox.com/v1/assets?assetIds=${id}&size=700x700&format=Webp&isCircular=false`, { ttl: 600000 }).then((j) => {
        const u = j?.data?.[0]?.state === "Completed" && j.data[0].imageUrl;
        if (u && !stale()) {
          const big = ui.img(u, { alt: "" });
          big.addEventListener("load", () => !stale() && pic.isConnected && pic.replaceWith(big), { once: true });
          big.classList.add("ct-preload");
          stage.append(big);
          big.addEventListener("load", () => big.classList.remove("ct-preload"), { once: true });
        }
      });

    // data: a row from the list we came from paints at once
    const row0 = ROWS.get(rowKey(kind, id)) ?? null;
    const rowP = row0 ? Promise.resolve(row0) : itemRow(kind, id);
    const primaryP =
      kind === "Asset"
        ? api.json(`https://economy.roblox.com/v2/assets/${id}/details`, { ttl: 60000 })
        : rowP.then((r) => (r ? null : cat(`https://catalog.roblox.com/v1/bundles/${id}/details`, { ttl: 60000 })));
    // the catalog row says `owned` when signed in; inventory otherwise
    const ownedP = Promise.all([api.me(), rowP]).then(([me, row]) =>
      !me ? null : typeof row?.owned === "boolean" ? row.owned : api.json(`https://inventory.roblox.com/v1/users/${me.id}/items/${kind}/${id}/is-owned`)
    );

    let primary = null, row = row0;
    if (!row0)
      await new Promise((done) => {
        let left = 2;
        const one = (p, set) =>
          p.then((v) => {
            set(v);
            if (v || !--left) done();
          });
        one(primaryP, (v) => (primary = v));
        one(rowP, (v) => (row = v));
      });
    if (stale()) return;
    const it = normalize(kind, id, primary, row);
    if (!it) {
      ui.clear(info, ui.empty("We could not load this item.", { icon: "box", action: ui.button("Open on Roblox", { variant: "light", icon: "external", href: ui.nativeUrl() }) }));
      return;
    }
    // Roblox's hidden app renames the tab a moment later; say it once more
    const title = it.name + " - Catalog";
    document.title = title;
    setTimeout(() => !stale() && (document.title = title), 1500);
    // canonical slug, without a reload
    const want = new URL(itemHref(kind, id, it.name)).pathname;
    if (location.pathname !== want && !location.search) {
      history.replaceState(history.state, "", want);
      S.key = keyNow();
    }
    const parts = renderInfo(it, stage, pic, stale);
    ui.clear(info, parts.nodes);

    // enhance as the rest arrives
    Promise.all([primaryP, rowP]).then(([a, r]) => {
      if (stale() || (a === primary && r === row)) return;
      Object.assign(it, normalize(kind, id, a, r) ?? {});
      parts.refresh();
      if (kind === "Bundle" && it.bundleItems?.length && !below.querySelector(".ct-inside")) below.prepend(bundleSection(it));
    });
    ownedP.then((o) => !stale() && o === true && parts.setOwned());

    // what is inside a bundle
    if (kind === "Bundle" && it.bundleItems?.length) below.append(bundleSection(it));
    // rails, lazily
    const likeThis = ui.section("More like this");
    const creatorUrl = stateUrl({ ...blank(), creator: it.creator.name });
    const fromCreator = ui.section("More from " + it.creator.name, { action: { label: "See all", href: "https://www.roblox.com" + creatorUrl } });
    spaLink(fromCreator.head.querySelector(".cer-link"), creatorUrl);
    for (const s of [likeThis, fromCreator]) {
      s.classList.add("ct-railsec");
      s.body.append(railSkeleton());
    }
    below.append(likeThis, fromCreator);
    ui.whenVisible(likeThis, () => loadRecs(likeThis, it, alive));
    ui.whenVisible(fromCreator, () => loadCreatorRail(fromCreator, it, alive));
  }

  // Merge the asset/bundle details call (primary) and the catalog row into one model.
  function normalize(kind, id, a, row) {
    if (!a && !row) return null;
    const it = { kind, id: Number(id) };
    if (kind === "Asset" && a) {
      const col = a.CollectiblesItemDetails;
      Object.assign(it, {
        name: a.Name,
        description: a.Description,
        typeLabel: ASSET_TYPES[a.AssetTypeId] ?? "Item",
        assetType: a.AssetTypeId,
        creator: { id: a.Creator?.CreatorTargetId ?? a.Creator?.Id, name: a.Creator?.Name ?? "", type: a.Creator?.CreatorType, verified: !!a.Creator?.HasVerifiedBadge },
      });
      const lim = a.IsLimitedUnique ? "Unique" : a.IsLimited || col?.IsLimited ? "Limited" : null;
      const forSale = col ? col.IsForSale || a.IsForSale : a.IsForSale;
      const resale = col?.CollectibleLowestResalePrice || null;
      it.p = {
        limited: lim,
        state: forSale ? (a.PriceInRobux ? "sale" : "free") : resale ? "sale" : "off",
        price: forSale ? a.PriceInRobux || null : resale,
        fromResale: !forSale && !!resale,
        left: lim && forSale && a.Remaining > 0 ? a.Remaining : null,
        timed: null,
      };
    } else if (kind === "Bundle" && a) {
      const col = a.collectibleItemDetail;
      Object.assign(it, {
        name: a.name,
        description: a.description,
        typeLabel: BUNDLE_TYPES[a.bundleType] ?? "Bundle",
        bundleType: typeof a.bundleType === "number" ? a.bundleType : BUNDLE_TYPE_NUM[a.bundleType],
        creator: { id: a.creator?.id, name: a.creator?.name ?? "", type: a.creator?.type, verified: !!a.creator?.hasVerifiedBadge },
        bundleItems: a.items ?? [],
      });
      const pr = a.product ?? {};
      const forSale = col ? col.saleStatus === "OnSale" : pr.isForSale;
      const price = col ? col.price : pr.priceInRobux;
      const resale = col?.lowestResalePrice || null;
      const lim = col?.totalQuantity > 0 ? "Limited" : null;
      it.p = {
        limited: lim,
        state: forSale ? (price ? "sale" : "free") : resale ? "sale" : "off",
        price: forSale ? price || null : resale,
        fromResale: !forSale && !!resale,
        left: lim && forSale && col.unitsAvailable > 0 ? col.unitsAvailable : null,
        timed: col?.offSaleDeadline && new Date(col.offSaleDeadline) > Date.now() ? col.offSaleDeadline : null,
      };
    }
    if (row) {
      // the catalog row is fresher for price and badges
      const p = priceOf(row);
      it.name ??= row.name;
      it.description ??= row.description;
      it.typeLabel ??= row.itemType === "Bundle" ? BUNDLE_TYPES[row.bundleType] ?? "Bundle" : ASSET_TYPES[row.assetType] ?? "Item";
      it.assetType ??= row.assetType;
      it.bundleType ??= row.bundleType;
      it.creator ??= rowCreator(row);
      if (row.favoriteCount != null) it.favorites = row.favoriteCount;
      const prev = it.p ?? {};
      it.p = {
        ...prev,
        limited: p.limited ?? prev.limited ?? null,
        state: p.state,
        price: p.price,
        fromResale: p.fromResale,
        left: p.left ?? prev.left ?? null,
        timed: p.timed ?? prev.timed ?? null,
      };
      if (!it.bundleItems && row.bundledItems) it.bundleItems = row.bundledItems;
    }
    it.creator ??= { id: null, name: "", type: "User", verified: false };
    return it;
  }

  // Name, creator, price, one big button; Try on swaps the stage picture.
  function renderInfo(it, stage, pic, stale) {
    const type = h("div", { class: "ct-info-type" });
    const title = h("h1", { class: "ct-info-name", text: it.name });
    const by = h("div", { class: "ct-info-by" }, creatorTag(it.creator, "md", !!it.creator.id));
    const fav = h("span", { class: "ct-info-fav", title: "Favorites" });
    const priceRow = h("div", { class: "ct-info-price" });
    const actions = h("div", { class: "ct-info-actions" });
    const desc = (it.description ?? "").trim();
    const about = desc ? h("div", { class: "ct-info-desc" }, ui.clamp(desc, 3)) : null;
    let owned = false;
    const tryOn = makeTryOn(it, stage, pic, stale);

    function paint() {
      const p = it.p ?? { state: "off" };
      ui.clear(type, h("span", { text: it.typeLabel ?? "" }), p.limited && h("span", { class: "ct-tag", text: p.limited }), owned && h("span", { class: "ct-tag is-owned", text: "Owned" }));
      ui.clear(fav, it.favorites > 0 && [ui.icon("heart", 15), h("span", { text: fmt.num(it.favorites) })]);
      if (!fav.parentNode && it.favorites > 0) by.append(fav);
      const notes = [p.left != null && fmt.num(p.left) + " left", p.fromResale && "From sellers", p.timed && endsIn(p.timed)].filter(Boolean);
      ui.clear(priceRow, !owned && priceNode(p, "is-big"), !owned && notes.length > 0 && h("span", { class: "ct-info-note", text: notes.join(" · ") }));
      priceRow.hidden = owned;
      const native = ui.nativeUrl(itemHref(it.kind, it.id, it.name));
      const wearable = !(it.kind === "Asset" && it.assetType === 19);
      let main = null;
      if (owned) main = wearable ? ui.button("Wear it", { variant: "light", size: "lg", class: "ct-buy", href: "https://www.roblox.com/my/avatar" }) : null;
      else if (p.state === "free") main = ui.button("Get it free", { variant: "light", size: "lg", class: "ct-buy", href: native });
      else if (p.state === "sale") main = ui.button(p.fromResale ? "See sellers" : "Buy", { variant: "light", size: "lg", icon: p.fromResale ? null : "robux", class: "ct-buy", href: native });
      ui.clear(actions, main, tryOn.button);
    }
    paint();
    return {
      nodes: [type, title, by, priceRow, actions, about],
      refresh: () => (tryOn.sync(), paint()),
      setOwned: () => {
        owned = true;
        paint();
      },
    };
  }

  // ---- try-on: your avatar wearing this, drawn by Roblox's avatar renderer.
  // Only a picture: nothing is saved to your avatar.
  const RENDER = "https://avatar.roblox.com/v1/avatar/render";
  function canTry(it) {
    if (it.kind === "Asset") return SHOWABLE.has(it.assetType);
    return [1, 3, 4, 5].includes(Number(it.bundleType));
  }
  function makeTryOn(it, stage, pic, stale) {
    const button = ui.button("Try on", { variant: "glass", size: "lg", icon: "user", class: "ct-try" });
    let on = false, shot = null, busy = false;
    const sync = () => {
      button.hidden = !canTry(it);
    };
    sync();
    api.me().then((me) => !me && (button.hidden = true));
    const set = (next) => {
      on = next;
      stage.classList.toggle("is-on", on);
      button.querySelector("span").textContent = on ? "Show item" : "Try on";
      button.classList.toggle("is-on", on);
    };
    button.addEventListener("click", async () => {
      if (busy) return;
      if (on) {
        set(false);
        return;
      }
      if (shot) return set(true);
      busy = true;
      button.busy(true);
      stage.classList.add("is-trying");
      const url = await renderOn(it).catch(() => null);
      busy = false;
      button.busy(false);
      stage.classList.remove("is-trying");
      if (stale()) return;
      if (!url) {
        CER.toast?.("Could not show it on you. Try again.", "error");
        return;
      }
      shot = ui.img(url, { alt: "You wearing " + it.name, class: "ct-stage-me" });
      stage.append(shot);
      set(true);
    });
    return { button, sync };
  }
  async function wornAssets(it) {
    if (it.kind === "Asset") return [{ id: it.id, type: it.assetType }];
    // a bundle's outfit lists its parts with their types
    const outfit = (it.bundleItems ?? []).find((x) => x.type === "UserOutfit");
    if (outfit) {
      const o = await api.json(`https://avatar.roblox.com/v1/outfits/${outfit.id}/details`, { ttl: 600000 });
      if (o?.assets?.length) return o.assets.map((a) => ({ id: a.id, type: a.assetType?.id, meta: a.meta }));
    }
    return (it.bundleItems ?? []).filter((x) => x.type === "Asset").map((x) => ({ id: x.id, type: null }));
  }
  async function renderOn(it) {
    const me = await api.me();
    if (!me) return null;
    const [av, add] = await Promise.all([api.json("https://avatar.roblox.com/v2/avatar/avatar", { ttl: 60000 }), wornAssets(it)]);
    if (!av?.assets) return null;
    const slots = new Set(add.filter((a) => ONE_SLOT.has(a.type)).map((a) => a.type));
    const assets = av.assets.filter((a) => !slots.has(a.assetType?.id)).map((a) => (a.meta ? { id: a.id, meta: a.meta } : { id: a.id }));
    let order = Math.max(0, ...assets.map((a) => a.meta?.order ?? 0));
    for (const a of add) {
      if (assets.some((x) => x.id === a.id)) continue;
      const meta = a.meta ?? (LAYERED.has(a.type) ? { order: ++order, version: 1 } : null);
      assets.push(meta ? { id: a.id, meta } : { id: a.id });
    }
    const c = av.bodyColor3s ?? {};
    const hex = (v) => "#" + String(v ?? "a3a2a5").replace(/^#/, "");
    const body = {
      thumbnailConfig: { thumbnailId: 1, thumbnailType: "2d", size: "420x420" },
      avatarDefinition: {
        assets,
        bodyColors: { headColor: hex(c.headColor3), torsoColor: hex(c.torsoColor3), rightArmColor: hex(c.rightArmColor3), leftArmColor: hex(c.leftArmColor3), rightLegColor: hex(c.rightLegColor3), leftLegColor: hex(c.leftLegColor3) },
        scales: av.scales,
        playerAvatarType: { playerAvatarType: av.playerAvatarType },
      },
    };
    for (let i = 0; i < 14; i++) {
      const r = await api.json(RENDER, { method: "POST", body });
      if (r?.state === "Completed" && r.imageUrl) return r.imageUrl;
      if (!r || /blocked|error/i.test(r.state ?? "")) return null;
      await api.sleep(1300);
    }
    return null;
  }

  function bundleSection(it) {
    const parts = (it.bundleItems ?? []).filter((x) => x.type === "Asset");
    const s = ui.section("In this bundle");
    s.classList.add("ct-inside");
    s.body.append(
      h(
        "div",
        { class: "ct-inside-list" },
        parts.map((x) => {
          const href = itemHref("Asset", x.id, x.name);
          return spaLink(h("a", { class: "ct-inside-item", href, title: x.name }, h("div", { class: "ct-inside-art" }, art("asset", x.id)), h("span", { class: "ct-inside-name", text: x.name })), href);
        })
      )
    );
    return s;
  }

  async function loadCreatorRail(sec, it, alive) {
    if (!it.creator.name) return void sec.remove();
    const res = await search({ ...blank(), creator: it.creator.name, mode: "popular" }, null, { limit: 30, alive });
    if (res === undefined || !alive()) return;
    fillRail(sec, res && res.data.filter((x) => !(x.id === it.id && kindOf(x) === it.kind)).slice(0, 24));
  }

  async function loadRecs(sec, it, alive) {
    const url =
      it.kind === "Bundle"
        ? `https://catalog.roblox.com/v2/recommendations/bundles?numItems=24&details=true&bundleId=${it.id}&bundleTypeId=${it.bundleType ?? 1}`
        : `https://catalog.roblox.com/v2/recommendations/assets?numItems=24&details=true&assetId=${it.id}&assetTypeId=${it.assetType ?? 8}`;
    const j = await cat(url, { ttl: 600000, alive });
    if (j === undefined || !alive()) return;
    fillRail(sec, j && keepRows((j.data ?? []).filter((x) => x && typeof x === "object" && x.name && String(x.id) !== String(it.id))));
  }

  ui.route(TAG, start);
})();
