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
  // A slide-over on the right: conversation list, then a thread with bubbles
  // and a composer. Built from CER.ui pieces only.

  const { h, icon } = CER.ui;
  let panel = null;
  let pollTimer = null;

  function togglePanel() {
    if (panel) return closePanel();
    const title = h("div", { class: "cer-chat-title" }, h("span", { text: "Chat" }));
    const back = CER.ui.button("", { icon: "left", variant: "ghost", size: "sm", title: "Back", class: "cer-chat-back" });
    back.hidden = true;
    const x = CER.ui.button("", { icon: "x", variant: "ghost", size: "sm", title: "Close", onClick: closePanel });
    const body = h("div", { class: "cer-chat-body" });
    panel = h("aside", { class: "cer-ui cer-chat-panel", role: "dialog", "aria-label": "Chat" }, h("header", { class: "cer-chat-head" }, back, title, x), body);
    panel.head = { back, title };
    document.body.appendChild(panel);
    document.addEventListener("keydown", onKey);
    showConversations(body);
  }

  function closePanel() {
    stopPoll();
    document.removeEventListener("keydown", onKey);
    const p = panel;
    panel = null;
    if (!p) return;
    p.classList.add("is-out");
    setTimeout(() => p.remove(), 160);
  }
  const onKey = (e) => {
    if (e.key === "Escape" && panel) closePanel();
  };

  function setHead(opts) {
    const { back, title } = panel.head;
    back.hidden = !opts.onBack;
    back.onclick = opts.onBack ?? null;
    title.replaceChildren(...opts.title);
  }

  // live thread refresh: only while a thread is open and the tab is visible
  function stopPoll() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Roblox's current chat API. Verified live from Roblox's own chat widget:
  //   reads : GET  /v1/get-user-conversations?include_user_data=true&pageSize=30
  //           GET  /v1/get-conversation-messages?conversation_id=<uuid>
  //   send  : POST /v1/send-messages  { conversation_id, messages: [{ content }] }
  // The path is send-messageS (plural) with a messages ARRAY. All routed
  // through the background worker (apis.roblox.com blocks the page's write
  // preflight).
  const API = "https://apis.roblox.com/platform-chat-api/v1";

  function partnerOf(convo) {
    return (convo.participant_user_ids ?? []).find((id) => id !== me.id) ?? null;
  }

  async function showConversations(body) {
    stopPoll();
    setHead({ title: [h("span", { text: "Chat" })] });
    body.replaceChildren(h("div", { class: "cer-chat-list" }, CER.ui.skeleton("row", 7)));
    const res = await CER.bgFetch(API + "/get-user-conversations?include_user_data=true&pageSize=30");
    if (!panel || panel.querySelector(".cer-chat-body") !== body) return;
    if (!res?.ok) {
      body.replaceChildren(CER.ui.empty("Could not load your chats. Try again soon.", { icon: "chat" }));
      return;
    }
    const convos = res.data?.conversations ?? [];
    if (!convos.length) {
      body.replaceChildren(CER.ui.empty("No chats yet. Say hi to a friend!", { icon: "chat" }));
      return;
    }
    const list = h("div", { class: "cer-chat-list" });
    for (const convo of convos) {
      const partnerId = partnerOf(convo);
      const ud = convo.user_data?.[partnerId];
      const isGroup = (convo.participant_user_ids?.length ?? 0) > 2;
      const name = convo.name || ud?.display_name || ud?.name || "Chat";
      const sub = isGroup ? (convo.participant_user_ids.length + " people") : ud?.name ? "@" + ud.name : "";
      const pic = partnerId && !isGroup ? CER.ui.avatar(partnerId, { size: 44 }) : h("span", { class: "cer-chat-groupic" }, icon("users", 20));
      const row = h(
        "button",
        { type: "button", class: "cer-chat-row" + (convo.has_unread_messages ? " is-unread" : "") },
        pic,
        h("span", { class: "cer-chat-row-text" }, h("span", { class: "cer-chat-row-name", text: name }), sub && h("span", { class: "cer-chat-row-sub", text: sub })),
        convo.has_unread_messages && h("span", { class: "cer-chat-unread", title: "New messages" })
      );
      row.addEventListener("click", () => showThread(body, convo, name, isGroup ? null : partnerId));
      list.appendChild(row);
    }
    body.replaceChildren(list);
  }

  async function showThread(body, convo, name, partnerId) {
    stopPoll();
    const titleKids = [
      partnerId ? CER.ui.avatar(partnerId, { size: 30 }) : h("span", { class: "cer-chat-groupic is-sm" }, icon("users", 16)),
      partnerId ? h("a", { class: "cer-chat-title-link", href: `https://www.roblox.com/users/${partnerId}/profile`, text: name, title: "Open profile" }) : h("span", { text: name }),
    ];
    setHead({ title: titleKids, onBack: () => showConversations(body) });

    const log = h("div", { class: "cer-chat-log", "aria-live": "polite" });
    const input = h("input", { class: "cer-chat-field", type: "text", placeholder: "Write a message", maxlength: "500", autocomplete: "off", "aria-label": "Message" });
    const send = CER.ui.button("", { icon: "send", variant: "primary", size: "sm", title: "Send", class: "cer-chat-send" });
    const composer = h("div", { class: "cer-chat-composer" }, h("label", { class: "cer-chat-inputwrap" }, input), send);
    body.replaceChildren(log, composer);

    if (!convo.id) {
      log.appendChild(CER.ui.empty("You can't chat here.", { icon: "lock" }));
      input.disabled = true;
      send.disabled = true;
      return;
    }
    log.appendChild(h("div", { class: "cer-chat-loading" }, CER.ui.skeleton("line", 4)));

    let lastSig = "";
    async function load() {
      if (document.hidden) return;
      const res = await CER.bgFetch(API + "/get-conversation-messages?conversation_id=" + encodeURIComponent(convo.id) + "&pageSize=30").catch(() => null);
      if (!log.isConnected) return stopPoll();
      if (!res?.ok) {
        if (!lastSig) log.replaceChildren(CER.ui.empty("Could not load messages.", { icon: "chat" }));
        return;
      }
      const messages = res.data?.messages ?? [];
      const sig = messages.length + ":" + (messages[0]?.id ?? "");
      if (sig === lastSig) return;
      lastSig = sig;
      const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      log.replaceChildren();
      if (!messages.length) log.appendChild(h("p", { class: "cer-chat-note", text: "No messages yet. Say hi!" }));
      let prevMine = null;
      for (const msg of messages.slice().reverse()) {
        const mine = msg.sender_user_id === me.id;
        log.appendChild(h("div", { class: "cer-chat-bubble" + (mine ? " is-mine" : "") + (prevMine === mine ? " is-cont" : ""), text: msg.content ?? "" }));
        prevMine = mine;
      }
      if (nearBottom || !log.dataset.loaded) log.scrollTop = log.scrollHeight;
      log.dataset.loaded = "1";
    }
    await load();
    if (!log.isConnected) return;
    pollTimer = setInterval(load, 5000);

    async function submit() {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      log.querySelector(".cer-chat-note")?.remove();
      // optimistic bubble so it shows at once
      const bubble = h("div", { class: "cer-chat-bubble is-mine is-sending", text });
      log.appendChild(bubble);
      log.scrollTop = log.scrollHeight;
      const res = await CER.bgFetch(API + "/send-messages", "POST", { conversation_id: convo.id, messages: [{ content: text }] });
      bubble.classList.remove("is-sending");
      if (res?.ok) {
        lastSig = "";
        setTimeout(load, 600);
      } else {
        bubble.classList.add("is-failed");
        bubble.title = "Not sent. Try again.";
      }
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    send.addEventListener("click", submit);
    input.focus();
  }
})();
