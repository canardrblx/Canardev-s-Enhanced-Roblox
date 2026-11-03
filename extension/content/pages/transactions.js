// CER transactions page (/transactions). Built on CER.ui (content/ui.js).
// Minimal: your balance, Robux in and out for a period, and a history list.
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
  // `api` is the economy transactionType; `pending` keeps only unpaid sales
  const TYPES = [
    { id: "Purchase", label: "Purchases" },
    { id: "Sale", label: "Sales" },
    { id: "Pending", label: "Pending", api: "Sale", pending: true },
  ];

  const robux = (n, opts = {}) =>
    h(
      "span",
      { class: "cer-trx-rbx" + (opts.tone ? " is-" + opts.tone : "") },
      ui.icon("robux", opts.size ?? 15),
      h("span", { text: (opts.sign && n > 0 ? "+" : opts.sign && n < 0 ? "-" : "") + fmt.full(Math.abs(n ?? 0)) })
    );
  const sk = (cls = "") => h("span", { class: "cer-trx-sk " + cls });

  // Item art, else its game, else the other side of the deal.
  function rowThumb(t) {
    const d = t.details ?? {};
    const a = t.agent ?? {};
    const box = h("span", { class: "cer-trx-thumb" });
    const kindFor = { Asset: "asset", Bundle: "bundle", GamePass: "pass", Badge: "badge" };
    let el = null;
    if (kindFor[d.type] && d.id) el = ui.thumb(kindFor[d.type], d.id);
    else if (d.place?.universeId) el = ui.thumb("gameIcon", d.place.universeId);
    else if (a.type === "Group" && a.id) el = ui.thumb("groupIcon", a.id);
    else if (a.type === "User" && a.id) (el = ui.thumb("headshot", a.id)), box.classList.add("is-round");
    box.append(el ?? ui.icon("robux", 20));
    return box;
  }
  function itemHref(d) {
    const byType = d?.id && { Asset: `/catalog/${d.id}`, Bundle: `/bundles/${d.id}`, GamePass: `/game-pass/${d.id}`, Badge: `/badges/${d.id}` }[d.type];
    return byType || (d?.place?.placeId ? `https://www.roblox.com/games/${d.place.placeId}` : null);
  }
  const shortDate = (date) => {
    const d = new Date(date);
    if (isNaN(d)) return "";
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString("en", { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
  };

  function txRow(t) {
    const d = t.details ?? {};
    const a = t.agent ?? {};
    const amt = t.currency?.amount ?? 0;
    const title = d.name || d.place?.name || a.name || "Robux";
    const href = itemHref(d);
    // the other side of the deal, with its Roblox badges
    const agentTag = (cls) =>
      ui.nameTag({ type: a.type === "Group" ? "group" : "user", id: a.type === "User" || a.type === "Group" ? a.id : null, name: a.name, size: "sm", cls });
    const isAgentTitle = !d.name && !d.place?.name && !!a.name;
    // buyer's name only where it tells you something (your sales)
    const date = shortDate(t.created);
    const buyer = /Sale/.test(t.transactionType ?? "") && a.name && !isAgentTitle;
    const sub = buyer ? [agentTag("cer-trx-who"), date && " · " + date] : date;
    return h(
      "div",
      { class: "cer-trx-row" },
      rowThumb(t),
      h(
        "div",
        { class: "cer-trx-main" },
        href ? h("a", { class: "cer-trx-name", href, title, text: title }) : isAgentTitle ? agentTag("cer-trx-name") : h("span", { class: "cer-trx-name", title, text: title }),
        h("span", { class: "cer-trx-sub" }, sub)
      ),
      h(
        "span",
        { class: "cer-trx-amt" },
        t.isPending && h("span", { class: "cer-trx-pend", title: "Pending" }, ui.icon("clock", 15)),
        robux(amt, { sign: true, tone: amt > 0 ? "in" : amt < 0 ? "out" : null })
      )
    );
  }

  ui.route("transactions", async () => {
    const me = await api.me();
    if (!me) {
      // only a real 401/403 means signed out; anything else is a hiccup
      if (CER.loggedOut) return ui.release();
      ui.page("transactions", "cer-trx").page.append(ui.empty("Could not load this. Try again soon.", { icon: "refresh" }));
      return;
    }
    const { page } = ui.page("transactions", "cer-trx");

    let frame = "Month";
    let type = "Purchase";

    // ---- top: title + balance ----
    const balance = h("span", { class: "cer-trx-balance" }, sk("w-l"));
    page.append(h("header", { class: "cer-trx-top" }, h("h1", { class: "cer-trx-title", text: "Transactions" }), balance));

    // ---- period: in / out ----
    const vIn = h("span", { class: "cer-trx-big" }, sk());
    const vOut = h("span", { class: "cer-trx-big" }, sk());
    const frameTabs = ui.tabs(FRAMES, frame, (id) => {
      frame = id;
      loadTotals();
    });
    page.append(
      h(
        "section",
        { class: "cer-trx-period" },
        h("div", { class: "cer-trx-flow" }, h("div", { class: "cer-trx-flow-item" }, h("span", { class: "cer-trx-flow-label", text: "In" }), vIn), h("div", { class: "cer-trx-flow-item" }, h("span", { class: "cer-trx-flow-label", text: "Out" }), vOut)),
        frameTabs
      )
    );

    // ---- history ----
    const typeChips = ui.chips(TYPES, type, (id) => {
      type = id;
      loadList();
    });
    const list = h("div", { class: "cer-trx-list" });
    const more = h("div", { class: "cer-trx-more" });
    const hist = ui.section("History", { tools: typeChips });
    hist.body.append(list, more);
    page.append(hist);

    api.json("https://economy.roblox.com/v1/user/currency").then((c) => {
      balance.replaceChildren(c?.robux != null ? robux(c.robux, { size: 26 }) : "");
    });

    let totalsSeq = 0;
    async function loadTotals() {
      const seq = ++totalsSeq;
      vIn.replaceChildren(sk());
      vOut.replaceChildren(sk());
      const t = await api.json(`https://economy.roblox.com/v2/users/${me.id}/transaction-totals?timeFrame=${frame}&transactionType=summary`, { ttl: 60000 });
      if (seq !== totalsSeq) return;
      if (!t) {
        vIn.replaceChildren("-");
        vOut.replaceChildren("-");
        return;
      }
      // Fallback sums if Roblox ever drops the incoming/outgoing totals
      const vals = Object.entries(t).filter(([k, v]) => typeof v === "number" && /Total$/.test(k) && !/^(incoming|outgoing|pending)/.test(k)).map(([, v]) => v);
      const inSum = t.incomingRobuxTotal ?? vals.filter((v) => v > 0).reduce((s, v) => s + v, 0);
      const outSum = Math.abs(t.outgoingRobuxTotal ?? vals.filter((v) => v < 0).reduce((s, v) => s + v, 0));
      vIn.replaceChildren(robux(inSum, { size: 20, sign: inSum > 0, tone: inSum > 0 ? "in" : null }));
      vOut.replaceChildren(robux(-outSum, { size: 20, sign: outSum > 0, tone: outSum > 0 ? "out" : null }));
    }

    let listSeq = 0;
    async function loadList() {
      const seq = ++listSeq;
      const def = TYPES.find((x) => x.id === type);
      list.replaceChildren(...ui.skeleton("row", 6));
      more.replaceChildren();
      let cursor = "";
      let shown = 0;
      // Pending reads Sales and keeps unpaid ones: up to 4 pages per click.
      const read = async () => {
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
        const rows = await read();
        if (seq !== listSeq) return;
        if (first) list.replaceChildren();
        if (rows == null) {
          if (first) list.replaceChildren(ui.empty("Could not load this. Try again soon.", { icon: "refresh" }));
          else CER.toast?.("Could not load more", "error");
          return;
        }
        list.querySelector(":scope > .cer-empty")?.remove();
        shown += rows.length;
        list.append(...rows.map(txRow));
        // a cursor means more may come, so no "empty" yet
        if (!shown && !cursor) list.replaceChildren(ui.empty(def.pending ? "Nothing waiting." : "Nothing here yet.", { icon: "robux" }));
        more.replaceChildren();
        if (cursor) {
          const b = ui.button("Load more", { variant: "soft" });
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
