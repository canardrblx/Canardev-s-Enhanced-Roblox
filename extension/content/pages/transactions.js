// CER transactions page (/transactions). Built on CER.ui (content/ui.js).
// Read-only: totals for a time frame, a breakdown of where Robux came from
// and went, and a list of transactions by type with "Load more".
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;

  const FRAMES = [
    { id: "Day", label: "Day" },
    { id: "Week", label: "Week" },
    { id: "Month", label: "Month" },
    { id: "Year", label: "Year" },
  ];
  const FRAME_WORD = { Day: "today", Week: "this week", Month: "this month", Year: "this year" };

  // List types. `api` is the economy transactionType; `pending` keeps only
  // rows Roblox has not paid out yet.
  const TYPES = [
    { id: "Purchase", label: "Purchases", icon: "bag" },
    { id: "Sale", label: "Sales", icon: "ticket" },
    { id: "Pending", label: "Pending", icon: "clock", api: "Sale", pending: true },
    { id: "AffiliateSale", label: "Commissions", icon: "link" },
    { id: "EngagementPayout", label: "Premium payouts", icon: "crown" },
    { id: "GroupPayout", label: "Group payouts", icon: "users" },
    { id: "PremiumStipend", label: "Stipends", icon: "calendar" },
    { id: "CurrencyPurchase", label: "Robux bought", icon: "robux" },
  ];

  // Totals keys → breakdown rows. Purchases-type totals come back negative.
  const BREAKDOWN = [
    ["salesTotal", "Sales", "ticket"],
    ["affiliateSalesTotal", "Commissions", "link"],
    ["premiumPayoutsTotal", "Premium payouts", "crown"],
    ["groupPayoutsTotal", "Group payouts", "users"],
    ["groupPremiumPayoutsTotal", "Group Premium payouts", "users"],
    ["premiumStipendsTotal", "Stipends", "calendar"],
    ["currencyPurchasesTotal", "Robux bought", "robux"],
    ["tradeSystemEarningsTotal", "Trades in", "refresh"],
    ["adsRevsharePayoutsTotal", "Ad earnings", "megaphone"],
    ["subscriptionsRevshareTotal", "Subscriptions", "star"],
    ["csAdjustmentTotal", "Fixes from Roblox", "info"],
    ["purchasesTotal", "Purchases", "bag"],
    ["tradeSystemCostsTotal", "Trades out", "refresh"],
    ["adSpendTotal", "Ads", "megaphone"],
    ["developerExchangeTotal", "DevEx", "wallet"],
    ["individualToGroupTotal", "Sent to groups", "users"],
    ["subscriptionsRevshareOutgoingTotal", "Subscriptions", "star"],
  ];

  const robux = (n, opts = {}) =>
    h(
      "span",
      { class: "cer-trx-rbx" + (opts.tone ? " is-" + opts.tone : "") },
      opts.sign && n > 0 ? "+" : opts.sign && n < 0 ? "−" : "",
      ui.icon("robux", opts.size ?? 15),
      h("span", { text: fmt.full(Math.abs(n ?? 0)) })
    );

  // Thumbnail for a transaction row: the item, else its game, else the other side.
  function rowThumb(t) {
    const d = t.details ?? {};
    const a = t.agent ?? {};
    const box = h("span", { class: "cer-trx-thumb" });
    const kindFor = { Asset: "asset", Bundle: "bundle", GamePass: "pass", Badge: "badge" };
    let el = null;
    if (kindFor[d.type] && d.id) el = ui.thumb(kindFor[d.type], d.id);
    else if (d.place?.universeId) el = ui.thumb("gameIcon", d.place.universeId);
    else if (a.type === "Group" && a.id) el = ui.thumb("groupIcon", a.id);
    else if (a.type === "User" && a.id) el = ui.thumb("headshot", a.id), box.classList.add("is-round");
    if (el) box.append(el);
    else box.append(ui.icon(t.transactionType === "CurrencyPurchase" ? "robux" : "box", 20)), box.classList.add("is-icon");
    return box;
  }
  function itemHref(d) {
    if (!d?.id) return d?.place?.placeId ? `https://www.roblox.com/games/${d.place.placeId}` : null;
    return (
      { Asset: `/catalog/${d.id}`, Bundle: `/bundles/${d.id}`, GamePass: `/game-pass/${d.id}`, Badge: `/badges/${d.id}` }[d.type] ??
      (d.place?.placeId ? `https://www.roblox.com/games/${d.place.placeId}` : null)
    );
  }
  function agentHref(a) {
    if (!a?.id) return null;
    return a.type === "Group" ? `/communities/${a.id}` : a.type === "User" ? `/users/${a.id}/profile` : null;
  }
  function when(date) {
    const d = new Date(date);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) + ", " + d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
  }

  function txRow(t) {
    const d = t.details ?? {};
    const a = t.agent ?? {};
    const amt = t.currency?.amount ?? 0;
    const title = d.name || d.place?.name || a.name || "Robux";
    const href = itemHref(d);
    const subBits = [];
    if (a.name) {
      const ah = agentHref(a);
      const verb = /Sale/.test(t.transactionType ?? "") ? "Bought by " : "From ";
      subBits.push(h("span", {}, verb, ah ? h("a", { href: ah, class: "cer-trx-agent", text: a.name }) : a.name));
    }
    if (d.place?.name && d.place.name !== title) subBits.push(h("span", { text: d.place.name }));
    return h(
      "div",
      { class: "cer-trx-row" },
      rowThumb(t),
      h(
        "div",
        { class: "cer-trx-main" },
        href ? h("a", { class: "cer-trx-name", href, title, text: title }) : h("span", { class: "cer-trx-name", title, text: title }),
        h("span", { class: "cer-trx-sub" }, subBits.map((b, i) => [i ? h("span", { class: "cer-trx-dot", text: "·" }) : null, b]))
      ),
      h(
        "div",
        { class: "cer-trx-end" },
        h("span", { class: "cer-trx-amt" }, t.isPending && ui.badge("Pending", "warn", "clock"), robux(amt, { sign: true, tone: amt > 0 ? "in" : amt < 0 ? "out" : null })),
        h("span", { class: "cer-trx-date", text: when(t.created) })
      )
    );
  }

  ui.route("transactions", async () => {
    const me = await api.me();
    if (!me) return ui.release();
    const { page } = ui.page("transactions", "cer-trx");

    let frame = "Month";
    let type = "Purchase";

    // ---- shell ----
    const balance = h("span", { class: "cer-trx-balance-val" }, h("span", { class: "cer-trx-sk w-l" }));
    const frameTabs = ui.tabs(FRAMES, frame, (id) => {
      frame = id;
      loadTotals();
    });
    page.append(
      ui.header({
        title: "Transactions",
        icon: "wallet",
        sub: "See where your Robux come from and go.",
        actions: [
          h("div", { class: "cer-trx-balance" }, h("span", { class: "cer-trx-balance-label", text: "Balance" }), balance),
          ui.button("Buy Robux", { href: ui.nativeUrl("/upgrades/robux"), variant: "primary", icon: "robux" }),
        ],
      })
    );

    // summary
    const stat = (label, icon, tone) => {
      const val = h("div", { class: "cer-trx-stat-val" }, h("span", { class: "cer-trx-sk" }));
      const el = h("div", { class: "cer-trx-stat" + (tone ? " is-" + tone : "") }, h("span", { class: "cer-trx-stat-icon" }, ui.icon(icon, 18)), h("div", { class: "cer-trx-stat-label", text: label }), val);
      el.val = val;
      return el;
    };
    const sIn = stat("Robux in", "arrowLeft", "in");
    const sOut = stat("Robux out", "arrowRight", "out");
    const sNet = stat("Total change", "sliders");
    const sPend = stat("Pending", "clock", "pend");
    const frameNote = h("span", { class: "cer-trx-frame-note" });
    const summary = ui.section("Summary", { icon: "sparkle", tools: frameTabs });
    summary.head.append(frameNote);
    const breakdown = h("div", { class: "cer-trx-break" });
    summary.body.append(h("div", { class: "cer-trx-stats" }, sIn, sOut, sNet, sPend), breakdown);
    page.append(summary);

    // list
    const typeChips = ui.chips(TYPES, type, (id) => {
      type = id;
      loadList();
    });
    const listSec = ui.section("History", { icon: "list" });
    const list = h("div", { class: "cer-trx-list" });
    const more = h("div", { class: "cer-trx-more" });
    listSec.body.append(typeChips, h("div", { class: "cer-trx-listbox" }, list, more));
    page.append(listSec);

    // ---- balance ----
    api.json("https://economy.roblox.com/v1/user/currency").then((c) => {
      balance.replaceChildren(c?.robux != null ? robux(c.robux, { size: 18 }) : h("span", { class: "cer-trx-muted", text: "–" }));
    });

    // ---- totals for the time frame ----
    let totalsSeq = 0;
    async function loadTotals() {
      const seq = ++totalsSeq;
      frameNote.textContent = "Robux " + FRAME_WORD[frame];
      for (const s of [sIn, sOut, sNet, sPend]) s.val.replaceChildren(h("span", { class: "cer-trx-sk" }));
      breakdown.replaceChildren(...ui.skeleton("line", 3));
      const t = await api.json(`https://economy.roblox.com/v2/users/${me.id}/transaction-totals?timeFrame=${frame}&transactionType=summary`, { ttl: 60000 });
      if (seq !== totalsSeq) return;
      if (!t) {
        for (const s of [sIn, sOut, sNet, sPend]) s.val.replaceChildren(h("span", { class: "cer-trx-muted", text: "–" }));
        breakdown.replaceChildren(ui.empty("Could not load your totals. Try again soon.", { icon: "info" }));
        return;
      }
      const rows = BREAKDOWN.map(([k, label, icon]) => ({ label, icon, v: Number(t[k] ?? 0) })).filter((r) => r.v);
      const inSum = t.incomingRobuxTotal ?? rows.filter((r) => r.v > 0).reduce((s, r) => s + r.v, 0);
      const outSum = Math.abs(t.outgoingRobuxTotal ?? rows.filter((r) => r.v < 0).reduce((s, r) => s + r.v, 0));
      const net = inSum - outSum;
      sIn.val.replaceChildren(robux(inSum, { size: 18 }));
      sOut.val.replaceChildren(robux(outSum, { size: 18 }));
      sNet.val.replaceChildren(robux(net, { size: 18, sign: true, tone: net > 0 ? "in" : net < 0 ? "out" : null }));
      sPend.val.replaceChildren(robux(t.pendingRobuxTotal ?? 0, { size: 18 }));

      if (!rows.length) {
        breakdown.replaceChildren(h("p", { class: "cer-trx-break-empty", text: "No Robux moved " + FRAME_WORD[frame] + "." }));
        return;
      }
      const max = Math.max(...rows.map((r) => Math.abs(r.v)));
      rows.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
      breakdown.replaceChildren(
        ...rows.map((r) =>
          h(
            "div",
            { class: "cer-trx-bar" + (r.v < 0 ? " is-out" : " is-in") },
            h("span", { class: "cer-trx-bar-label" }, ui.icon(r.icon, 15), h("span", { text: r.label })),
            h("span", { class: "cer-trx-bar-track" }, h("span", { class: "cer-trx-bar-fill", style: { width: Math.max(2, (Math.abs(r.v) / max) * 100) + "%" } })),
            robux(r.v, { sign: true, tone: r.v > 0 ? "in" : "out", size: 14 })
          )
        )
      );
    }

    // ---- history list ----
    let listSeq = 0;
    async function loadList() {
      const seq = ++listSeq;
      const def = TYPES.find((x) => x.id === type);
      list.replaceChildren(...ui.skeleton("row", 6));
      more.replaceChildren();
      let cursor = "";
      let shown = 0;
      const page1 = async () => {
        // Pending reads Sales and keeps unpaid ones; it may need a few pages
        // to find any, so it reads up to 4 per click.
        const got = [];
        for (let i = 0; i < (def.pending ? 4 : 1); i++) {
          const j = await api.json(
            `https://economy.roblox.com/v2/users/${me.id}/transactions?transactionType=${def.api ?? def.id}&limit=${def.pending ? 100 : 25}&cursor=${encodeURIComponent(cursor ?? "")}`
          );
          if (!j) return null;
          got.push(...(j.data ?? []).filter((t) => !def.pending || t.isPending));
          cursor = j.nextPageCursor;
          if (!cursor || got.length >= 25) break;
        }
        return got;
      };
      const render = async (first) => {
        const rows = await page1();
        if (seq !== listSeq) return;
        if (first) list.replaceChildren();
        if (rows == null) {
          if (first) list.replaceChildren(ui.empty("Could not load this list. Try again soon.", { icon: "info" }));
          else CER.toast?.("Could not load more", "error");
          return;
        }
        shown += rows.length;
        list.append(...rows.map(txRow));
        if (!shown) list.replaceChildren(ui.empty(def.pending ? "Nothing is waiting to pay out." : "Nothing here yet.", { icon: def.icon }));
        more.replaceChildren();
        if (cursor) {
          const b = ui.button("Load more", { variant: "soft", icon: "down" });
          b.addEventListener("click", async () => {
            b.busy(true);
            await render(false);
            b.busy(false);
          });
          more.append(b);
        }
      };
      await render(true);
    }

    loadTotals();
    loadList();
  });
})();
