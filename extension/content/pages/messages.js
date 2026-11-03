// CER messages page. Built on CER.ui (content/ui.js).
// Route: /my/messages (hash tabs #!/inbox, #!/sent, #!/archive, #!/news).
// Two panes: message list on the left, reader on the right (one pane on
// narrow screens). Message bodies are NEVER parsed into the live page as HTML:
// they become text nodes, and links become <a> elements we build ourselves.
// Writes (mark read, mark all read, archive, unarchive) go through `write()`,
// which honours the dev dry-run switch: sessionStorage["cer-dry-writes"] = "1"
// logs the request instead of sending it.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;
  const PM = "https://privatemessages.roblox.com/v1";
  const PAGE_SIZE = 20;

  const TABS = ["inbox", "sent", "archive", "news"];
  const HASH = { inbox: "inbox", sent: "sent", archive: "archive", news: "news", announcements: "news", notifications: "news" };
  const tabFromHash = () => HASH[(location.hash.match(/^#!?\/?([\w-]+)/) ?? [])[1]?.toLowerCase()] ?? "inbox";

  let S = null;

  async function write(url, body) {
    let dry = false;
    try {
      dry = sessionStorage.getItem("cer-dry-writes") === "1";
    } catch {
      /* storage off */
    }
    if (dry) {
      console.info("[CER messages] dry write (not sent)", url, JSON.stringify(body));
      return { ok: true, status: 200, dry: true };
    }
    try {
      return (await CER.robloxWrite(url, "POST", body)) ?? { ok: false, status: 0 };
    } catch {
      return { ok: false, status: 0 };
    }
  }

  // ------------------------------------------------------------ body text
  // Turns a message body (plain text, sometimes light HTML) into segments:
  // [{ text } | { text, href }]. HTML goes through an inert DOMParser
  // document (no scripts run, nothing is attached to the page) and only its
  // text and safe link targets are kept.
  const BLOCK = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "TABLE", "BLOCKQUOTE", "PRE"]);
  function safeHref(raw) {
    try {
      const u = new URL(raw, "https://www.roblox.com/");
      return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
    } catch {
      return null;
    }
  }
  function linkify(text, out) {
    const re = /\bhttps?:\/\/[^\s<>"'`]+/gi;
    let last = 0;
    for (const m of text.matchAll(re)) {
      let url = m[0];
      const trail = url.match(/[.,!?;:)\]]+$/);
      if (trail) url = url.slice(0, -trail[0].length);
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      const href = safeHref(url);
      out.push(href ? { text: url, href } : { text: url });
      last = m.index + url.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }
  function segments(raw) {
    raw = String(raw ?? "");
    if (!/<\/?[a-z][^>]*>/i.test(raw)) return linkify(raw.replace(/\r\n?/g, "\n"), []);
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const out = [];
    const nl = () => {
      const lastSeg = out[out.length - 1];
      if (lastSeg && (lastSeg.href || !lastSeg.text.endsWith("\n"))) out.push({ text: "\n" });
    };
    (function walk(node) {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          const t = n.nodeValue.replace(/\s+/g, " ");
          if (t) linkify(t, out);
        } else if (n.nodeType === 1) {
          const tag = n.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") continue;
          if (tag === "BR") {
            out.push({ text: "\n" });
            continue;
          }
          if (tag === "A") {
            const href = safeHref(n.getAttribute("href") ?? "");
            const text = n.textContent.replace(/\s+/g, " ").trim();
            if (href && text) {
              out.push({ text, href });
              continue;
            }
          }
          if (BLOCK.has(tag)) nl();
          walk(n);
          if (BLOCK.has(tag)) nl();
        }
      }
    })(doc.body);
    // trim leading / trailing blank lines
    while (out.length && !out[0].href && !out[0].text.trim()) out.shift();
    while (out.length && !out[out.length - 1].href && !out[out.length - 1].text.trim()) out.pop();
    return out;
  }
  function bodyNode(raw) {
    const box = h("div", { class: "ms-body" });
    for (const s of segments(raw)) {
      if (!s.href) {
        box.append(document.createTextNode(s.text));
        continue;
      }
      const roblox = /^https:\/\/([a-z0-9-]+\.)*roblox\.com(\/|$)/i.test(s.href);
      const a = document.createElement("a");
      a.className = "ms-link";
      a.href = s.href;
      a.textContent = s.text;
      a.rel = "noopener noreferrer nofollow";
      if (!roblox) a.target = "_blank";
      box.append(a);
    }
    if (!box.childNodes.length) box.append(h("span", { class: "ms-muted", text: "This message is empty." }));
    return box;
  }
  const previewOf = (raw) =>
    segments(raw)
      .map((s) => s.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);

  function shortDate(d) {
    const t = new Date(d);
    if (isNaN(t)) return "";
    const now = new Date();
    if (t.toDateString() === now.toDateString()) return t.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
    if (t.getFullYear() === now.getFullYear()) return t.toLocaleDateString("en", { month: "short", day: "numeric" });
    return t.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
  }
  const longDate = (d) => {
    const t = new Date(d);
    return isNaN(t) ? "" : t.toLocaleString("en", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };

  // ------------------------------------------------------------ page
  ui.route("messages", async () => {
    S?.stop();
    const session = (S = { alive: true, stop() { this.alive = false; window.removeEventListener("hashchange", this.onHash); } });

    // shell first
    const { page } = ui.page("messages", "ms-view");
    const sub = h("p", { class: "cer-view-sub ms-sub" });
    const markAll = ui.button("Mark all read", { icon: "check", variant: "soft", size: "sm", class: "ms-markall" });
    markAll.hidden = true;
    const head = ui.header({ title: "Messages", icon: "mail", actions: [markAll] });
    head.querySelector(".cer-view-head-text").append(sub);
    const tabSlot = h("div", { class: "ms-toolbar" }, h("div", { class: "cer-sk ms-sk-tabs" }));
    const listBody = h("div", { class: "ms-list-body" }, rowSkeletons());
    const pager = h("div", { class: "ms-pager" });
    const listPane = h("section", { class: "ms-pane ms-list", "aria-label": "Messages" }, listBody, pager);
    const reader = h("section", { class: "ms-pane ms-reader", "aria-live": "polite" }, readerIdle());
    const split = h("div", { class: "ms-split" }, listPane, reader);
    page.append(head, tabSlot, split);

    const me = await api.me();
    if (!session.alive) return;
    if (!me) return ui.release();

    // ---- tabs
    const tabItems = [
      { id: "inbox", label: "Inbox", icon: "mail" },
      { id: "sent", label: "Sent", icon: "send" },
      { id: "archive", label: "Archive", icon: "archive" },
    ];
    let tab = tabFromHash();
    if (tab === "news") tab = "inbox"; // until we know the news feed exists
    const wantNews = tabFromHash() === "news";
    const tabs = ui.tabs(tabItems, tab, (id) => go(id, true));
    tabSlot.replaceChildren(tabs);

    // ---- state
    let pageNo = 0;
    let data = null; // { collection, totalPages, totalCollectionSize }
    let openId = null;
    let unread = null;
    let news = null; // announcements collection, or null when the API has none
    let loadTok = 0;

    const setUnread = (n) => {
      if (n == null || !session.alive) return;
      unread = Math.max(0, n);
      tabItems[0].count = unread || null;
      tabs.set(tab);
      sub.textContent = unread ? unread + (unread === 1 ? " unread message" : " unread messages") : "You are all caught up.";
    };
    api.json(`${PM}/messages/unread/count`).then((j) => setUnread(j?.count));

    // News / announcements: only shown when the API returns something.
    api.json(`${PM}/announcements`).then((j) => {
      if (!session.alive || !j || !Array.isArray(j.collection)) return;
      news = j.collection;
      tabItems.push({ id: "news", label: "News", icon: "megaphone", count: null });
      tabs.set(tab);
      if (wantNews) go("news", false);
    });

    // ---- list
    async function loadList() {
      const tok = ++loadTok;
      listBody.replaceChildren(rowSkeletons());
      pager.replaceChildren();
      if (tab === "news") {
        data = { collection: news ?? [], totalPages: 1 };
      } else {
        const j = await api.json(`${PM}/messages?pageNumber=${pageNo}&pageSize=${PAGE_SIZE}&messageTab=${tab}`);
        if (tok !== loadTok || !session.alive) return;
        if (!j || !Array.isArray(j.collection)) {
          data = null;
          listBody.replaceChildren(ui.empty("Could not load messages. Try again soon.", { icon: "mail", action: ui.button("Try again", { icon: "refresh", variant: "soft", size: "sm", onClick: loadList }) }));
          markAll.hidden = true;
          return;
        }
        data = j;
      }
      renderList();
    }

    function renderList() {
      const msgs = data?.collection ?? [];
      const unreadHere = msgs.filter((m) => !m.isRead && tab !== "sent" && tab !== "news");
      markAll.hidden = !unreadHere.length;
      if (!msgs.length) {
        const empty = { inbox: pageNo ? "No more messages." : "Your inbox is empty.", sent: "You have not sent any messages.", archive: "Nothing in your archive.", news: "No news right now." }[tab];
        listBody.replaceChildren(ui.empty(empty, { icon: tab === "archive" ? "archive" : tab === "news" ? "megaphone" : "mail" }));
      } else listBody.replaceChildren(...msgs.map(row));
      // pager
      const total = data?.totalPages ?? (msgs.length < PAGE_SIZE ? pageNo + 1 : pageNo + 2);
      if (tab !== "news" && (pageNo > 0 || total > 1)) {
        const prev = ui.button("", { icon: "left", variant: "ghost", size: "sm", title: "Newer", disabled: pageNo === 0, onClick: () => ((pageNo -= 1), loadList()) });
        const next = ui.button("", { icon: "right", variant: "ghost", size: "sm", title: "Older", disabled: pageNo >= total - 1, onClick: () => ((pageNo += 1), loadList()) });
        pager.replaceChildren(prev, h("span", { class: "ms-pager-text", text: `Page ${pageNo + 1} of ${Math.max(total, 1)}` }), next);
      } else pager.replaceChildren();
      // keep the open message if it is still on this page
      if (openId && !msgs.some((m) => String(m.id) === String(openId))) closeReader();
    }

    function other(m) {
      // the person shown on a row: who sent it, or who it went to (Sent tab)
      return tab === "sent" ? m.recipient ?? m.sender : m.sender ?? m.recipient;
    }

    function row(m) {
      const who = other(m) ?? {};
      const isUnread = !m.isRead && tab !== "sent" && tab !== "news";
      const r = h(
        "button",
        { type: "button", class: "ms-row" + (isUnread ? " is-unread" : "") + (String(m.id) === String(openId) ? " is-active" : ""), dataset: { id: m.id }, onClick: () => open(m) },
        h("span", { class: "ms-dot", "aria-label": isUnread ? "Unread" : null }),
        ui.avatar(who.id ?? 1, { size: 42 }),
        h(
          "span",
          { class: "ms-row-main" },
          h("span", { class: "ms-row-top" }, h("span", { class: "ms-from", text: (tab === "sent" ? "To " : "") + (who.displayName || who.name || "Roblox") }), h("span", { class: "ms-date", text: shortDate(m.created) })),
          h("span", { class: "ms-subj", text: m.subject || "No subject" }),
          h("span", { class: "ms-preview", text: previewOf(m.body) })
        )
      );
      r.msg = m;
      return r;
    }

    function markRowRead(id) {
      const r = listBody.querySelector(`.ms-row[data-id="${CSS.escape(String(id))}"]`);
      r?.classList.remove("is-unread");
      r?.querySelector(".ms-dot")?.removeAttribute("aria-label");
    }

    // ---- reader
    function readerIdle() {
      return h("div", { class: "ms-idle" }, h("span", { class: "cer-empty-icon" }, ui.icon("mail", 26)), h("p", { text: "Pick a message to read it." }));
    }
    function closeReader() {
      openId = null;
      split.classList.remove("is-reading");
      reader.replaceChildren(readerIdle());
      listBody.querySelectorAll(".ms-row.is-active").forEach((r) => r.classList.remove("is-active"));
    }

    function open(m) {
      openId = m.id;
      split.classList.add("is-reading");
      listBody.querySelectorAll(".ms-row").forEach((r) => r.classList.toggle("is-active", String(r.dataset.id) === String(m.id)));
      const who = other(m) ?? {};
      const profile = who.id ? `https://www.roblox.com/users/${who.id}/profile` : null;
      const back = ui.button("Back", { icon: "arrowLeft", variant: "ghost", size: "sm", class: "ms-back", onClick: closeReader });
      const tools = h("div", { class: "ms-tools" });
      if (tab === "inbox" || tab === "archive") {
        const toArchive = tab === "inbox";
        const b = ui.button(toArchive ? "Archive" : "Move to Inbox", { icon: toArchive ? "archive" : "mail", variant: "soft", size: "sm" });
        b.addEventListener("click", async () => {
          b.busy(true);
          const res = await write(`${PM}/messages/${toArchive ? "archive" : "unarchive"}`, { messageIds: [m.id] });
          if (!session.alive) return;
          if (!res.ok) {
            b.busy(false);
            return CER.toast(res.status === 429 ? "Too fast! Wait a moment." : "Could not move it. Try again.", "error");
          }
          CER.toast(toArchive ? "Moved to Archive" : "Moved to Inbox");
          if (!m.isRead && toArchive) setUnread((unread ?? 1) - 1);
          data.collection = data.collection.filter((x) => x.id !== m.id);
          closeReader();
          renderList();
        });
        tools.append(b);
      }
      reader.replaceChildren(
        h(
          "article",
          { class: "ms-read" },
          h("div", { class: "ms-read-bar" }, back, tools),
          h("h2", { class: "ms-read-subject", text: m.subject || "No subject" }),
          h(
            "div",
            { class: "ms-read-meta" },
            profile ? h("a", { href: profile, class: "ms-read-av" }, ui.avatar(who.id, { size: 46 })) : ui.avatar(1, { size: 46 }),
            h(
              "div",
              { class: "ms-read-who" },
              h(
                "div",
                { class: "ms-read-name" },
                tab === "sent" && h("span", { class: "ms-muted", text: "To " }),
                profile ? h("a", { href: profile, class: "ms-name-link", text: who.displayName || who.name || "Roblox" }) : h("span", { text: who.displayName || who.name || "Roblox" }),
                who.hasVerifiedBadge && ui.icon("verified", 15, "ms-verified"),
                who.name && h("span", { class: "ms-handle", text: "@" + who.name })
              ),
              h("div", { class: "ms-read-date", text: longDate(m.created) })
            )
          ),
          bodyNode(m.body)
        )
      );
      reader.scrollTop = 0;
      if (split.classList.contains("is-narrow")) window.scrollTo({ top: split.offsetTop - 80 });

      // mark as read (a write; dry-run switch respected)
      if (!m.isRead && tab !== "sent" && tab !== "news") {
        write(`${PM}/messages/mark-read`, { messageIds: [m.id] }).then((res) => {
          if (!res.ok || !session.alive) return;
          m.isRead = true;
          markRowRead(m.id);
          setUnread((unread ?? 1) - 1);
          markAll.hidden = !(data?.collection ?? []).some((x) => !x.isRead);
        });
      }
    }

    markAll.addEventListener("click", async () => {
      const ids = (data?.collection ?? []).filter((m) => !m.isRead).map((m) => m.id);
      if (!ids.length) return;
      markAll.busy(true);
      const res = await write(`${PM}/messages/mark-read`, { messageIds: ids });
      markAll.busy(false);
      if (!session.alive) return;
      if (!res.ok) return CER.toast("Could not mark them read. Try again.", "error");
      for (const m of data.collection) if (ids.includes(m.id)) (m.isRead = true), markRowRead(m.id);
      setUnread((unread ?? ids.length) - ids.length);
      markAll.hidden = true;
    });

    // one pane below ~760 px of column width
    new ResizeObserver(([e]) => split.classList.toggle("is-narrow", e.contentRect.width < 760)).observe(split);

    // ---- tab switching
    function go(id, push) {
      if (!tabItems.some((t) => t.id === id)) id = "inbox";
      const changed = id !== tab;
      tab = id;
      tabs.set(id);
      const want = "#!/" + id;
      if (push && location.hash !== want) history.replaceState(history.state, "", location.pathname + location.search + want);
      if (changed || !data) {
        pageNo = 0;
        closeReader();
        loadList();
      }
    }
    session.onHash = () => {
      const id = tabFromHash();
      if (id !== tab) go(id, false);
    };
    window.addEventListener("hashchange", session.onHash);

    loadList();
  });

  function rowSkeletons() {
    return h(
      "div",
      { class: "ms-sk-list" },
      Array.from({ length: 8 }, () => h("div", { class: "ms-sk-row" }, h("div", { class: "cer-sk ms-sk-av" }), h("div", { class: "ms-sk-lines" }, h("div", { class: "cer-sk cer-sk-line" }), h("div", { class: "cer-sk cer-sk-line short" }))))
    );
  }
})();
