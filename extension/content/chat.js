// CER Chat — replaces Roblox's chat UI. A "Chat" sidebar item opens a
// slide-over panel: conversation list → thread with bubbles → composer.
// Uses Roblox's own chat API, all local.

(async function () {
  if (typeof CER === "undefined") return;
  const settings = await CER.get();
  if (!settings.features.customChat || settings.features.hideChat) return;

  document.body.classList.add("cer-custom-chat"); // CSS hides #chat-container

  // Who we are, resolved lazily: a rate limit or network blip on the first
  // try must not kill chat for the whole page view. Each open asks again.
  let me = null;
  async function ensureMe() {
    if (me?.id) return me;
    me = (await CER.me().catch(() => null)) ?? null;
    if (me?.id) return me;
    me = null;
    if (!CER.loggedOut) CER.toast?.("Chat is not ready. Try again.", "error");
    return null;
  }
  CER.me().then((m) => m?.id && (me = m), () => {}); // warm it up, no waiting

  // Exposed up front, so the sidebar's Chat item always works:
  //   CER.toggleChat()        open or close the panel (chat list)
  //   CER.openChat(userId)    open the panel on a 1:1 chat with that user
  CER.toggleChat = () => togglePanel();
  CER.openChat = (userId) => openChat(userId);

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

  // Not awaited: the rest of this file must set up before any click can land.
  (async () => {
    // when the custom sidebar is on, IT provides the Chat item — don't inject
    // one into Roblox's (hidden) nav
    const list = settings.features.customSidebar || !(await CER.me().catch(() => null))?.id ? null : await CER.waitFor(sidebarList, 15000).catch(() => null);
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
  })();

  // ---- the panel ----
  // A slide-over on the right: conversation list, then a thread with bubbles
  // and a composer. Built from CER.ui pieces only.

  const { h, icon } = CER.ui;
  let panel = null;
  let pollTimer = null;
  let poller = null; // the open thread's load(), while one is open
  let threadToken = 0; // bumps whenever the view (list, thread) changes or closes
  let opening = false; // an open is waiting on ensureMe()
  const POLL_MS = 25000;

  async function togglePanel() {
    if (panel) return closePanel();
    if (opening) return;
    opening = true;
    const ok = await ensureMe();
    opening = false;
    if (!ok || panel) return;
    showConversations(buildPanel());
  }

  async function openChat(userId) {
    userId = Number(userId);
    if (opening) return;
    opening = true;
    const ok = await ensureMe();
    opening = false;
    if (!ok) return;
    const body = panel?.querySelector(".cer-chat-body") ?? buildPanel();
    if (!userId || userId === me.id) return showConversations(body);
    startChat(body, userId);
  }

  function buildPanel() {
    const title = h("div", { class: "cer-chat-title" }, h("span", { text: "Chat" }));
    const back = CER.ui.button("", { icon: "left", variant: "ghost", size: "sm", title: "Back", class: "cer-chat-back" });
    back.hidden = true;
    const x = CER.ui.button("", { icon: "x", variant: "ghost", size: "sm", title: "Close", onClick: closePanel });
    const body = h("div", { class: "cer-chat-body" });
    panel = h("aside", { class: "cer-ui cer-chat-panel", role: "dialog", "aria-label": "Chat" }, h("header", { class: "cer-chat-head" }, back, title, x), body);
    panel.head = { back, title };
    document.body.appendChild(panel);
    document.addEventListener("keydown", onKey);
    return body;
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
    if (e.key !== "Escape" || !panel || e.defaultPrevented) return;
    // Esc closes only the top-most panel: settings sits above chat
    if (document.getElementById("cer-panel-overlay") || document.querySelector(".cer-ctx")) return;
    closePanel();
  };

  function setHead(opts) {
    const { back, title } = panel.head;
    back.hidden = !opts.onBack;
    back.onclick = opts.onBack ?? null;
    title.replaceChildren(...opts.title);
  }

  // live thread refresh: only while a thread is open, the panel is up and
  // the tab is visible, at most every 25 s (load() skips while one is in flight)
  function stopPoll() {
    clearInterval(pollTimer);
    pollTimer = null;
    poller = null;
    threadToken++; // any load() still in flight for the old thread is ignored
  }
  function runPoll() {
    clearInterval(pollTimer);
    pollTimer = poller && !document.hidden ? setInterval(() => panel?.isConnected && poller?.(), POLL_MS) : null;
  }
  // no ticking while the tab is hidden; catch up at once when it comes back
  document.addEventListener("visibilitychange", () => {
    if (!poller) return;
    if (!document.hidden) poller();
    runPoll();
  });

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
    const token = threadToken;
    setHead({ title: [h("span", { text: "Chat" })] });
    const list = h("div", { class: "cer-chat-list" }, CER.ui.skeleton("row", 7));
    const found = h("div", { class: "cer-chat-list" });
    found.hidden = true;
    body.replaceChildren(friendSearch(body, list, found), list, found);
    const res = await CER.bgFetch(API + "/get-user-conversations?include_user_data=true&pageSize=30");
    if (!panel || token !== threadToken) return; // a thread (or a new list) took over
    if (!res?.ok) {
      const again = CER.ui.button("Try again", { size: "sm", onClick: () => showConversations(body) });
      list.replaceChildren(CER.ui.empty("Could not load chats.", { icon: "chat", action: again }));
      return;
    }
    const convos = res.data?.conversations ?? [];
    if (!convos.length) {
      list.replaceChildren(CER.ui.empty("No chats yet.", { icon: "chat" }));
      return;
    }
    list.replaceChildren();
    addRows(list, body, convos, res.data?.next_cursor);
  }

  // Search box over the list: type a friend's name, pick them, chat.
  // Friends load on the first letter typed.
  function friendSearch(body, list, found) {
    let friends = null;
    const box = CER.ui.search("Find a friend", { class: "cer-chat-search", onInput: (q) => render(q) });
    box.input.setAttribute("aria-label", "Find a friend");
    async function render(q) {
      list.hidden = !!q;
      found.hidden = !q;
      if (!q) return;
      friends ??= CER.api.friends(me.id);
      const all = await friends;
      if (box.input.value.trim() !== q || !found.isConnected) return; // newer typing won
      if (!all) {
        friends = null; // not cached: the next letter tries again
        found.replaceChildren(CER.ui.empty("Could not load friends.", { icon: "users" }));
        return;
      }
      const ql = q.toLowerCase();
      const hits = all.filter((f) => (f.displayName ?? "").toLowerCase().includes(ql) || (f.name ?? "").toLowerCase().includes(ql)).slice(0, 12);
      if (!hits.length) return found.replaceChildren(CER.ui.empty("No friends found.", { icon: "users" }));
      found.replaceChildren(
        ...hits.map((f) => {
          const row = h(
            "button",
            { type: "button", class: "cer-chat-row" },
            CER.ui.avatar(f.id, { size: 44 }),
            CER.ui.nameTag({ type: "user", id: f.id, name: f.displayName || f.name, verified: f.hasVerifiedBadge, size: "sm", cls: "cer-chat-row-name" })
          );
          row.addEventListener("click", () => startChat(body, f.id));
          return row;
        })
      );
    }
    return h("div", { class: "cer-chat-find" }, box);
  }

  // Open the 1:1 chat with one user: the existing one if the first page of
  // chats has it, else ask Roblox to start one (the same call Roblox's own
  // chat makes when you pick a friend). Only ever runs from a click.
  async function startChat(body, userId) {
    stopPoll();
    const token = threadToken;
    const stale = () => !panel || token !== threadToken;
    setHead({ title: [h("span", { text: "Chat" })], onBack: () => showConversations(body) });
    body.replaceChildren(h("div", { class: "cer-chat-list" }, CER.ui.skeleton("row", 2)));
    const oneToOne = (c) => c?.id && c.type !== "group" && c.participant_user_ids?.length === 2 && c.participant_user_ids.includes(userId);
    const res = await CER.bgFetch(API + "/get-user-conversations?include_user_data=true&pageSize=30");
    if (stale()) return;
    let convo = (res?.data?.conversations ?? []).find(oneToOne) ?? null;
    if (!convo) {
      const made = await CER.bgFetch(API + "/create-conversations", "POST", { conversations: [{ type: "one_to_one", participant_user_ids: [userId] }], include_user_data: true });
      if (stale()) return;
      convo = made?.ok ? made.data?.conversations?.[0] ?? null : null;
    }
    if (!convo?.id) {
      const again = CER.ui.button("Try again", { size: "sm", onClick: () => startChat(body, userId) });
      body.replaceChildren(CER.ui.empty("Could not open this chat.", { icon: "chat", action: again }));
      return;
    }
    const ud = convo.user_data?.[userId];
    let name = ud?.display_name || ud?.name;
    if (!name) {
      const u = await Promise.resolve(CER.api.user?.(userId)).catch(() => null);
      if (stale()) return;
      name = u?.displayName || u?.name || "Chat";
    }
    showThread(body, convo, name, userId);
  }

  function addRows(list, body, convos, cursor) {
    for (const convo of convos) {
      const partnerId = partnerOf(convo);
      const ud = convo.user_data?.[partnerId];
      const isGroup = (convo.participant_user_ids?.length ?? 0) > 2;
      const name = convo.name || ud?.display_name || ud?.name || "Chat";
      const unread = !!convo.has_unread_messages || convo.unread_message_count > 0;
      const pic = partnerId && !isGroup ? CER.ui.avatar(partnerId, { size: 44 }) : h("span", { class: "cer-chat-groupic" }, icon("users", 20));
      const row = h(
        "button",
        { type: "button", class: "cer-chat-row" + (unread ? " is-unread" : "") },
        pic,
        CER.ui.nameTag({ type: "user", id: isGroup ? null : partnerId, name, verified: ud?.has_verified_badge ?? ud?.hasVerifiedBadge, size: "sm", cls: "cer-chat-row-name" }),
        unread && h("span", { class: "cer-chat-unread", title: "New messages" })
      );
      row.addEventListener("click", () => showThread(body, convo, name, isGroup ? null : partnerId));
      list.appendChild(row);
    }
    if (!cursor) return;
    // older chats: one quiet row at the end of the list
    const more = h("button", { type: "button", class: "cer-chat-more", text: "More" });
    more.addEventListener("click", async () => {
      more.disabled = true;
      const r = await CER.bgFetch(API + "/get-user-conversations?include_user_data=true&pageSize=30&cursor=" + encodeURIComponent(cursor));
      if (!more.isConnected) return;
      if (!r?.ok) {
        more.disabled = false;
        return;
      }
      more.remove();
      addRows(list, body, r.data?.conversations ?? [], r.data?.next_cursor);
    });
    list.appendChild(more);
  }

  async function showThread(body, convo, name, partnerId) {
    stopPoll();
    const token = threadToken;
    const current = () => token === threadToken && log.isConnected;
    const titleKids = [
      partnerId ? CER.ui.avatar(partnerId, { size: 30 }) : h("span", { class: "cer-chat-groupic is-sm" }, icon("users", 16)),
      partnerId
        ? CER.ui.nameTag({ type: "user", id: partnerId, name, verified: convo.user_data?.[partnerId]?.has_verified_badge, href: `https://www.roblox.com/users/${partnerId}/profile`, title: "Open profile", cls: "cer-chat-title-link" })
        : h("span", { text: name }),
    ];
    setHead({ title: titleKids, onBack: () => showConversations(body) });

    const log = h("div", { class: "cer-chat-log", "aria-live": "polite" });
    const input = h("input", { class: "cer-chat-field", type: "text", placeholder: "Write a message", maxlength: "500", autocomplete: "off", "aria-label": "Message" });
    const send = CER.ui.button("", { icon: "send", variant: "primary", size: "sm", title: "Send", class: "cer-chat-send" });
    const composer = h("div", { class: "cer-chat-composer" }, h("label", { class: "cer-chat-inputwrap" }, input), send);
    body.replaceChildren(log, composer);

    if (!convo.id) {
      log.appendChild(CER.ui.empty("You can't chat here.", { icon: "lock" }));
      composer.remove(); // nothing to type into here
      return;
    }
    log.appendChild(h("div", { class: "cer-chat-loading" }, CER.ui.skeleton("line", 4)));

    let lastSig = "";
    let busy = false;
    let again = false; // a load was asked for while one was in flight
    async function load() {
      if (document.hidden) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        await fetchMessages();
      } finally {
        busy = false;
      }
      if (again && current()) {
        again = false;
        load();
      }
    }
    async function fetchMessages() {
      const res = await CER.bgFetch(API + "/get-conversation-messages?conversation_id=" + encodeURIComponent(convo.id) + "&pageSize=30").catch(() => null);
      if (!current()) return; // a newer thread (or the list) took over
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
        if (msg.type === "system") {
          // Roblox notices ("You unlocked chat ...") are not from either person
          log.appendChild(h("p", { class: "cer-chat-sys", text: msg.content ?? "" }));
          prevMine = null;
          continue;
        }
        const mine = msg.sender_user_id === me.id;
        log.appendChild(h("div", { class: "cer-chat-bubble" + (mine ? " is-mine" : "") + (prevMine === mine ? " is-cont" : ""), text: msg.content ?? "" }));
        prevMine = mine;
      }
      if (nearBottom || !log.dataset.loaded) log.scrollTop = log.scrollHeight;
      log.dataset.loaded = "1";
    }
    await load();
    if (!current()) return;
    poller = load;
    runPoll();

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
