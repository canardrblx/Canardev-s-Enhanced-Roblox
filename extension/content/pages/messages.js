// CER messages page. Built on CER.ui (content/ui.js).
// Route: /my/messages (hash tabs #!/inbox, #!/sent, #!/archive, #!/news).
// Two panes: message list on the left, reader on the right (one pane on
// narrow screens). Message bodies are NEVER parsed into the live page as HTML:
// they become text nodes, and links become <a> elements we build ourselves.
// Selection: a checkbox per row (on hover, or on every row while selecting),
// a select-all box and a count in the list head; bulk actions (mark read,
// mark unread, archive, move to Inbox) show only while something is picked.
// Writes (mark read / unread, mark all read, archive, unarchive) go through `write()`,
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
      dry = !!CER.dev && sessionStorage.getItem("cer-dry-writes") === "1"; // unpacked test builds only
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
  // Plain-text bodies and subjects still carry HTML entities (I&#39;m).
  // Decode only those, by table: no parser, no markup.
  const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", "#39": "'" };
  const decode = (t) =>
    String(t ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== "#") return NAMED[e.toLowerCase()] ?? m;
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    });
  function segments(raw) {
    raw = String(raw ?? "");
    if (!/<\/?[a-z][^>]*>/i.test(raw)) return linkify(decode(raw).replace(/\r\n?/g, "\n"), []);
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
  const bare = (u) =>
    String(u)
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  const sameAsHref = (text, href) => bare(text) === bare(href);
  const hostOf = (href) => {
    try {
      return new URL(href).hostname.replace(/^www\./, "");
    } catch {
      return "link";
    }
  };
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
      // Text that hides where a link goes ("Free Robux" -> other-site.com):
      // show the real site next to it, so kids can see it is not Roblox.
      if (!roblox && !sameAsHref(s.text, s.href)) box.append(h("span", { class: "ms-link-host", text: " (" + hostOf(s.href) + ")" }));
    }
    if (!box.childNodes.length) box.append(h("span", { class: "ms-muted", text: "This message is empty." }));
    return box;
  }

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
    const session = (S = {
      alive: true,
      stop() {
        this.alive = false;
        window.removeEventListener("hashchange", this.onHash);
        document.removeEventListener("keydown", this.onKey);
      },
    });

    // shell first
    const { page } = ui.page("messages", "ms-view");
    const markAll = ui.button("Mark all read", { variant: "ghost", size: "sm", class: "ms-markall" });
    markAll.hidden = true;
    const head = ui.header({ title: "Messages" });
    document.title = "Messages - Roblox";
    const tabSlot = h("div", { class: "cer-sk ms-sk-tabs" });
    const toolbar = h("div", { class: "ms-toolbar" }, tabSlot);
    // list head: select-all box + count, then Mark all read OR the bulk bar
    const selAll = checkBox("Select all");
    const selText = h("span", { class: "ms-sel-text" });
    const selLabel = h("span", { class: "ms-sel" }, selAll, selText);
    const bar = h("div", { class: "ms-bar" });
    const listHead = h("div", { class: "ms-list-head", hidden: true }, selLabel, h("div", { class: "ms-head-right" }, markAll, bar));
    const listBody = h("div", { class: "ms-list-body" }, rowSkeletons());
    const pager = h("div", { class: "ms-pager" });
    const listPane = h("section", { class: "ms-pane ms-list", "aria-label": "Messages" }, listHead, listBody, pager);
    const reader = h("section", { class: "ms-pane ms-reader", "aria-live": "polite" }, readerIdle());
    const split = h("div", { class: "ms-split" }, listPane, reader);
    page.append(head, toolbar, split);

    const me = await api.me();
    if (!session.alive) return;
    if (!me) return ui.release();

    // ---- tabs
    const tabItems = [
      { id: "inbox", label: "Inbox" },
      { id: "sent", label: "Sent" },
      { id: "archive", label: "Archive" },
    ];
    let tab = tabFromHash();
    if (tab === "news") tab = "inbox"; // until we know the news feed exists
    const wantNews = tabFromHash() === "news";
    const tabs = ui.tabs(tabItems, tab, (id) => go(id, true));
    tabSlot.replaceWith(tabs);

    // ---- state
    let pageNo = 0;
    let data = null; // { collection, totalPages, totalCollectionSize }
    let openId = null;
    let unread = null;
    let news = null; // announcements collection, or null when the API has none
    let loadTok = 0;
    const sel = new Set(); // selected message ids (strings), this page only
    let anchor = null; // last ticked id, for shift-click ranges
    const selectable = () => tab === "inbox" || tab === "archive";

    const setUnread = (n) => {
      if (n == null || !session.alive) return;
      unread = Math.max(0, n);
      tabItems[0].count = unread || null;
      tabs.set(tab);
      if (data) syncSel();
    };
    api.json(`${PM}/messages/unread/count`).then((j) => setUnread(j?.count));

    // News / announcements: a tab only when there is some.
    api.json(`${PM}/announcements`).then((j) => {
      if (!session.alive || !j?.collection?.length) return;
      news = j.collection;
      tabItems.push({ id: "news", label: "News" });
      tabs.set(tab);
      if (wantNews) go("news", false);
    });

    // ---- list
    async function loadList() {
      const tok = ++loadTok;
      sel.clear();
      listHead.hidden = true;
      listBody.replaceChildren(rowSkeletons());
      pager.replaceChildren();
      if (tab === "news") {
        data = { collection: news ?? [], totalPages: 1 };
      } else {
        const j = await api.json(`${PM}/messages?pageNumber=${pageNo}&pageSize=${PAGE_SIZE}&messageTab=${tab}`);
        if (tok !== loadTok || !session.alive) return;
        if (!j || !Array.isArray(j.collection)) {
          data = null;
          listBody.replaceChildren(ui.empty("Could not load messages.", { icon: "mail", action: ui.button("Try again", { variant: "soft", size: "sm", onClick: loadList }) }));
          markAll.hidden = true;
          return;
        }
        data = j;
      }
      renderList();
    }

    function renderList() {
      const msgs = data?.collection ?? [];
      for (const id of [...sel]) if (!msgs.some((m) => String(m.id) === id)) sel.delete(id);
      listHead.hidden = !selectable() || !msgs.length;
      listBody.classList.toggle("can-select", selectable());
      if (!msgs.length) {
        const empty = { inbox: pageNo ? "No more messages." : "No messages.", sent: "No sent messages.", archive: "Archive is empty.", news: "No news." }[tab];
        listBody.replaceChildren(ui.empty(empty, { icon: tab === "archive" ? "archive" : tab === "news" ? "megaphone" : "mail" }));
      } else listBody.replaceChildren(...msgs.map(row));
      syncSel();
      // pager
      const total = data?.totalPages ?? (msgs.length < PAGE_SIZE ? pageNo + 1 : pageNo + 2);
      if (tab !== "news" && (pageNo > 0 || total > 1)) {
        const prev = ui.button("", { icon: "left", variant: "ghost", size: "sm", title: "Newer", disabled: pageNo === 0, onClick: () => ((pageNo -= 1), loadList()) });
        const next = ui.button("", { icon: "right", variant: "ghost", size: "sm", title: "Older", disabled: pageNo >= total - 1, onClick: () => ((pageNo += 1), loadList()) });
        pager.replaceChildren(prev, h("span", { class: "ms-pager-text", text: `${pageNo + 1} / ${Math.max(total, 1)}` }), next);
      } else pager.replaceChildren();
      // keep the open message if it is still on this page
      if (openId && !msgs.some((m) => String(m.id) === String(openId))) closeReader();
      // wide screens: fill the reader with the newest message, but only one
      // that is already read (opening an unread one would mark it read)
      if (!openId && !split.classList.contains("is-narrow") && msgs[0] && (msgs[0].isRead || tab === "sent" || tab === "news")) open(msgs[0], true);
    }

    function other(m) {
      // the person shown on a row: who sent it, or who it went to (Sent tab)
      return tab === "sent" ? m.recipient ?? m.sender : m.sender ?? m.recipient;
    }

    function row(m) {
      const who = other(m) ?? {};
      const isUnread = !m.isRead && tab !== "sent" && tab !== "news";
      const id = String(m.id);
      const name = who.displayName || who.name || "Roblox";
      const openBtn = h(
        "button",
        { type: "button", class: "ms-open", onClick: () => open(m) },
        h("span", { class: "ms-dot", "aria-label": isUnread ? "Unread" : null }),
        ui.avatar(who.id ?? 1, { size: 40 }),
        h(
          "span",
          { class: "ms-row-main" },
          h(
            "span",
            { class: "ms-row-top" },
            h("span", { class: "ms-from" }, tab === "sent" && h("span", { class: "ms-to", text: "To " }), ui.nameTag({ type: "user", id: who.id, name, verified: who.hasVerifiedBadge, size: "sm" })),
            h("span", { class: "ms-date", text: shortDate(m.created) })
          ),
          h("span", { class: "ms-subj", text: decode(m.subject) || "No subject" })
        )
      );
      const r = h("div", { class: "ms-row" + (isUnread ? " is-unread" : "") + (id === String(openId) ? " is-active" : ""), dataset: { id } });
      if (selectable()) {
        const box = checkBox("Select");
        box.addEventListener("click", (e) => tick(id, e.shiftKey));
        r.append(box);
        r.box = box;
      }
      r.append(openBtn);
      r.msg = m;
      return r;
    }

    // ---- selection
    function tick(id, range) {
      const msgs = data?.collection ?? [];
      const on = !sel.has(id);
      const ids = msgs.map((m) => String(m.id));
      if (range && anchor && ids.includes(anchor)) {
        const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y);
        for (const x of ids.slice(a, b + 1)) on ? sel.add(x) : sel.delete(x);
      } else on ? sel.add(id) : sel.delete(id);
      anchor = id;
      syncSel();
    }
    function clearSel() {
      sel.clear();
      anchor = null;
      syncSel();
    }
    selAll.addEventListener("click", () => {
      const msgs = data?.collection ?? [];
      if (sel.size && sel.size === msgs.length) return clearSel();
      for (const m of msgs) sel.add(String(m.id));
      syncSel();
    });
    // rows, head box, count and the bulk bar follow the selection
    function syncSel() {
      const msgs = data?.collection ?? [];
      const picked = msgs.filter((m) => sel.has(String(m.id)));
      for (const r of listBody.querySelectorAll(".ms-row")) {
        const on = sel.has(r.dataset.id);
        r.classList.toggle("is-selected", on);
        r.box?.setAttribute("aria-checked", on ? "true" : "false");
      }
      listBody.classList.toggle("is-selecting", sel.size > 0);
      selAll.setAttribute("aria-checked", !sel.size ? "false" : sel.size === msgs.length ? "true" : "mixed");
      selText.textContent = sel.size ? sel.size + " selected" : "Select all";
      // Mark all read when nothing is picked; the bulk bar while picking
      const anyUnread = (unread ?? 0) > 0 && tab === "inbox";
      markAll.hidden = !!sel.size || !(anyUnread || msgs.some((m) => !m.isRead && selectable()));
      bar.replaceChildren();
      if (!sel.size) return;
      const act = (label, kind) => ui.button(label, { variant: "soft", size: "sm", onClick: () => bulk(kind) });
      if (picked.some((m) => !m.isRead)) bar.append(act("Read", "read"));
      if (picked.some((m) => m.isRead)) bar.append(act("Unread", "unread"));
      bar.append(tab === "archive" ? act("To Inbox", "unarchive") : act("Archive", "archive"));
      bar.append(ui.button("", { icon: "x", variant: "ghost", size: "sm", title: "Clear", class: "ms-bar-x", onClick: clearSel }));
    }
    session.onKey = (e) => {
      if (e.key === "Escape" && sel.size && !document.querySelector(".cer-modal-overlay")) clearSel();
    };
    document.addEventListener("keydown", session.onKey);

    const BULK = { read: "mark-read", unread: "mark-unread", archive: "archive", unarchive: "unarchive" };
    async function bulk(kind) {
      const msgs = data?.collection ?? [];
      let pick = msgs.filter((m) => sel.has(String(m.id)));
      if (kind === "read") pick = pick.filter((m) => !m.isRead);
      if (kind === "unread") pick = pick.filter((m) => m.isRead);
      if (!pick.length) return;
      const ids = pick.map((m) => m.id);
      const tok = loadTok;
      const from = tab;
      bar.querySelectorAll("button").forEach((b) => (b.disabled = true));
      let res = { ok: true };
      for (let i = 0; i < ids.length && res.ok; i += 20) res = await write(`${PM}/messages/${BULK[kind]}`, { messageIds: ids.slice(i, i + 20) });
      if (!session.alive) return;
      if (!res.ok) {
        syncSel();
        return CER.toast(res.status === 429 ? "Too fast! Wait a moment." : "Could not do that. Try again.", "error");
      }
      const n = ids.length;
      if (kind === "read" || kind === "unread") {
        for (const m of pick) m.isRead = kind === "read";
        if (unread != null && from === "inbox") setUnread(unread + (kind === "read" ? -n : n));
        CER.toast(kind === "read" ? "Marked read" : "Marked unread");
      } else {
        const unreadMoved = pick.filter((m) => !m.isRead).length;
        if (unreadMoved && unread != null) setUnread(unread + (kind === "archive" ? -unreadMoved : unreadMoved));
        CER.toast(kind === "archive" ? (n === 1 ? "Moved to Archive" : n + " moved to Archive") : n === 1 ? "Moved to Inbox" : n + " moved to Inbox");
      }
      if (!res.dry) recount();
      if (tok !== loadTok || from !== tab || !data) return; // the list on screen changed meanwhile
      sel.clear();
      anchor = null;
      if (kind === "read" || kind === "unread") return renderList();
      if (ids.some((x) => String(x) === String(openId))) closeReader();
      data.collection = msgs.filter((m) => !ids.includes(m.id));
      // a page emptied out: step back one; otherwise reload it so it fills up
      if (!data.collection.length && pageNo > 0) pageNo -= 1;
      if (res.dry) return renderList(); // dry run: the server still has them
      loadList();
    }
    // the real unread number, after a write (local math can drift)
    const recount = () => api.json(`${PM}/messages/unread/count`).then((j) => session.alive && j && (setUnread(j.count), syncSel()));

    function markRowRead(id) {
      const r = listBody.querySelector(`.ms-row[data-id="${CSS.escape(String(id))}"]`);
      r?.classList.remove("is-unread");
      r?.querySelector(".ms-dot")?.removeAttribute("aria-label");
    }

    // ---- reader
    function readerIdle() {
      return h("div", { class: "ms-idle" }, ui.icon("mail", 34), h("p", { text: "Pick a message." }));
    }
    function closeReader() {
      openId = null;
      split.classList.remove("is-reading");
      reader.replaceChildren(readerIdle());
      listBody.querySelectorAll(".ms-row.is-active").forEach((r) => r.classList.remove("is-active"));
    }

    // auto: filled in for wide screens, so a narrow screen keeps the list
    function open(m, auto) {
      openId = m.id;
      if (!auto) split.classList.add("is-reading");
      listBody.querySelectorAll(".ms-row").forEach((r) => r.classList.toggle("is-active", String(r.dataset.id) === String(m.id)));
      const who = other(m) ?? {};
      const profile = who.id ? `https://www.roblox.com/users/${who.id}/profile` : null;
      const back = ui.button("", { icon: "arrowLeft", variant: "ghost", size: "sm", class: "ms-back", title: "Back", onClick: closeReader });
      const tools = h("div", { class: "ms-tools" });
      if (tab === "inbox" || tab === "archive") {
        const toArchive = tab === "inbox";
        const b = ui.button("", { icon: toArchive ? "archive" : "mail", variant: "ghost", size: "sm", title: toArchive ? "Archive" : "Move to Inbox" });
        b.addEventListener("click", async () => {
          const tok = loadTok;
          const from = tab;
          b.busy(true);
          const res = await write(`${PM}/messages/${toArchive ? "archive" : "unarchive"}`, { messageIds: [m.id] });
          if (!session.alive) return;
          if (!res.ok) {
            b.busy(false);
            return CER.toast(res.status === 429 ? "Too fast! Wait a moment." : "Could not move it. Try again.", "error");
          }
          CER.toast(toArchive ? "Moved to Archive" : "Moved to Inbox");
          if (!m.isRead && unread != null) setUnread(toArchive ? unread - 1 : unread + 1);
          if (tok !== loadTok || from !== tab || !data) return; // the list on screen changed meanwhile
          data.collection = data.collection.filter((x) => x.id !== m.id);
          if (String(openId) === String(m.id)) closeReader();
          renderList();
        });
        tools.append(b);
      }
      reader.replaceChildren(
        h(
          "article",
          { class: "ms-read" },
          h(
            "div",
            { class: "ms-read-top" },
            back,
            profile ? h("a", { href: profile, class: "ms-read-av", title: who.name ? "@" + who.name : null }, ui.avatar(who.id, { size: 40 })) : ui.avatar(1, { size: 40 }),
            h(
              "div",
              { class: "ms-read-who" },
              h(
                "div",
                { class: "ms-read-name" },
                tab === "sent" && h("span", { class: "ms-muted", text: "To " }),
                ui.nameTag({ type: "user", id: who.id, name: who.displayName || who.name || "Roblox", verified: who.hasVerifiedBadge, href: profile, cls: "ms-name-link" })
              ),
              h("div", { class: "ms-read-date", text: longDate(m.created) })
            ),
            tools
          ),
          h("h2", { class: "ms-read-subject", text: decode(m.subject) || "No subject" }),
          bodyNode(m.body)
        )
      );
      reader.scrollTop = 0;
      if (split.classList.contains("is-narrow")) window.scrollTo({ top: split.offsetTop - 80 });

      // mark as read (a write; dry-run switch respected)
      if (!m.isRead && tab !== "sent" && tab !== "news") {
        const tok = loadTok;
        write(`${PM}/messages/mark-read`, { messageIds: [m.id] }).then((res) => {
          if (!res.ok || !session.alive) return;
          m.isRead = true;
          if (unread != null) setUnread(unread - 1);
          if (tok !== loadTok) return; // another list is on screen now
          markRowRead(m.id);
          syncSel();
        });
      }
    }

    // Mark all read: every unread message in this tab, not just this page.
    // Unread ones are found page by page (newest first) until the unread
    // count is reached, then marked in batches of 20.
    markAll.addEventListener("click", async () => {
      const tok = loadTok;
      const from = tab;
      markAll.busy(true);
      const want = from === "inbox" && unread ? unread : 0;
      const ids = [];
      const here = data?.collection ?? [];
      const add = (list) => list.forEach((m) => !m.isRead && !ids.includes(m.id) && ids.push(m.id));
      add(here);
      for (let p = 0, pages = data?.totalPages ?? 1; ids.length < want && p < Math.min(pages, 50); p++) {
        if (p === pageNo) continue;
        const j = await api.json(`${PM}/messages?pageNumber=${p}&pageSize=${PAGE_SIZE}&messageTab=${from}`);
        if (!session.alive) return;
        if (!j?.collection) break;
        add(j.collection);
        pages = j.totalPages ?? pages;
        await api.sleep(120);
      }
      let res = { ok: true };
      for (let i = 0; i < ids.length && res.ok; i += 20) res = await write(`${PM}/messages/mark-read`, { messageIds: ids.slice(i, i + 20) });
      markAll.busy(false);
      if (!session.alive) return;
      if (!res.ok) return CER.toast(res.status === 429 ? "Too fast! Wait a moment." : "Could not mark them read. Try again.", "error");
      for (const m of here) if (ids.includes(m.id)) m.isRead = true; // the page's own objects
      if (unread != null && from === "inbox") setUnread(want && ids.length >= want ? 0 : unread - ids.length);
      if (ids.length) CER.toast("All read");
      if (!res.dry) recount();
      if (tok !== loadTok) return; // another list is on screen now
      ids.forEach(markRowRead);
      syncSel();
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
      if (push && location.hash !== want) history.pushState(history.state, "", location.pathname + location.search + want);
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

  // Round-cornered checkbox button (role=checkbox, aria-checked true/false/mixed).
  function checkBox(label) {
    return h("button", { type: "button", class: "ms-check", role: "checkbox", "aria-checked": "false", "aria-label": label, title: label }, h("span", { class: "ms-check-box" }, ui.icon("check", 14, "ms-check-on"), ui.icon("minus", 14, "ms-check-mixed")));
  }

  function rowSkeletons() {
    return h(
      "div",
      { class: "ms-sk-list" },
      Array.from({ length: 8 }, () => h("div", { class: "ms-sk-row" }, h("div", { class: "cer-sk ms-sk-av" }), h("div", { class: "ms-sk-lines" }, h("div", { class: "cer-sk cer-sk-line" }), h("div", { class: "cer-sk cer-sk-line short" }))))
    );
  }
})();
