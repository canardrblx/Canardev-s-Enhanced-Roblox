// Redesigned Transactions page (/transactions) — a clean summary dashboard
// (income vs spend, pending, balance) plus a readable recent-transactions
// list. Replaces Roblox's dated table.

(async function () {
  if (typeof CER === "undefined") return;
  if (!location.pathname.startsWith("/transactions")) return;
  // RETIRED: pages/transactions.js owns this page now. With ?cer=native or the
  // feature off, Roblox's own page should show, so this never runs.
  return;

  // page host and our user at the same time (CER.me() is shared, usually
  // already in flight)
  const [host, me] = await Promise.all([
    CER.waitFor(() => document.querySelector("#content, main"), 20000).catch(() => null),
    CER.me().catch(() => null),
  ]);
  if (!host || !me?.id) return;

  const root = CER.el("div", "cer-page");
  for (const child of host.children) child.style.display = "none";
  host.appendChild(root);
  new MutationObserver(() => {
    for (const child of host.children) if (child !== root && child.style.display !== "none") child.style.display = "none";
  }).observe(host, { childList: true });

  const head = CER.el("div", "cer-avatar-head");
  head.appendChild(CER.el("h1", "cer-avatar-title", "Transactions"));
  root.appendChild(head);

  const fmt = (n) => Number(n ?? 0).toLocaleString();
  // null on any failure: an error body read as data showed "R$ 0" and
  // "No recent transactions" instead of an error
  const j = (url) =>
    fetch(url, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

  // ---- summary cards ----
  const cards = CER.el("div", "cer-tx-cards");
  root.appendChild(cards);
  const summaryCard = (label, valueEl) => {
    const c = CER.el("div", "cer-tx-card");
    c.appendChild(CER.el("div", "cer-tx-card-label", label));
    c.appendChild(valueEl);
    return c;
  };
  const balV = CER.el("div", "cer-tx-card-value", "…");
  const inV = CER.el("div", "cer-tx-card-value cer-tx-pos", "…");
  const outV = CER.el("div", "cer-tx-card-value cer-tx-neg", "…");
  const pendV = CER.el("div", "cer-tx-card-value", "…");
  cards.append(
    summaryCard("Current balance", balV),
    summaryCard("Income (30d)", inV),
    summaryCard("Spent (30d)", outV),
    summaryCard("Pending", pendV)
  );

  j("https://economy.roblox.com/v1/user/currency").then((d) => (balV.textContent = d?.robux != null ? "R$ " + fmt(d.robux) : "—"));
  j(`https://economy.roblox.com/v2/users/${me.id}/transaction-totals?timeFrame=Month&transactionType=summary`).then((d) => {
    if (!d) {
      for (const v of [inV, outV, pendV]) v.textContent = "—";
      return;
    }
    const income = (d.salesTotal ?? 0) + (d.affiliateSalesTotal ?? 0) + (d.groupPayoutsTotal ?? 0) + (d.currencyPurchasesTotal ?? 0);
    const spent = Math.abs(d.purchasesTotal ?? 0) + Math.abs(d.tradeRobuxTotal < 0 ? d.tradeRobuxTotal : 0);
    inV.textContent = "R$ " + fmt(income);
    outV.textContent = "R$ " + fmt(spent);
    pendV.textContent = "R$ " + fmt(d.pendingRobuxTotal ?? d.pendingRobux ?? 0);
  });

  // ---- recent transactions ----
  root.appendChild(CER.el("h3", "cer-h3", "Recent"));
  const list = CER.el("div", "cer-tx-list");
  root.appendChild(list);
  list.appendChild(CER.el("p", "cer-hint", "Loading…"));

  try {
    const data = await j(`https://economy.roblox.com/v2/users/${me.id}/transactions?transactionType=Purchase&limit=25&cursor=`);
    if (!data) throw new Error("load failed");
    list.textContent = "";
    const items = data?.data ?? [];
    if (items.length === 0) {
      list.appendChild(CER.el("p", "cer-hint", "No recent transactions."));
    } else {
      for (const t of items) {
        const row = CER.el("div", "cer-tx-row");
        const img = CER.el("img", "cer-tx-icon");
        img.src = t.details?.imageUrl ?? "";
        row.appendChild(img);
        const mid = CER.el("div", "cer-tx-mid");
        mid.appendChild(CER.el("div", "cer-tx-name", t.details?.name ?? t.transactionType ?? "Transaction"));
        mid.appendChild(CER.el("div", "cer-tx-date", new Date(t.created).toLocaleDateString()));
        row.appendChild(mid);
        const amt = t.currency?.amount ?? 0;
        const amtEl = CER.el("div", "cer-tx-amt " + (amt >= 0 ? "cer-tx-pos" : "cer-tx-neg"), (amt >= 0 ? "+" : "") + "R$ " + fmt(amt));
        row.appendChild(amtEl);
        list.appendChild(row);
      }
    }
  } catch {
    list.textContent = "";
    list.appendChild(CER.el("p", "cer-hint", "Couldn't load transactions."));
  }
})();
