// CER catalog page. Built on CER.ui (content/ui.js).
//
//   /catalog, /catalog?Keyword=...   browse: search, category chips, sort,
//                                    filters, item grid with infinite scroll
//   /catalog/{id}/{slug}             item page
//   /bundles/{id}/{slug}             bundle page (with the items inside)
//
// Data comes only from Roblox's web APIs. Buying is NOT done here: the Buy /
// Get button opens the same item with ui.nativeUrl() so Roblox's own buy flow
// runs. Moving between browse and items is client-side (pushState) and the
// browse view is kept in memory, so Back is instant and keeps the scroll.
//
// Catalog search + item details share a strict rate limit (a few calls per
// burst), so all catalog.roblox.com calls go through one small queue with a
// real 429 backoff, and results are memo-cached.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;
  const TAG = "catalog";

  // ------------------------------------------------------------ constants
  // Top chips. tax = catalog taxonomy id (what Roblox's own catalog sends).
  const CATS = [
    { id: "featured", label: "Featured", tax: "tZsUsd2BqGViQrJ9Vs3Wah" },
    { id: "clothing", label: "Clothing", tax: "5G3bZScC9Hxp2D2EUtGSNm", subs: true },
    { id: "accessories", label: "Accessories", tax: "wNYJso48d1XnhMyFWT3oX3", subs: true },
    { id: "hair", label: "Hair", tax: "d6a7M7r9MMrpf7z7VxW9ZS" },
    { id: "heads", label: "Heads", tax: "s5NLP7BS9PRLKvUVca4XKg" },
    { id: "bodies", label: "Bodies", tax: "kfHzJwaNYM8s2CWRqYUhRa" },
    { id: "hats", label: "Hats", tax: "thukPQUFe5EHxRrtsgq43u", hidden: true },
    { id: "shoes", label: "Shoes", tax: "uLRgNoJ1awZkhpVw9WyvKo" },
    { id: "animations", label: "Animations", tax: "whf6kUVBwk2xdwKUmRYN6G" },
    { id: "emotes", label: "Emotes", tax: "ioNxAT977DFP2hMnAJbsbF" },
    { id: "makeup", label: "Makeup", tax: "dBM565GC3YYTdi9UKvr87Z", subs: true },
    // reachable by URL (old links), not shown as chips: kept the row short
    { id: "backgrounds", label: "Backgrounds", tax: "ijFKKMZq6jV4gkJQC4v7L1", hidden: true },
    { id: "gear", label: "Gear", tax: "gUtxkR951g3VPgRkb5ay8u", hidden: true },
  ];
  const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
  // Roblox's old ?Category= numbers, so links from elsewhere still land right
  const LEGACY_CAT = { 0: "featured", 1: "featured", 3: "clothing", 11: "accessories", 12: "animations", 17: "featured", 18: "bodies" };
  const LEGACY_SUB = { 20: "hair", 66: "heads", 37: "bodies", 54: "hats", 64: "shoes", 38: "animations", 39: "emotes", 5: "gear" };

  const SORTS = [
    { id: "relevance", label: "Best match", type: 0 },
    { id: "favorites", label: "Most favorited", type: 1, agg: 5 },
    { id: "bestselling", label: "Bestselling", type: 2, agg: 3 },
    { id: "new", label: "Newest", type: 3 },
    { id: "low", label: "Price: low to high", type: 4 },
    { id: "high", label: "Price: high to low", type: 5 },
  ];
  const SORT = Object.fromEntries(SORTS.map((s) => [s.id, s]));
  const LEGACY_SORT = { 0: "relevance", 1: "favorites", 2: "bestselling", 3: "new", 4: "low", 5: "high" };

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
  const BUNDLE_TYPES = { 1: "Body", 2: "Animation Pack", 3: "Shoes", 4: "Head", 5: "Head", BodyParts: "Body", AvatarAnimations: "Animation Pack", Shoes: "Shoes", DynamicHead: "Head", DynamicHeadAvatar: "Head" };
  const BUNDLE_TYPE_NUM = { BodyParts: 1, AvatarAnimations: 2, Shoes: 3, DynamicHead: 4, DynamicHeadAvatar: 5 };
  const PAGE_SIZE = 60;

  // ------------------------------------------------------------ data
  // One queue for catalog.roblox.com: at most 2 calls in flight, and a 429
  // waits 1.5 s, 3 s, 6 s before giving up (Roblox resets it in seconds).
  const memo = new Map();
  let active = 0;
  const waiting = [];
  const slot = () => (active < 2 ? (active++, Promise.resolve()) : new Promise((r) => waiting.push(r)));
  const release = () => (waiting.length ? waiting.shift()() : active--);
  async function cat(url, { ttl = 180000 } = {}) {
    const key = url;
    const hit = memo.get(key);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
    await slot();
    let v = null;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        let res = null;
        try {
          res = await fetch(url, { credentials: "include" });
        } catch {
          res = null;
        }
        if (res?.status === 429 && attempt < 3) {
          await api.sleep(1500 * 2 ** attempt);
          continue;
        }
        v = res?.ok ? await res.json().catch(() => null) : null;
        break;
      }
    } finally {
      release();
    }
    if (v != null) memo.set(key, { t: Date.now(), v });
    return v;
  }

  // Search results page. Returns { data, next } or null on failure.
  async function search(st, cursor) {
    const p = new URLSearchParams();
    const c = CAT[st.cat] ?? CAT.featured;
    p.set("taxonomy", st.sub || c.tax);
    p.set("salesTypeFilter", st.limited ? "2" : "1");
    p.set("limit", String(PAGE_SIZE));
    if (st.q) p.set("keyword", st.q);
    const s = SORT[st.sort];
    if (s && s.type) {
      p.set("sortType", String(s.type));
      if (s.agg) p.set("sortAggregation", String(s.agg));
    }
    if (st.free) {
      p.set("minPrice", "0");
      p.set("maxPrice", "0");
    } else {
      if (st.min !== "") p.set("minPrice", st.min);
      if (st.max !== "") p.set("maxPrice", st.max);
    }
    if (st.offsale) p.set("includeNotForSale", "true");
    if (st.creator) p.set("creatorName", st.creator);
    if (cursor) p.set("cursor", cursor);
    const j = await cat("https://catalog.roblox.com/v2/search/items/details?" + p);
    return j ? { data: j.data ?? [], next: j.nextPageCursor ?? null } : null;
  }

  // One catalog row (same shape as search, plus owned / isPurchasable).
  const itemRow = (kind, id) => cat(`https://catalog.roblox.com/v1/catalog/items/${id}/details?itemType=${kind}`, { ttl: 60000 });

  // Sub-category chips come from Roblox's own menu (cached a day).
  let navP = null;
  const navMenu = () => (navP ??= api.json("https://catalog.roblox.com/v1/search/navigation-menu-items", { ttl: 86400000 }));

  // ------------------------------------------------------------ helpers
  const slug = (name) =>
    String(name ?? "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item";
  const itemHref = (kind, id, name) => `https://www.roblox.com/${kind === "Bundle" ? "bundles" : "catalog"}/${id}/${slug(name)}`;
  const creatorHref = (type, id) => (String(type) === "Group" || type === 2 ? `https://www.roblox.com/communities/${id}` : `https://www.roblox.com/users/${id}/profile`);
  const robux = (n, cls = "") => h("span", { class: "cat-robux " + cls }, ui.icon("robux", 15), h("span", { text: fmt.full(n) }));

  // Price + badge facts for a search/details row.
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
  function priceNode(p, big) {
    if (p.state === "free") return h("span", { class: "cat-price is-free" + (big ? " is-big" : ""), text: "Free" });
    if (p.state === "off") return h("span", { class: "cat-price is-off" + (big ? " is-big" : ""), text: "Off sale" });
    return h("span", { class: "cat-price" + (big ? " is-big" : "") }, robux(p.price));
  }
  const verified = () => h("span", { class: "cat-verified", title: "Verified" }, ui.icon("verified", 14));

  // SPA link: plain left clicks inside the catalog stay client-side.
  function spaLink(el, url) {
    el.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      go(url);
    });
    return el;
  }

  // Item tile used by the grid and the rails.
  function itemCard(it) {
    const kind = it.itemType === "Bundle" ? "Bundle" : "Asset";
    const p = priceOf(it);
    const href = itemHref(kind, it.id, it.name);
    const media = h(
      "div",
      { class: "cat-card-media" },
      h("span", { class: "cat-ph" }, ui.icon("image", 28)),
      ui.thumb(kind === "Bundle" ? "bundle" : "asset", it.id, { alt: "" }),
      p.limited && h("div", { class: "cat-card-tags" }, h("span", { class: "cat-tag is-" + p.limited.toLowerCase(), text: p.limited }))
    );
    return spaLink(
      h(
        "a",
        { class: "cat-card", href, title: it.name },
        media,
        h("div", { class: "cat-card-name", text: it.name ?? "" }),
        h("div", { class: "cat-card-price" }, priceNode(p))
      ),
      href
    );
  }
  const cardSkeletons = (n) =>
    Array.from({ length: n }, () => h("div", { class: "cat-card cat-card-sk", "aria-hidden": "true" }, h("div", { class: "cat-card-media cer-sk" }), h("div", { class: "cer-sk cer-sk-line" }), h("div", { class: "cer-sk cer-sk-line short" })));


  // ------------------------------------------------------------ router
  const S = { key: null, browse: null };
  const keyNow = () => location.pathname + location.search;

  function go(url) {
    const u = new URL(url, location.origin);
    if (u.origin !== location.origin) return void (location.href = url);
    saveBrowse();
    history.pushState({ cer: TAG }, "", u.pathname + u.search);
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
    const id = (k) => k?.match(/^\/(catalog|bundles)\/(\d+)/i)?.slice(1, 3).join(":");
    if (S.item && root?.firstChild === S.item.view && id(S.key) && id(S.key) === id(keyNow())) {
      S.key = keyNow();
      return;
    }
    saveBrowse();
    render();
  }

  function render() {
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
  window.addEventListener("popstate", () => {
    if (document.getElementById("cer-app")?.dataset.page !== TAG) return;
    if (!/^\/(catalog|bundles)(\/|$)/i.test(location.pathname) || /[?&]cer=native\b/.test(location.search)) return;
    saveBrowse();
    render();
  });

  function show(view) {
    const root = ui.mount(TAG);
    try {
      history.scrollRestoration = "manual"; // we restore the browse scroll ourselves
    } catch {
      /* not allowed */
    }
    root.replaceChildren(view);
    return root;
  }

  // ------------------------------------------------------------ browse
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
    if (!CAT[catId]) {
      const tax = get("taxonomy");
      const top = tax && CATS.find((c) => c.tax === tax);
      const legacySub = LEGACY_SUB[get("Subcategory", "subcategory")];
      catId = top ? top.id : legacySub ?? LEGACY_CAT[get("Category", "category")] ?? "featured";
      if (tax && !top) sub = tax; // a sub-taxonomy from Roblox's own links
    }
    let sort = get("sort");
    if (!SORT[sort]) sort = LEGACY_SORT[get("SortType", "sortType")] ?? "relevance";
    const num = (v) => (v != null && /^\d+$/.test(v) ? v : "");
    return {
      q: (get("Keyword", "keyword") ?? "").trim(),
      cat: catId,
      sub,
      sort,
      free: get("free") === "1",
      limited: get("limited") === "1" || get("salesTypeFilter", "SalesTypeFilter") === "2",
      offsale: get("offsale") === "1" || /^true$/i.test(get("IncludeNotForSale", "includeNotForSale") ?? ""),
      min: num(get("min", "MinPrice", "minPrice")),
      max: num(get("max", "MaxPrice", "maxPrice")),
      creator: (get("creator", "CreatorName", "creatorName") ?? "").trim(),
    };
  }
  function stateUrl(st) {
    const q = new URLSearchParams();
    if (st.q) q.set("Keyword", st.q);
    if (st.cat !== "featured") q.set("cat", st.cat);
    if (st.sub) q.set("sub", st.sub);
    if (st.sort !== "relevance") q.set("sort", st.sort);
    if (st.free) q.set("free", "1");
    if (st.limited) q.set("limited", "1");
    if (st.offsale) q.set("offsale", "1");
    if (!st.free && st.min) q.set("min", st.min);
    if (!st.free && st.max) q.set("max", st.max);
    if (st.creator) q.set("creator", st.creator);
    const s = q.toString();
    return "/catalog" + (s ? "?" + s : "");
  }

  function browsePage() {
    const key = keyNow();
    if (S.browse && S.browse.key === key) {
      show(S.browse.view);
      document.title = S.browse.title;
      window.scrollTo(0, S.browse.scrollY ?? 0);
      guardUrl();
      return;
    }
    const st = readState();
    // one clean URL in our own format (Roblox-style links are accepted too)
    if (stateUrl(st) !== key) {
      history.replaceState(history.state, "", stateUrl(st));
      S.key = keyNow();
    }
    const view = h("div", { class: "cer-view cat-view cat-browse" });
    const B = (S.browse = { key: keyNow(), view, scrollY: 0, title: "Catalog" });
    guardUrl();
    show(view);
    window.scrollTo(0, 0);

    // --- header: title + big search
    const searchBox = ui.search("Search the catalog", {
      value: st.q,
      class: "cat-search",
      onSubmit: (v) => update({ q: v }),
      onInput: (v) => !v && st.q && update({ q: "" }),
      delay: 300,
    });
    const head = h("header", { class: "cat-head" }, h("h1", { class: "cat-title", text: "Catalog" }), searchBox);

    // --- category chips + sub chips
    const catRow = ui.chips(
      CATS.filter((c) => !c.hidden || c.id === st.cat).map((c) => ({ id: c.id, label: c.label })),
      st.cat,
      (id) => update({ cat: id, sub: "" }),
      { wrap: true }
    );
    catRow.classList.add("cat-cats");
    const subRow = h("div", { class: "cat-subs" });

    // --- toolbar: filters left, sort right
    const sortSel = ui.select(SORTS, st.sort, (v) => update({ sort: v }));
    const filterChip = (label, keyName, icon) => {
      const c = ui.chip(label, { icon, active: st[keyName] });
      c.addEventListener("click", () => update({ [keyName]: !st[keyName] }));
      return c;
    };
    const priceInput = (ph, keyName) => {
      const inp = h("input", { class: "cat-price-input", type: "number", min: "0", step: "1", inputmode: "numeric", placeholder: ph, value: st[keyName], "aria-label": ph + " price" });
      const apply = () => {
        const v = /^\d+$/.test(inp.value.trim()) ? String(Number(inp.value.trim())) : "";
        if (v !== st[keyName]) update({ [keyName]: v, free: false });
      };
      inp.addEventListener("change", apply);
      inp.addEventListener("keydown", (e) => e.key === "Enter" && apply());
      return inp;
    };
    const priceBox = h("div", { class: "cat-price-range" + (st.free ? " is-disabled" : ""), title: "Price range" }, ui.icon("robux", 16), priceInput("Min", "min"), h("span", { class: "cat-price-dash", text: "to" }), priceInput("Max", "max"));
    const tools = h("div", { class: "cat-filters" }, filterChip("Free", "free"), filterChip("Limited", "limited"), filterChip("Off sale too", "offsale"), priceBox);
    const filterCount = () => [st.free, st.limited, st.offsale, !st.free && (st.min || st.max)].filter(Boolean).length;
    const filterBtn = ui.button("Filters", { icon: "sliders", variant: "ghost", class: "cat-filter-btn" });
    const filterBadge = h("span", { class: "cat-filter-n" });
    filterBtn.append(filterBadge);
    let filtersOpen = filterCount() > 0;
    const syncFilterBtn = () => {
      const n = filterCount();
      filterBadge.textContent = n ? String(n) : "";
      filterBtn.classList.toggle("is-on", filtersOpen || n > 0);
      tools.hidden = !filtersOpen;
    };
    filterBtn.addEventListener("click", () => {
      filtersOpen = !filtersOpen;
      syncFilterBtn();
    });
    syncFilterBtn();
    const bar = h("div", { class: "cat-bar" }, catRow, h("div", { class: "cat-bar-end" }, filterBtn, sortSel));

    // --- results
    const label = h("div", { class: "cat-results-head" });
    const grid = h("div", { class: "cat-grid" });
    const more = ui.button("Load more", { variant: "soft", class: "cat-more", icon: "down" });
    const sentinel = h("div", { class: "cat-sentinel" });
    const foot = h("div", { class: "cat-foot" }, more, sentinel);
    view.append(head, h("div", { class: "cat-nav" }, bar, subRow, tools), h("section", { class: "cat-results" }, label, grid, foot));

    // --- loading
    let token = 0;
    let cursor = null;
    let loading = false;
    let done = false;
    let count = 0;
    const seen = new Set();

    function setLabel() {
      ui.clear(label, st.creator && h("span", { class: "cat-results-by" }, h("span", { text: "By " }), h("strong", { text: st.creator }), ui.button("", { icon: "x", variant: "ghost", size: "sm", title: "Show all creators", onClick: () => update({ creator: "" }) })));
      label.hidden = !st.creator;
      B.title = (st.q ? st.q + " - " : "") + "Catalog";
      document.title = B.title;
    }

    async function loadPage(first) {
      if (loading || done) return;
      loading = true;
      const my = token;
      more.busy(true);
      let sk = [];
      if (!first) {
        sk = cardSkeletons(6);
        grid.append(...sk);
      }
      const res = await search(st, first ? null : cursor);
      if (my !== token) return;
      loading = false;
      more.busy(false);
      for (const s of sk) s.remove();
      if (first) grid.replaceChildren();
      if (!res) {
        if (first) {
          grid.replaceChildren(ui.empty("The catalog is busy right now. Try again.", { icon: "refresh", action: ui.button("Try again", { variant: "soft", icon: "refresh", onClick: () => reload() }) }));
          grid.classList.add("is-empty");
        }
        more.hidden = !!first;
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
      more.hidden = done;
      if (first && !count) {
        grid.classList.add("is-empty");
        grid.replaceChildren(
          ui.empty(st.q ? "Nothing found. Try other words." : "Nothing here with these filters.", {
            icon: "search",
            action:
              (hasFilters() || st.cat !== "featured") &&
              ui.button(st.q ? "Search everything" : "Clear filters", { variant: "soft", icon: st.q ? "search" : "x", onClick: () => update({ cat: "featured", sub: "", free: false, limited: false, offsale: false, min: "", max: "", creator: "" }) }),
          })
        );
      }
      // the sentinel may still be on screen (short page): keep going
      if (!done) requestAnimationFrame(() => near() && loadPage(false));
    }
    const hasFilters = () => st.free || st.limited || st.offsale || st.min || st.max || st.creator;
    const near = () => sentinel.isConnected && sentinel.getBoundingClientRect().top < window.innerHeight + 900;

    function reload() {
      token++;
      loading = false;
      done = false;
      cursor = null;
      count = 0;
      seen.clear();
      grid.classList.remove("is-empty");
      grid.replaceChildren(...cardSkeletons(18));
      more.hidden = true;
      setLabel();
      loadPage(true);
    }

    more.addEventListener("click", () => loadPage(false));
    new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && !loading && !done && loadPage(false), { rootMargin: "900px" }).observe(sentinel);

    // --- sub chips (from Roblox's menu)
    async function renderSubs() {
      subRow.replaceChildren();
      const c = CAT[st.cat];
      if (!c?.subs) return;
      const nav = await navMenu();
      if (st.cat !== c.id) return;
      const top = nav?.categories?.find((x) => x.taxonomy === c.tax);
      const subs = (top?.subcategories ?? []).filter((s) => s.taxonomy && s.name);
      if (!subs.length) return;

      const row = ui.chips([{ id: "", label: "All" }, ...subs.map((s) => ({ id: s.taxonomy, label: s.name }))], st.sub, (id) => update({ sub: id }), { wrap: true });
      row.classList.add("cat-subchips");
      subRow.replaceChildren(row);
    }

    function update(patch) {
      Object.assign(st, patch);
      if (patch.cat) catRow.set(st.cat);
      if ("cat" in patch) renderSubs();
      if ("q" in patch && searchBox.input.value.trim() !== st.q) searchBox.input.value = st.q;
      // keep the filter controls in sync
      for (const [i, k] of ["free", "limited", "offsale"].entries()) {
        const chip = tools.querySelectorAll(":scope > .cer-chip")[i];
        chip.classList.toggle("is-active", !!st[k]);
        chip.setAttribute("aria-pressed", st[k] ? "true" : "false");
      }
      priceBox.classList.toggle("is-disabled", st.free);
      syncFilterBtn();
      const [minI, maxI] = priceBox.querySelectorAll("input");
      minI.value = st.free ? "" : st.min;
      maxI.value = st.free ? "" : st.max;
      sortSel.querySelector("select").value = st.sort;
      const url = stateUrl(st);
      history.replaceState(history.state, "", url);
      S.key = B.key = keyNow();
      reload();
    }

    renderSubs();
    reload();
  }

  // ------------------------------------------------------------ item page
  async function itemPage(kind, id) {
    const view = h("div", { class: "cer-view cat-view cat-item" });
    S.item = { view };
    show(view);
    window.scrollTo(0, 0);
    const myKey = S.key;
    const stale = () => S.key !== myKey;

    // shell with skeletons right away
    const fromBrowse = !!S.browse && history.state?.cer === TAG;
    const back = ui.button("", { icon: "arrowLeft", variant: "ghost", class: "cat-back", title: fromBrowse ? "Back" : "Catalog", href: "https://www.roblox.com" + (S.browse?.key ?? "/catalog") });
    back.addEventListener("click", (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (fromBrowse) history.back();
      else go("/catalog");
    });
    const backdrop = h("div", { class: "cat-item-backdrop" });
    const art = h("div", { class: "cat-item-art" }, h("span", { class: "cat-ph" }, ui.icon("image", 48)), ui.thumb(kind === "Bundle" ? "bundle" : "asset", id, { alt: "" }));
    const info = h("div", { class: "cat-item-info" }, h("div", { class: "cer-sk cat-sk-title" }), h("div", { class: "cer-sk cer-sk-line short" }), h("div", { class: "cer-sk cat-sk-price" }), h("div", { class: "cer-sk cat-sk-btns" }));
    const top = h("section", { class: "cat-item-top" }, backdrop, h("div", { class: "cat-item-left" }, art), info);
    const below = h("div", { class: "cat-item-below" });
    view.append(back, top, below);
    api.thumb(kind === "Bundle" ? "bundle" : "asset", id).then((url) => {
      if (url) {
        backdrop.style.backgroundImage = `url("${String(url).replace(/"/g, "")}")`;
        top.classList.add("has-image");
      }
    });

    // data, in parallel
    const primaryP = kind === "Bundle" ? api.json(`https://catalog.roblox.com/v1/bundles/${id}/details`, { ttl: 60000 }) : api.json(`https://economy.roblox.com/v2/assets/${id}/details`, { ttl: 60000 });
    const rowP = itemRow(kind, id);
    const favP = api.json(`https://catalog.roblox.com/v1/favorites/${kind === "Bundle" ? "bundles" : "assets"}/${id}/count`, { ttl: 60000 });
    // the catalog row says `owned` when signed in; inventory is the fallback
    const ownedP = Promise.all([api.me(), rowP]).then(([me, row]) =>
      !me ? null : typeof row?.owned === "boolean" ? row.owned : api.json(`https://inventory.roblox.com/v1/users/${me.id}/items/${kind}/${id}/is-owned`)
    );

    // paint from whichever source answers first, merge the other in later
    let primary = null, row = null;
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
      ui.clear(info, ui.empty("We could not load this item.", { icon: "box", action: ui.button("Open on Roblox", { variant: "soft", icon: "external", href: ui.nativeUrl() }) }));
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
    const infoParts = renderInfo(it);
    ui.clear(info, infoParts.nodes);

    // enhance as the rest arrives
    Promise.all([primaryP, rowP]).then(([a, r]) => {
      if (stale() || (a === primary && r === row)) return;
      Object.assign(it, normalize(kind, id, a, r) ?? {});
      infoParts.refresh(it);
      if (kind === "Bundle" && it.bundleItems?.length && !below.querySelector(".cat-inside")) below.prepend(bundleSection(it));
    });
    favP.then((n) => !stale() && typeof n === "number" && infoParts.setFav(n));
    ownedP.then((o) => !stale() && o === true && infoParts.setOwned());

    // bundle contents
    if (kind === "Bundle" && it.bundleItems?.length) below.append(bundleSection(it));
    // rails, lazily
    const recs = ui.section("You might also like");
    const mine = ui.section("More from " + it.creator.name, { action: { label: "See all", href: "https://www.roblox.com" + stateUrl({ ...readStateDefaults(), creator: it.creator.name }) } });
    spaLink(mine.head.querySelector(".cer-link"), stateUrl({ ...readStateDefaults(), creator: it.creator.name }));
    for (const s of [mine, recs]) s.body.append(railSkeleton());
    below.append(mine, recs);
    ui.whenVisible(mine, () => loadCreatorRail(mine, it, stale));
    ui.whenVisible(recs, () => loadRecs(recs, it, stale));
  }
  const readStateDefaults = () => ({ q: "", cat: "featured", sub: "", sort: "relevance", free: false, limited: false, offsale: false, min: "", max: "", creator: "" });

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
        created: a.Created,
        updated: a.Updated,
        sales: a.Sales,
      });
      const lim = a.IsLimitedUnique ? "Unique" : a.IsLimited || col?.IsLimited ? "Limited" : null;
      const forSale = col ? col.IsForSale || a.IsForSale : a.IsForSale;
      const resale = col?.CollectibleLowestResalePrice || null;
      it.p = {
        limited: lim,
        state: forSale ? (a.PriceInRobux ? "sale" : "free") : resale ? "sale" : "off",
        price: forSale ? a.PriceInRobux || null : resale,
        resale: forSale ? resale : null,
        fromResale: !forSale && !!resale,
        left: lim && forSale && a.Remaining > 0 ? a.Remaining : null,
        total: col?.TotalQuantity || null,
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
        bundleItems: (a.items ?? []).filter((x) => x.type === "Asset"),
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
        resale: forSale ? resale : null,
        fromResale: !forSale && !!resale,
        left: lim && forSale && col.unitsAvailable > 0 ? col.unitsAvailable : null,
        total: col?.totalQuantity || null,
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
      it.creator ??= { id: row.creatorTargetId, name: row.creatorName ?? "", type: row.creatorType, verified: !!row.creatorHasVerifiedBadge };
      it.created ??= row.itemCreatedUtc;
      if (row.favoriteCount != null) it.favorites = row.favoriteCount;
      const prev = it.p ?? {};
      it.p = {
        ...prev,
        limited: p.limited ?? prev.limited ?? null,
        state: p.state,
        price: p.price,
        fromResale: p.fromResale,
        resale: !p.fromResale && row.lowestResalePrice > 0 ? row.lowestResalePrice : null,
        left: p.left ?? prev.left ?? null,
        total: row.totalQuantity || prev.total || null,
        timed: p.timed ?? prev.timed ?? null,
      };
      if (!it.bundleItems && row.bundledItems) it.bundleItems = row.bundledItems.filter((x) => x.type === "Asset");
    }
    return it;
  }

  function renderInfo(it) {
    const tags = h("div", { class: "cat-item-tags" });
    const title = h("h1", { class: "cat-item-name", text: it.name });
    const favEl = h("span", { class: "cat-item-fav", title: "Favorites" });
    const meta = h(
      "div",
      { class: "cat-item-meta" },
      h("a", { class: "cat-item-by", href: creatorHref(it.creator.type, it.creator.id) }, h("span", { class: "cat-item-by-name", text: it.creator.name }), it.creator.verified && verified()),
      favEl
    );
    const priceRow = h("div", { class: "cat-item-price" });
    const actions = h("div", { class: "cat-item-actions" });
    const desc = (it.description ?? "").trim();
    const about = desc ? h("div", { class: "cat-item-desc" }, ui.clamp(desc, 3)) : null;
    let owned = false;
    let fav = it.favorites ?? null;

    function paint() {
      const p = it.p ?? { state: "off" };
      ui.clear(tags, p.limited && h("span", { class: "cat-tag is-" + p.limited.toLowerCase(), text: p.limited }), owned && h("span", { class: "cat-tag is-owned", text: "Owned" }));
      tags.hidden = !tags.firstChild;
      ui.clear(favEl, fav != null && [ui.icon("heart", 15), h("span", { text: fmt.num(fav) })]);
      ui.clear(priceRow, !owned && priceNode(p, true), !owned && p.left != null && h("span", { class: "cat-item-left", text: fmt.num(p.left) + " left" }));
      priceRow.hidden = owned;
      const native = ui.nativeUrl(itemHref(it.kind, it.id, it.name));
      const wearable = !(it.kind === "Asset" && it.assetType === 19);
      let main = null;
      if (owned) main = wearable ? ui.button("Wear it", { variant: "primary", size: "lg", class: "cat-buy", href: "https://www.roblox.com/my/avatar" }) : null;
      else if (p.state === "free") main = ui.button("Get", { variant: "primary", size: "lg", class: "cat-buy", href: native });
      else if (p.state === "sale") main = ui.button(p.fromResale ? "See sellers" : "Buy", { variant: "primary", size: "lg", class: "cat-buy", href: native });
      const tryOn = !owned && wearable ? ui.button("Try it on", { variant: "ghost", size: "lg", href: "https://www.roblox.com/my/avatar" }) : null;
      ui.clear(actions, main, tryOn);
    }
    paint();
    return {
      nodes: [tags, title, meta, priceRow, actions, about],
      refresh: () => {
        if (it.favorites != null && fav == null) fav = it.favorites;
        paint();
      },
      setFav: (n) => {
        fav = n;
        paint();
      },
      setOwned: () => {
        owned = true;
        paint();
      },
    };
  }

  function bundleSection(it) {
    const s = ui.section("In this bundle");
    const list = h(
      "div",
      { class: "cat-inside" },
      it.bundleItems.map((x) => {
        const href = itemHref("Asset", x.id, x.name);
        return spaLink(h("a", { class: "cat-inside-item", href, title: x.name }, h("div", { class: "cat-inside-media" }, ui.thumb("asset", x.id, { alt: "" })), h("span", { class: "cat-inside-name", text: x.name })), href);
      })
    );
    s.body.append(list);
    return s;
  }

  const railSkeleton = () => h("div", { class: "cat-rail-sk" }, cardSkeletons(7));
  function fillRail(sec, items) {
    if (!items?.length) return void sec.remove();
    sec.body.replaceChildren(ui.rail(items.map(itemCard), { item: 168 }));
    sec.style.setProperty("--rail-arrow-top", "84px");
  }

  async function loadCreatorRail(sec, it, stale) {
    const res = await search({ ...readStateDefaults(), creator: it.creator.name, sort: "favorites", offsale: false }, null);
    if (stale()) return;
    if (!res) return void sec.body.replaceChildren(ui.empty("Could not load these items.", { icon: "refresh" }));
    fillRail(sec, res.data.filter((x) => !(x.id === it.id && (x.itemType === "Bundle") === (it.kind === "Bundle"))).slice(0, 24));
  }

  async function loadRecs(sec, it, stale) {
    const url =
      it.kind === "Bundle"
        ? `https://catalog.roblox.com/v2/recommendations/bundles?numItems=24&details=true&bundleId=${it.id}&bundleTypeId=${it.bundleType ?? 1}`
        : `https://catalog.roblox.com/v2/recommendations/assets?numItems=24&details=true&assetId=${it.id}&assetTypeId=${it.assetType ?? 8}`;
    const j = await cat(url, { ttl: 600000 });
    if (stale()) return;
    if (!j) return void sec.body.replaceChildren(ui.empty("Could not load these items.", { icon: "refresh" }));
    fillRail(sec, (j.data ?? []).filter((x) => x && typeof x === "object" && x.name && String(x.id) !== String(it.id)));
  }

  ui.route(TAG, start);
})();
