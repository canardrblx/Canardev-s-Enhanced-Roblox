// CER trades page (/trades). VIEW ONLY. Built on CER.ui (content/ui.js).
// Data from trades.roblox.com (list + v2 details). Every trade action
// (accept, decline, counter, cancel, new trade) is Roblox's own page:
// ui.nativeUrl(). CER never builds or presses a trade action.
//
//   tabs    Inbound · Outbound · Completed · Inactive
//   card    the other player (avatar + name), when, then two sides:
//           what you give | what you get (item art, value, Robux)

(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;
  const TAG = "trades";
  const RB = "https://www.roblox.com";

  ui.route(TAG, start);
  let runId = 0;

  const TABS = [
    { id: "Inbound", label: "Inbound" },
    { id: "Outbound", label: "Outbound" },
    { id: "Completed", label: "Completed" },
    { id: "Inactive", label: "Inactive" },
  ];
  const STATUS = { Declined: "Declined", Expired: "Expired", Countered: "Countered", RejectedDueToError: "Failed", Completed: "Done", Pending: "Waiting", InterventionRequired: "On hold", Processing: "Processing" };

  // ---------------------------------------------------------------- data
  // Trade list page, read directly so Roblox's own reason can be shown when
  // this account cannot trade. → { data, cursor } | { message, status }
  async function listPage(type, cursor) {
    const url = `https://trades.roblox.com/v1/trades/${type}?limit=25&sortOrder=Desc${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`;
    for (let i = 0; i < 3; i++) {
      let r;
      try {
        r = await fetch(url, { credentials: "include" });
      } catch {
        return { status: 0 };
      }
      if (r.status === 429 && i < 2) {
        await api.sleep(800 * (i + 1));
        continue;
      }
      const j = await r.json().catch(() => null);
      if (r.ok && Array.isArray(j?.data)) return { data: j.data, cursor: j.nextPageCursor ?? "" };
      return { status: r.status, message: j?.errors?.[0]?.message ?? "" };
    }
    return { status: 429 };
  }

  // Trade details, one request at a time (the trades API limit is tight).
  let chain = Promise.resolve();
  function detail(tid, ttl) {
    const url = `https://trades.roblox.com/v2/trades/${tid}`;
    const p = chain.then(async () => {
      let j = await api.json(url, { ttl });
      if (!j) {
        await api.sleep(2000);
        j = await api.json(url, { ttl });
      }
      await api.sleep(150);
      return j;
    });
    chain = p.catch(() => null);
    return p;
  }

  // ---------------------------------------------------------------- page
  async function start() {
    const run = ++runId;
    const meP = api.me();
    const { page } = ui.page(TAG, "tr");
    const alive = () => run === runId && page.isConnected;
    const tabHost = h("div", { class: "tr-tabbar" });
    const body = h("div", { class: "tr-body" }, ui.skeleton("row", 3).map((s) => (s.classList.add("tr-sk-card"), s)));
    page.append(ui.header({ title: "Trades" }), tabHost, body);
    document.title = "Trades - Roblox";

    const me = await meP;
    if (!alive()) return;
    // only a real 401/403 means signed out; anything else is a hiccup
    if (!me) return CER.loggedOut ? ui.release() : body.replaceChildren(retryEmpty("Could not load. Try again.", start));

    const panels = {};
    const show = (tab) => {
      if (!TABS.some((t) => t.id === tab)) tab = "Inbound";
      tabs.set(tab);
      // a tab whose first load failed builds again when picked again
      if (panels[tab]?.dataset.failed) {
        panels[tab].remove();
        delete panels[tab];
      }
      for (const k in panels) panels[k].hidden = k !== tab;
      if (!panels[tab]) {
        panels[tab] = h("div", { class: "tr-panel" });
        body.appendChild(panels[tab]);
        listPanel(panels[tab], tab);
      }
      try {
        history.replaceState(history.state, "", location.pathname + location.search + "#!/" + tab.toLowerCase());
      } catch {
        /* sandboxed */
      }
    };
    const tabs = ui.tabs(TABS, "Inbound", show);
    const fromHash = TABS.find((t) => location.hash.toLowerCase().includes(t.id.toLowerCase()))?.id;

    // first list read tells whether this account can trade at all
    const first = fromHash ?? "Inbound";
    const firstPage = await listPage(first, "");
    if (!alive()) return;
    if (!firstPage.data) {
      if (firstPage.status === 401) return ui.release();
      // 403: Roblox says this account cannot trade (its reason shows); a
      // retry will not change that. Anything else may pass on a second try.
      const blocked = firstPage.status === 403;
      body.replaceChildren(
        ui.empty(firstPage.message || "Trades did not load. Try again soon.", {
          icon: blocked ? "lock" : "info",
          action: blocked
            ? ui.button("Open Roblox page", { variant: "soft", icon: "external", href: ui.nativeUrl(RB + "/trades") })
            : ui.button("Try again", { variant: "soft", icon: "refresh", onClick: () => start() }),
        })
      );
      return;
    }
    tabHost.appendChild(tabs);
    body.replaceChildren();
    const prefetched = { [first]: firstPage };
    show(first);

    function listPanel(panel, type) {
      const list = h("div", { class: "tr-list" });
      const foot = h("div", { class: "tr-foot" });
      panel.append(list, foot);
      let cursor = "";
      let count = 0;
      let loading = false; // a double click must not add the same page twice
      const load = async () => {
        if (loading) return;
        loading = true;
        try {
          await loadOnce();
        } finally {
          loading = false;
        }
      };
      const loadOnce = async () => {
        const sk = ui.skeleton("row", count ? 1 : 3);
        [sk].flat().forEach((s) => (s.classList.add("tr-sk-card"), list.append(s)));
        let res = prefetched[type];
        delete prefetched[type];
        res ??= await listPage(type, cursor);
        [sk].flat().forEach((s) => s.remove());
        if (!alive()) return;
        if (!res.data) {
          if (!count) {
            panel.dataset.failed = "1";
            return panel.replaceChildren(
              retryEmpty(res.message || "Could not load trades.", () => {
                delete panel.dataset.failed;
                panel.replaceChildren(list, foot);
                load();
              })
            );
          }
          const more = ui.button("Load more", { variant: "soft", icon: "refresh" });
          more.addEventListener("click", () => {
            more.busy(true);
            load();
          });
          return foot.replaceChildren(more);
        }
        list.append(...res.data.map((t) => tradeCard(t, type)));
        count += res.data.length;
        cursor = res.cursor;
        if (!count) return panel.replaceChildren(ui.empty(type === "Inbound" ? "No trades for you right now." : "No trades here.", { icon: "box" }));
        if (!cursor) return foot.replaceChildren();
        const sentinel = h("div", { class: "tr-sentinel" });
        foot.replaceChildren(sentinel);
        ui.whenVisible(sentinel, load);
      };
      load();
    }

    function tradeCard(t, type) {
      const other = t.user ?? {};
      const active = type === "Inbound" || type === "Outbound";
      const when = active && t.expiration ? endsText(t.expiration) : fmt.ago(t.created);
      const profile = `${RB}/users/${other.id}/profile`;
      const action =
        type === "Inbound"
          ? ui.button("Answer on Roblox", { variant: "soft", size: "sm", icon: "external", href: ui.nativeUrl(RB + "/trades") })
          : type === "Outbound"
          ? ui.button("Open on Roblox", { variant: "ghost", size: "sm", icon: "external", href: ui.nativeUrl(RB + "/trades") })
          : null;
      const status = type === "Inactive" && STATUS[t.status] ? h("span", { class: "tr-status is-" + String(t.status).toLowerCase(), text: STATUS[t.status] }) : null;
      const give = side("You give");
      const get = side("You get");
      const card = h(
        "article",
        { class: "tr-card" },
        h(
          "header",
          { class: "tr-card-head" },
          h("a", { href: profile, class: "tr-card-avatar" }, ui.avatar(other.id, { size: 44 })),
          h(
            "div",
            { class: "tr-card-who" },
            ui.nameTag({ type: "user", id: other.id, name: other.displayName ?? other.name ?? "", sub: other.name ? "@" + other.name : null, size: "md", href: profile }),
            h("span", { class: "tr-when", text: when })
          ),
          status,
          action
        ),
        h("div", { class: "tr-sides" }, give.el, h("div", { class: "tr-swap" }, ui.icon("arrowRight", 20)), get.el)
      );
      const fillCard = async () => {
        const d = await detail(t.id, active ? 30000 : 600000);
        if (!card.isConnected) return;
        if (!d) {
          give.fail();
          get.fail(() => (give.wait(), get.wait(), fillCard()));
          return;
        }
        const offers = [d.participantAOffer, d.participantBOffer].filter(Boolean);
        const mine = offers.find((o) => String(o.user?.id) === String(me.id)) ?? offers[0];
        const theirs = offers.find((o) => o !== mine);
        give.fill(mine);
        get.fill(theirs);
      };
      ui.whenVisible(card, fillCard);
      return card;
    }
  }

  // Failed load: say so, with a Try again button.
  function retryEmpty(text, again) {
    return ui.empty(text, { icon: "refresh", action: ui.button("Try again", { variant: "soft", icon: "refresh", onClick: () => again() }) });
  }

  // One side of a trade: label, item art grid, total value.
  function side(label) {
    const total = h("span", { class: "tr-total" });
    const items = h("div", { class: "tr-items" }, ui.skeleton("tile", 2));
    const el = h("div", { class: "tr-side" }, h("div", { class: "tr-side-head" }, h("span", { class: "tr-side-label", text: label }), total), items);
    return {
      el,
      wait: () => items.replaceChildren(ui.skeleton("tile", 2)),
      fail: (again) =>
        ui.clear(items, h("span", { class: "tr-side-none", text: "Could not load." }), again && ui.button("Try again", { variant: "ghost", size: "sm", icon: "refresh", onClick: again })),
      fill: (offer) => {
        const list = offer?.items ?? [];
        const robux = offer?.robux ?? 0;
        const tiles = list.map(tradeItem);
        if (robux > 0) tiles.push(h("div", { class: "tr-item is-robux", title: fmt.full(robux) + " Robux" }, h("div", { class: "tr-item-art" }, ui.icon("robux", 40)), h("span", { class: "tr-item-name", text: "Robux" }), h("span", { class: "tr-item-value" }, ui.icon("robux", 12), h("span", { text: fmt.full(robux) }))));
        items.replaceChildren(...(tiles.length ? tiles : [h("span", { class: "tr-side-none", text: "Nothing" })]));
        const value = list.reduce((s, it) => s + (it.recentAveragePrice ?? 0), 0) + robux;
        if (value > 0) total.replaceChildren(ui.icon("robux", 14), h("span", { text: fmt.full(value) }));
      },
    };
  }

  function tradeItem(it) {
    const tgt = it.itemTarget ?? {};
    const isBundle = /bundle/i.test(tgt.itemType ?? "");
    const id = tgt.targetId ?? it.assetId;
    return h(
      "a",
      { class: "tr-item", href: `${RB}/${isBundle ? "bundles" : "catalog"}/${id}`, title: it.itemName ?? it.name ?? "" },
      h("div", { class: "tr-item-art" }, ui.thumb(isBundle ? "bundle" : "asset", id, { alt: "" }), it.serialNumber && h("span", { class: "tr-serial", text: "#" + fmt.full(it.serialNumber) })),
      h("span", { class: "tr-item-name", text: it.itemName ?? it.name ?? "" }),
      it.recentAveragePrice != null && h("span", { class: "tr-item-value" }, ui.icon("robux", 12), h("span", { text: fmt.num(it.recentAveragePrice) }))
    );
  }

  function endsText(date) {
    const ms = new Date(date).getTime() - Date.now();
    if (!(ms > 0)) return "Ending now";
    const hrs = Math.floor(ms / 3600000);
    if (hrs < 1) return "Ends in under an hour";
    if (hrs < 24) return `Ends in ${hrs} hour${hrs === 1 ? "" : "s"}`;
    const days = Math.floor(hrs / 24);
    return `Ends in ${days} day${days === 1 ? "" : "s"}`;
  }
})();
