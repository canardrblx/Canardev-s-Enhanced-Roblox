// CER Chat — replaces Roblox's chat UI. A "Chat" sidebar item opens a
// slide-over panel: conversation list → thread with bubbles → composer.
// Uses Roblox's own chat API, all local.

(async function () {
  if (typeof CER === "undefined") return;
  const settings = await CER.get();
  if (!settings.features.customChat) return;

  document.body.classList.add("cer-custom-chat"); // CSS hides #chat-container

  let me = null;
  try {
    me = await CER.me();
  } catch {
    return;
  }
  if (!me?.id) return;

  // ---- sidebar item ----

  function sidebarList() {
    for (const ul of document.querySelectorAll("ul")) {
      const links = [...ul.querySelectorAll(":scope > li a")];
      if (links.some((a) => a.textContent.trim().toLowerCase() === "home") &&
          links.some((a) => a.textContent.trim().toLowerCase() === "profile")) {
        return ul;
      }
    }
    return null;
  }

  // expose the toggle so the custom sidebar's Chat item can open it
  CER.toggleChat = () => togglePanel();

  // when the custom sidebar is on, IT provides the Chat item — don't inject
  // one into Roblox's (hidden) nav
  const list = settings.features.customSidebar ? null : await CER.waitFor(sidebarList, 15000).catch(() => null);
  if (list) {
    const template = [...list.querySelectorAll(":scope > li")].find(
      (li) => li.querySelector("a")?.textContent.trim().toLowerCase() === "profile"
    );
    let li;
    if (template) {
      li = template.cloneNode(true);
      for (const el of [li, ...li.querySelectorAll("*")]) {
        el.removeAttribute("aria-current");
        for (const cls of [...el.classList]) {
          if (/^bg-|active|selected|current/i.test(cls)) el.classList.remove(cls);
        }
      }
      const a = li.querySelector("a");
      a.removeAttribute("href");
      const icon = li.querySelector('[class*="icon-"], .cer-side-glyph');
      if (icon) {
        icon.className = "cer-side-glyph";
        icon.textContent = "";
        icon.appendChild(CER.svg("chat"));
      }
      const textSpan = [...li.querySelectorAll("span")].find(
        (s) => s.children.length === 0 && s.textContent.trim().toLowerCase() === "profile"
      );
      if (textSpan) textSpan.textContent = "Chat";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        togglePanel();
      });
    } else {
      li = CER.el("li");
      const a = CER.el("a", "", "Chat");
      a.href = "#";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        togglePanel();
      });
      li.appendChild(a);
    }
    li.classList.add("cer-topnav-li", "cer-chat-li");
    li.style.order = 60; // flex order keeps it between the nav items and Settings
    list.appendChild(li);
    const keepAlive = setInterval(() => {
      if (!CER.alive?.()) return clearInterval(keepAlive); // stop once the extension reloads
      if (!document.contains(li)) {
        li.style.order = 60;
        sidebarList()?.appendChild(li);
      }
    }, 3000);
  }

  // ---- the panel ----

  let panel = null;
  let pollTimer = null;

  function togglePanel() {
    if (panel) return closePanel();
    panel = CER.el("div", "cer-chat-panel");
    const head = CER.el("div", "cer-panel-head");
    head.appendChild(CER.el("span", "cer-panel-title", "Chat"));
    const x = CER.el("button", "cer-panel-x", "×");
    x.addEventListener("click", closePanel);
    head.appendChild(x);
    panel.appendChild(head);
    const body = CER.el("div", "cer-chat-body");
    panel.appendChild(body);
    document.body.appendChild(panel);
    showConversations(body);
  }

  function closePanel() {
    clearInterval(pollTimer);
    pollTimer = null;
    panel?.remove();
    panel = null;
  }

  // Roblox's current chat API. Verified live from Roblox's own chat widget:
  //   reads : GET  /v1/get-user-conversations?include_user_data=true&pageSize=30
  //           GET  /v1/get-conversation-messages?conversation_id=<uuid>
  //   send  : POST /v1/send-messages  { conversation_id, messages: [{ content }] }
  // The path is send-messageS (plural) with a messages ARRAY — the old singular
  // /send-message 404'd, which is what broke sending. All routed through the
  // background worker (apis.roblox.com blocks the page's write preflight).
  const API = "https://apis.roblox.com/platform-chat-api/v1";

  function partnerOf(convo) {
    return (convo.participant_user_ids ?? []).find((id) => id !== me.id) ?? null;
  }

  async function showConversations(body) {
    clearInterval(pollTimer);
    body.textContent = "";
    body.appendChild(CER.el("p", "cer-hint", "Loading…"));
    const res = await CER.bgFetch(API + "/get-user-conversations?include_user_data=true&pageSize=30");
    if (!res.ok) {
      body.textContent = "";
      body.appendChild(CER.el("p", "cer-hint", "Couldn't load chats."));
      return;
    }
    const convos = res.data?.conversations ?? [];
    body.textContent = "";
    if (convos.length === 0) {
      body.appendChild(CER.el("p", "cer-hint", "No conversations yet."));
      return;
    }

    const partnerIds = convos.map(partnerOf).filter(Boolean);
    let heads = {};
    try {
      const r = await fetch(
        "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + [...new Set(partnerIds)].join(",") + "&size=48x48&format=Png&isCircular=true",
        { credentials: "include" }
      );
      for (const d of (await r.json()).data ?? []) heads[d.targetId] = d.imageUrl;
    } catch {
      /* rows render without avatars */
    }

    for (const convo of convos) {
      const partnerId = partnerOf(convo);
      const name = convo.name || convo.user_data?.[partnerId]?.display_name || "Conversation";
      const row = CER.el("button", "cer-chat-row");
      const img = CER.el("img", "cer-chat-avatar");
      img.src = heads[partnerId] ?? "";
      row.appendChild(img);
      row.appendChild(CER.el("span", "cer-chat-name", name));
      if (convo.has_unread_messages) row.appendChild(CER.el("span", "cer-chat-unread"));
      row.addEventListener("click", () => showThread(body, convo, name));
      body.appendChild(row);
    }
  }

  async function showThread(body, convo, name) {
    body.textContent = "";
    const bar = CER.el("div", "cer-chat-threadbar");
    const back = CER.el("button", "cer-chat-back", "‹ Back");
    back.addEventListener("click", () => showConversations(body));
    bar.appendChild(back);
    bar.appendChild(CER.el("span", "cer-chat-name", name));
    body.appendChild(bar);

    const log = CER.el("div", "cer-chat-log");
    body.appendChild(log);

    const composer = CER.el("div", "cer-chat-composer");
    const input = CER.el("input", "cer-chat-input");
    input.placeholder = "Message…";
    input.maxLength = 500;
    composer.appendChild(input);
    body.appendChild(composer);

    if (!convo.id) {
      log.appendChild(CER.el("p", "cer-hint", "No messages yet."));
      input.disabled = true;
      input.placeholder = "Can't message here";
      return;
    }

    let lastCount = 0;
    async function load() {
      try {
        const res = await CER.bgFetch(
          API + "/get-conversation-messages?conversation_id=" + encodeURIComponent(convo.id) + "&pageSize=30"
        );
        const messages = res.data?.messages ?? [];
        if (messages.length === lastCount) return;
        lastCount = messages.length;
        log.textContent = "";
        for (const msg of messages.slice().reverse()) {
          const mine = msg.sender_user_id === me.id;
          log.appendChild(
            CER.el("div", "cer-chat-bubble" + (mine ? " cer-chat-bubble-mine" : ""), msg.content ?? "")
          );
        }
        log.scrollTop = log.scrollHeight;
      } catch {
        /* keep old log */
      }
    }
    await load();
    clearInterval(pollTimer);
    pollTimer = setInterval(load, 5000);

    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || !input.value.trim()) return;
      const text = input.value.trim();
      input.value = "";
      // optimistic bubble so it shows instantly
      const bubble = CER.el("div", "cer-chat-bubble cer-chat-bubble-mine cer-chat-sending", text);
      log.appendChild(bubble);
      log.scrollTop = log.scrollHeight;
      // send-messageS (plural), messages ARRAY — verified from Roblox's own chat.
      const res = await CER.bgFetch(API + "/send-messages", "POST", {
        conversation_id: convo.id,
        messages: [{ content: text }],
      });
      bubble.classList.remove("cer-chat-sending");
      if (res?.ok) {
        lastCount = 0;
        setTimeout(load, 600);
      } else {
        bubble.classList.add("cer-chat-failed");
        bubble.title = "Failed to send (status " + (res?.status ?? "?") + ")";
      }
    });
    input.focus();
  }
})();
