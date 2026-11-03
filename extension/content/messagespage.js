// Redesigned Messages page (/my/messages) — clean inbox list with a reader
// view. Replaces the native UI (features.messagesPage).

(async function () {
  if (typeof CER === "undefined") return;
  if (!location.pathname.startsWith("/my/messages")) return;
  // pages/messages.js owns this page now (CER.ui redesign); stand down.
  if ((await CER.takeover) === "messages") return;
  if (/[?&]cer=native\b/.test(location.search)) return; // escape hatch: Roblox's own page
  const settings = await CER.get();
  if (!settings.features.messagesPage) return;

  const host = await CER.waitFor(() => document.querySelector("#content, main"), 20000).catch(() => null);
  if (!host) return;

  const root = CER.el("div", "cer-page");
  for (const child of host.children) child.style.display = "none";
  host.appendChild(root);
  new MutationObserver(() => {
    for (const child of host.children) {
      if (child !== root && child.style.display !== "none") child.style.display = "none";
    }
  }).observe(host, { childList: true });

  const head = CER.el("div", "cer-avatar-head");
  head.appendChild(CER.el("h1", "cer-avatar-title", "Messages"));
  root.appendChild(head);

  const body = CER.el("div");
  root.appendChild(body);

  let page = 0;
  // bumps on every view change, so a list load that lands after the user
  // opened a message (or paged again) is dropped instead of replacing it
  let viewToken = 0;

  // Roblox PM bodies are HTML. Render a safe whitelist (formatting + roblox
  // links only) — never raw innerHTML, messages come from other users.
  const ALLOWED_TAGS = new Set(["SPAN", "FONT", "B", "STRONG", "I", "EM", "U", "BR", "P", "DIV", "A", "UL", "OL", "LI"]);

  function plainText(html) {
    return new DOMParser().parseFromString(html ?? "", "text/html").body.textContent ?? "";
  }

  function richText(html, className) {
    const src = new DOMParser().parseFromString(html ?? "", "text/html").body;
    const out = CER.el("div", className);
    (function walk(from, to) {
      for (const node of from.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          to.appendChild(document.createTextNode(node.nodeValue));
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (!ALLOWED_TAGS.has(node.tagName)) {
          walk(node, to); // unwrap unknown tags, keep their text
          continue;
        }
        const el = document.createElement(node.tagName === "FONT" ? "span" : node.tagName.toLowerCase());
        // deliberately NO color preservation — authors bake in black-on-white
        // colors that turn invisible on themes; structure and emphasis only
        if (node.tagName === "A") {
          const href = node.getAttribute("href") ?? "";
          if (/^https:\/\/([a-z0-9-]+\.)?roblox\.com\//i.test(href)) {
            el.setAttribute("href", href);
            el.setAttribute("rel", "noreferrer");
          }
        }
        to.appendChild(el);
        walk(node, el);
      }
    })(src, out);
    return out;
  }

  async function renderList() {
    const token = ++viewToken;
    body.textContent = "";
    body.appendChild(CER.el("p", "cer-hint", "Loading…"));
    let data = null;
    try {
      const res = await fetch(`https://privatemessages.roblox.com/v1/messages?messageTab=Inbox&pageNumber=${page}&pageSize=20`, {
        credentials: "include",
      });
      // an error body has no collection and would read as "inbox is empty"
      if (!res.ok) throw new Error(res.status);
      data = await res.json();
    } catch {
      if (token === viewToken) body.textContent = "Couldn't load messages.";
      return;
    }
    if (token !== viewToken) return;
    const messages = data?.collection ?? [];
    body.textContent = "";
    if (messages.length === 0) {
      body.appendChild(CER.el("p", "cer-hint", page === 0 ? "Your inbox is empty." : "No more messages."));
      return;
    }

    // always show the control (disabled when nothing's unread) so it's never
    // "missing"
    const unreadIds = messages.filter((m) => !m.isRead).map((m) => m.id);
    const markAll = CER.el(
      "button",
      "cer-profile-btn cer-msg-markall",
      unreadIds.length ? `Mark all as read (${unreadIds.length})` : "All read"
    );
    markAll.disabled = unreadIds.length === 0;
    markAll.addEventListener("click", async () => {
      markAll.disabled = true;
      const res = await CER.robloxWrite("https://privatemessages.roblox.com/v1/messages/mark-read", "POST", { messageIds: unreadIds }).catch(() => null);
      if (!res?.ok) {
        markAll.disabled = false;
        CER.toast("Couldn't mark them as read. Try again.", "error");
        return;
      }
      if (token === viewToken) renderList(); // not if a message was opened meanwhile
    });
    body.appendChild(markAll);

    for (const msg of messages) {
      const row = CER.el("button", "cer-msg-row" + (msg.isRead ? "" : " cer-msg-unread"));
      const from = CER.el("div", "cer-msg-from", msg.sender?.name ?? "Roblox");
      row.appendChild(from);
      const mid = CER.el("div", "cer-msg-mid");
      mid.appendChild(CER.el("div", "cer-msg-subject", msg.subject ?? "(no subject)"));
      const full = plainText(msg.body);
      const preview = full.length > 100 ? full.slice(0, 100).trimEnd() + "…" : full;
      mid.appendChild(CER.el("div", "cer-msg-preview", preview));
      row.appendChild(mid);
      row.appendChild(CER.el("div", "cer-msg-date", new Date(msg.created).toLocaleDateString()));
      if (!msg.isRead) {
        const markBtn = CER.el("button", "cer-msg-markread", "✓");
        markBtn.title = "Mark as read";
        markBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          markBtn.remove();
          row.classList.remove("cer-msg-unread");
          msg.isRead = true;
          const res = await CER.robloxWrite("https://privatemessages.roblox.com/v1/messages/mark-read", "POST", { messageIds: [msg.id] }).catch(() => null);
          if (!res?.ok) {
            // put it back the way it was
            msg.isRead = false;
            row.classList.add("cer-msg-unread");
            row.appendChild(markBtn);
            CER.toast("Couldn't mark as read. Try again.", "error");
          }
        });
        row.appendChild(markBtn);
      }
      row.addEventListener("click", () => renderReader(msg));
      body.appendChild(row);
    }

    const nav = CER.el("div", "cer-msg-nav");
    if (page > 0) {
      const prev = CER.el("button", "cer-profile-btn", "‹ Newer");
      prev.addEventListener("click", () => {
        page--;
        renderList();
      });
      nav.appendChild(prev);
    }
    if (data?.totalPages == null || page < data.totalPages - 1) {
      const next = CER.el("button", "cer-profile-btn", "Older ›");
      next.addEventListener("click", () => {
        page++;
        renderList();
      });
      nav.appendChild(next);
    }
    body.appendChild(nav);
  }

  function renderReader(msg) {
    viewToken++;
    body.textContent = "";
    const bar = CER.el("div", "cer-chat-threadbar");
    const back = CER.el("button", "cer-chat-back", "‹ Back");
    back.addEventListener("click", renderList);
    bar.appendChild(back);
    body.appendChild(bar);

    const card = CER.el("div", "cer-msg-reader");
    card.appendChild(CER.el("h2", "cer-msg-reader-subject", msg.subject ?? "(no subject)"));
    card.appendChild(
      CER.el("div", "cer-msg-reader-meta", "From " + (msg.sender?.name ?? "Roblox") + " · " + new Date(msg.created).toLocaleString())
    );
    card.appendChild(richText(msg.body, "cer-msg-reader-body"));
    body.appendChild(card);

    if (!msg.isRead) {
      CER.robloxWrite("https://privatemessages.roblox.com/v1/messages/mark-read", "POST", { messageIds: [msg.id] }).catch(() => {});
      msg.isRead = true;
    }
  }

  renderList();
})();
