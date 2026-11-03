// CER account sections (/my/account#!/privacy, #!/notifications, #!/info).
// Built on CER.ui (content/ui.js). The hub (pages/settings.js) links here.
// One column of rows: label left, control right.
//
// Where the data comes from (Roblox's own settings bundle, read 2026-11-03):
//  privacy   GET  apis.roblox.com/user-settings-api/v1/user-settings/settings-and-options
//                 { [setting]: { currentValue, options: [{ option: { optionValue }, requirement?, requiredActions? }] } }
//            POST .../v1/user-settings  { [setting]: optionValue }
//            An option with requiredActions (parent OK, age check...) runs
//            Roblox's own consent flow, so we never send it: that pick says
//            "Change this on Roblox" and links to Roblox's page.
//  blocked   GET  apis.roblox.com/user-blocking-api/v1/users/get-blocked-users?cursor=&count=50
//                 { data: { cursor, blockedUsers: [{ blockedUserId, blockManagerType }] } }
//            POST .../v1/users/{id}/unblock-user  (a parent's block: Roblox only)
//  notify    GET  apis.roblox.com/account-management-api/graphql/NotificationSettingsContainerQuery/<persisted id>?variables={"userId"}
//            POST .../user-settings-api/v2/user-settings
//                 { [preference.setting.value]: { channelSettings: [{ channelName, setting }] } }
//  info      GET  users.roblox.com/v1/description | birthdate | gender, accountsettings v1/email
//            POST users.roblox.com/v1/description  { description }  (Save button)
// Nothing writes on load: every write is one user change, one request, with
// an inline Saving / Saved / Failed state. Dev dry-run like pages/messages.js:
// sessionStorage["cer-dry-writes"] = "1" logs the request instead.
// Email, phone, password, display name and username changes stay on Roblox.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;
  const TAG = "account";
  const US = "https://apis.roblox.com/user-settings-api";
  const BLOCK = "https://apis.roblox.com/user-blocking-api/v1/users";
  const NOTIFY_Q = "https://apis.roblox.com/account-management-api/graphql/NotificationSettingsContainerQuery/nhYsNvySWtXVwJArCNk0KQ";

  const TITLES = { privacy: "Privacy", notifications: "Notifications", info: "Account info" };
  const sectionNow = () => (location.hash.match(/^#!\/(privacy|notifications|info)\/?$/i) ?? [])[1]?.toLowerCase() ?? null;
  const native = (s) => ui.nativeUrl("/my/account#!/" + s);

  // The privacy settings a kid (or parent) actually looks for. Others stay
  // on Roblox's page ("More on Roblox").
  const PRIVACY = [
    ["whoCanChatWithMeInApp", "Who can chat with me"],
    ["whoCanChatWithMeInExperiences", "Who can chat with me in games"],
    ["whoCanJoinMeInExperiences", "Who can join me in games"],
    ["whoCanSeeMyOnlineStatus", "Who can see when I'm online"],
    ["whoCanPartyWithMe", "Who can party with me"],
    ["whoCanTradeWithMe", "Who can trade with me"],
    ["whoCanSeeMyInventory", "Who can see my items"],
    ["whoCanSeeMyFriendsList", "Who can see my friends"],
    ["privateServerPrivacy", "Who can invite me to private servers"],
  ];
  const VALUES = {
    AllUsers: "Everyone",
    AllAuthenticatedUsers: "Everyone",
    All: "Everyone",
    FriendsFollowingAndFollowers: "Friends and followers",
    FriendsAndFollowing: "Friends and people I follow",
    Friends: "Friends",
    TrustedFriends: "Trusted friends",
    Following: "People I follow",
    Followers: "Followers",
    NoOne: "No one",
  };
  const CATEGORIES = { Communities: "Communities", Social: "Friends and chat", Experiences: "Games", Marketplace: "Items", RobloxPlatform: "Roblox" };
  const TYPES = {
    GroupShout: "Community shouts",
    GroupForumsCommentReplyCreated: "Replies to me",
    GroupForumsCommentCreated: "New comments",
    GroupForumsSubscriber: "Posts I follow",
    FriendRequestReceived: "Friend requests",
    FriendRequestAccepted: "New friends",
    MatchedContact: "Contacts on Roblox",
    SquadInvitation: "Party invites",
    ExperienceInvitation: "Game invites",
    ChatNewMessage: "New messages",
    FriendPresence: "Friends online",
    VirtualEvent: "Events",
    ExperienceRecommendation: "Games for me",
    VirtualEventRecommendation: "Events for me",
    TrendingMomentRecommendation: "Trending now",
    SpecialItem: "Special items",
    CampaignOfferAvailable: "Offers",
    CampaignOfferAvailableV2: "Offers",
    ZCommunityEvent: "Community events",
    MarketingEmails: "News emails",
  };
  const CHANNELS = { Push: "Phone", Desktop: "Computer", Email: "Email", InAppAlerts: "In app", NotificationCenter: "Bell", Stream: "Bell" };
  // "whoCanSeeMyThing" / "SimilarAgeGroupsOnly" → "Similar age groups only"
  const words = (s) => {
    const t = String(s ?? "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  // ------------------------------------------------------------ writes
  const dryRun = () => {
    try {
      return !!CER.dev && sessionStorage.getItem("cer-dry-writes") === "1"; // unpacked test builds only
    } catch {
      return false;
    }
  };
  async function write(url, body = {}) {
    if (dryRun()) {
      console.info("[CER account] dry write (not sent)", url, JSON.stringify(body));
      return { ok: true, status: 200, data: null, dry: true };
    }
    // apis.roblox.com writes go through the background relay (CSRF handled
    // there), the same path chat.js and pages/profile.js use
    if (/^https:\/\/apis\.roblox\.com\//.test(url)) {
      const r = await CER.bgFetch(url, "POST", body);
      return { ok: !!r?.ok, status: r?.status ?? 0, data: r?.data ?? null };
    }
    try {
      const res = await CER.robloxWrite(url, "POST", body);
      return { ok: !!res?.ok, status: res?.status ?? 0, data: await res?.json?.().catch(() => null) };
    } catch {
      return { ok: false, status: 0, data: null };
    }
  }
  const failText = (r) => (r.status === 429 ? "Too fast. Try again." : "Did not save. Try again.");
  // reads: from the page, then the background relay if the page is refused
  const read = async (url) => (await api.json(url)) ?? (await api.json(url, { bg: true }));

  // Yes / no question. Resolves true only on the yes button; Cancel has focus.
  function ask(o) {
    return new Promise((resolve) => {
      const m = ui.modal({
        title: o.title,
        body: o.text && h("p", { text: o.text }),
        onClose: () => resolve(false),
        actions: [
          { label: "Cancel", variant: "ghost", onClick: (close) => close() },
          { label: o.ok, variant: o.tone ?? "danger", onClick: (close) => (resolve(true), close()) },
        ],
      });
      requestAnimationFrame(() => m.el.querySelector(".cer-modal-actions .cer-btn")?.focus());
    });
  }

  // ------------------------------------------------------------ pieces
  // Inline save state next to a control.
  function stateEl() {
    const el = h("span", { class: "cer-ac-state", "aria-live": "polite" });
    let t = null;
    el.set = (kind, text, href) => {
      clearTimeout(t);
      el.className = "cer-ac-state" + (kind ? " is-" + kind : "");
      el.replaceChildren(kind === "good" ? ui.icon("check", 15) : "", href ? h("a", { href, text }) : text ?? "");
      if (kind === "good") t = setTimeout(() => el.set(null, ""), 2200);
    };
    return el;
  }
  const row = (label, ...right) => h("div", { class: "cer-ac-row" }, h("span", { class: "cer-ac-label" }, label), h("span", { class: "cer-ac-ctl" }, right));
  const linkRow = (label, value, href) =>
    h("a", { class: "cer-ac-row is-link", href }, h("span", { class: "cer-ac-label", text: label }), h("span", { class: "cer-ac-ctl" }, value && h("span", { class: "cer-ac-value" }, value), ui.icon("right", 18, "cer-ac-go")));
  const list = (...kids) => h("div", { class: "cer-ac-list" }, kids);
  const title = (text) => h("h2", { class: "cer-ac-title", text });
  function failed(retry, sec) {
    return ui.empty("Could not load. Try again.", {
      icon: "refresh",
      action: h("div", { class: "cer-ac-retry" }, ui.button("Try again", { icon: "refresh", onClick: retry }), ui.link("Open on Roblox", { href: native(sec) })),
    });
  }

  // ------------------------------------------------------------ privacy
  const isGated = (o) => {
    const acts = (o?.requiredActions ?? []).map((a) => a?.actionType ?? a).filter((a) => a && a !== "None");
    return acts.length > 0 || (!!o?.requirement && o.requirement !== "None");
  };
  function privacyRow(key, label, s) {
    const opts = (s?.options ?? [])
      .map((o) => ({ value: o?.option?.optionValue ?? o?.optionValue, gated: isGated(o) }))
      .filter((o) => typeof o.value === "string");
    let cur = s?.currentValue;
    if (cur != null && !opts.some((o) => o.value === cur)) opts.unshift({ value: cur, gated: true });
    const state = stateEl();
    const labelOf = (v) => VALUES[v] ?? words(v);
    // nothing to pick here: show the value only
    if (opts.filter((o) => !o.gated).length < 1 || opts.length < 2) return row(label, h("span", { class: "cer-ac-value", text: labelOf(cur) }));
    const pick = ui.select(
      opts.map((o) => ({ id: o.value, label: labelOf(o.value) })),
      cur,
      async (v) => {
        const sel = pick.querySelector("select");
        const prev = cur;
        if (opts.find((o) => o.value === v)?.gated) {
          sel.value = prev;
          return state.set("warn", "Change this on Roblox", native("privacy"));
        }
        sel.disabled = true;
        state.set("busy", "Saving");
        const r = await write(US + "/v1/user-settings", { [key]: v });
        sel.disabled = false;
        if (r.ok) {
          cur = v;
          state.set("good", "Saved");
        } else {
          sel.value = prev;
          state.set("bad", failText(r));
        }
      }
    );
    return row(label, state, pick);
  }

  async function privacy(body, alive) {
    const box = list(ui.skeleton("row", 5));
    const blocked = list(ui.skeleton("row", 2));
    body.append(box, h("div", { class: "cer-ac-more" }, ui.link("More on Roblox", { href: native("privacy") })), title("Blocked"), blocked);

    const load = async () => {
      box.replaceChildren(...ui.skeleton("row", 5));
      const all = await read(US + "/v1/user-settings/settings-and-options");
      if (!alive()) return;
      if (!all || typeof all !== "object") return box.replaceChildren(failed(load, "privacy"));
      const rows = PRIVACY.filter(([k]) => all[k]).map(([k, label]) => privacyRow(k, label, all[k]));
      box.replaceChildren(...(rows.length ? rows : [ui.empty("Nothing to change here.", { icon: "lock" })]));
    };
    await load();
    if (alive()) await blockedList(blocked, alive);
  }

  async function blockedList(box, alive) {
    let cursor = "";
    const more = h("div", { class: "cer-ac-more" });
    const emptyIfDone = () => !box.querySelector(".cer-ac-user") && box.replaceChildren(ui.empty("Nobody is blocked.", { icon: "shield" }));
    const page = async (first) => {
      const j = await read(`${BLOCK}/get-blocked-users?cursor=${encodeURIComponent(cursor ?? "")}&count=50`);
      if (!alive()) return;
      const items = j?.data?.blockedUsers ?? j?.blockedUsers;
      if (!Array.isArray(items)) {
        if (first) box.replaceChildren(failed(() => (box.replaceChildren(...ui.skeleton("row", 2)), page(true)), "privacy"));
        else CER.toast?.("Could not load more", "error");
        return;
      }
      cursor = j?.data?.cursor ?? j?.cursor ?? null;
      const ids = items.map((b) => b.blockedUserId).filter(Boolean);
      const names = ids.length ? await api.users(ids) : new Map();
      if (!alive()) return;
      if (first) box.replaceChildren();
      box.append(...items.filter((b) => b.blockedUserId).map((b) => blockedRow(b, names.get(String(b.blockedUserId)), emptyIfDone)));
      more.replaceChildren();
      if (cursor) {
        const b = ui.button("Load more", { variant: "soft" });
        b.addEventListener("click", async () => {
          b.busy(true);
          await page(false);
          b.busy(false);
        });
        more.append(b);
      }
      if (!more.isConnected) box.after(more);
      emptyIfDone();
    };
    await page(true);
  }

  function blockedRow(b, u, emptyIfDone) {
    const id = b.blockedUserId;
    const name = u?.displayName || u?.name || "User";
    const state = stateEl();
    const tag = ui.nameTag({ type: "user", id, name, verified: u?.hasVerifiedBadge, sub: u?.name ? "@" + u.name : null, href: `https://www.roblox.com/users/${id}/profile`, cls: "cer-ac-who" });
    let control;
    if (b.blockManagerType === "Parent") {
      // a parent made this block: only Roblox's parent flow can undo it
      control = h("a", { class: "cer-ac-native", href: native("privacy"), text: "Ask on Roblox" });
    } else {
      control = ui.button("Unblock", { variant: "soft", size: "sm" });
      control.addEventListener("click", async () => {
        if (!(await ask({ title: `Unblock ${name}?`, text: "They can chat with you and join you again.", ok: "Unblock", tone: "primary" }))) return;
        control.busy(true);
        state.set("busy", "Saving");
        const r = await write(`${BLOCK}/${id}/unblock-user`, {});
        control.busy(false);
        if (!r.ok) return state.set("bad", failText(r));
        el.remove();
        emptyIfDone();
      });
    }
    const el = h("div", { class: "cer-ac-row cer-ac-user" }, ui.avatar(id, { size: 40 }), tag, h("span", { class: "cer-ac-ctl" }, state, control));
    return el;
  }

  // ------------------------------------------------------------ notifications
  // One button per channel (Phone, Email, ...), pressed = on. Roblox's rule
  // for the on / off values: the selected option and the other one.
  function channelButton(ch, state) {
    const pref = ch?.preference ?? {};
    const sel = pref.selectedOption ?? {};
    const vals = (pref.availableOptions ?? []).map((o) => o?.option?.value).filter(Boolean);
    const acts = new Set((pref.availableOptions ?? []).flatMap((o) => (o?.requiredActions ?? []).map((a) => a?.actionType ?? a)));
    const setting = pref.setting?.value;
    const channel = ch?.channel?.value;
    // legally sensitive channels (marketing email) need Roblox's consent words
    const locked = !setting || !channel || vals.length < 2 || acts.has("ReadableButNotActionable") || acts.has("Inherited") || acts.has("ParentalConsent") || !!ch?.channel?.isLegallySensitive;
    let on = sel.enabled === true;
    const other = vals.find((v) => v !== sel.value);
    const plain = sel.enabled == null || other == null;
    const vOn = plain ? "Enabled" : on ? sel.value : other;
    const vOff = plain ? "Disabled" : on ? other : sel.value;
    const b = h(
      "button",
      { type: "button", class: "cer-ac-ch", "aria-pressed": String(on), disabled: locked, title: locked ? "Change this on Roblox" : null },
      ui.icon("check", 14, "cer-ac-ch-on"),
      h("span", { text: CHANNELS[channel] ?? words(channel) })
    );
    if (locked) return b;
    b.addEventListener("click", async () => {
      const next = !on;
      b.disabled = true;
      b.setAttribute("aria-pressed", String(next));
      state.set("busy", "Saving");
      const r = await write(US + "/v2/user-settings", { [setting]: { channelSettings: [{ channelName: channel, setting: next ? vOn : vOff }] } });
      b.disabled = false;
      if (r.ok) {
        on = next;
        state.set("good", "Saved");
      } else {
        b.setAttribute("aria-pressed", String(on));
        state.set("bad", failText(r));
      }
    });
    return b;
  }

  async function notifications(body, alive, me) {
    const box = h("div", { class: "cer-ac-stack" }, list(ui.skeleton("row", 6)));
    body.append(box);
    const load = async () => {
      box.replaceChildren(list(ui.skeleton("row", 6)));
      const j = await read(NOTIFY_Q + "?variables=" + encodeURIComponent(JSON.stringify({ userId: String(me.id) })));
      if (!alive()) return;
      const cats = j?.data?.userById?.settings?.notifications?.categories;
      if (!Array.isArray(cats)) return box.replaceChildren(failed(load, "notifications"));
      const out = [];
      for (const c of cats) {
        const rows = (c?.notificationTypes ?? [])
          .filter((t) => (t?.channels ?? []).some((ch) => ch?.preference?.availableOptions?.length > 0))
          .map((t) => {
            const state = stateEl();
            const key = t.notificationType?.value;
            return row(
              TYPES[key] ?? words(key),
              state,
              h("span", { class: "cer-ac-chs" }, t.channels.filter((ch) => ch?.preference?.availableOptions?.length > 0).map((ch) => channelButton(ch, state)))
            );
          });
        if (rows.length) out.push(title(CATEGORIES[c?.category?.value] ?? words(c?.category?.value)), list(rows));
      }
      box.replaceChildren(...(out.length ? out : [ui.empty("Nothing to change here.", { icon: "bell" })]));
    };
    await load();
  }

  // ------------------------------------------------------------ account info
  async function info(body, alive, me) {
    const change = (label) => h("a", { class: "cer-ac-native", href: native("info"), text: label });
    const birthday = h("span", { class: "cer-ac-value" }, ui.skeleton("line"));
    const gender = h("span", { class: "cer-ac-value" }, ui.skeleton("line"));
    const email = h("span", { class: "cer-ac-value" });

    const about = h("textarea", { class: "cer-textarea cer-ac-about", maxlength: "1000", rows: "4", disabled: true, "aria-label": "About" });
    const aboutState = stateEl();
    const save = ui.button("Save", { variant: "primary", size: "sm", disabled: true });
    let saved = "";
    about.addEventListener("input", () => (save.disabled = about.value === saved));
    save.addEventListener("click", async () => {
      const text = about.value;
      save.busy(true);
      aboutState.set("busy", "Saving");
      const r = await write("https://users.roblox.com/v1/description", { description: text });
      save.busy(false);
      if (!r.ok) {
        save.disabled = false;
        return aboutState.set("bad", /moderat|filter/i.test(JSON.stringify(r.data ?? "")) ? "Roblox did not allow that text." : failText(r));
      }
      // Roblox hides words it filters (###): show what it kept
      saved = typeof r.data?.description === "string" ? r.data.description : text;
      about.value = saved;
      save.disabled = true;
      aboutState.set("good", "Saved");
    });

    body.append(
      list(
        row("Display name", ui.nameTag({ type: "user", id: me.id, name: me.displayName || me.name, size: "sm", cls: "cer-ac-value" }), change("Change")),
        row("Username", h("span", { class: "cer-ac-value", text: "@" + me.name }), change("Change")),
        row("Birthday", birthday),
        row("Gender", gender)
      ),
      title("About"),
      h("div", { class: "cer-ac-list cer-ac-about-box" }, about, h("div", { class: "cer-ac-about-foot" }, aboutState, save)),
      list(linkRow("Email", email, native("info")), linkRow("Phone", null, native("info")), linkRow("Password", null, native("info")))
    );

    // small reads, one after another (no burst on account endpoints)
    const d = await api.json("https://users.roblox.com/v1/description");
    if (!alive()) return;
    if (typeof d?.description === "string") {
      saved = about.value = d.description;
      about.disabled = false;
    } else aboutState.set("bad", "Could not load.");

    const b = await api.json("https://users.roblox.com/v1/birthdate");
    if (!alive()) return;
    birthday.replaceChildren(b?.birthYear ? fmt.date(new Date(b.birthYear, (b.birthMonth ?? 1) - 1, b.birthDay ?? 1)) : "-");

    const g = await api.json("https://users.roblox.com/v1/gender");
    if (!alive()) return;
    gender.replaceChildren(g ? { 2: "Male", 3: "Female" }[g.gender] ?? "Not set" : "-");

    const e = await api.json("https://accountsettings.roblox.com/v1/email");
    if (!alive()) return;
    if (e?.emailAddress) {
      email.textContent = e.verified ? e.emailAddress : "Not verified";
      email.classList.toggle("is-warn", !e.verified);
    } else if (e) {
      email.textContent = "Add email";
      email.classList.add("is-warn");
    }
  }

  // ------------------------------------------------------------ route
  let shown = null;
  let seq = 0;
  async function render(sec, me) {
    shown = sec;
    const run = ++seq;
    const { page } = ui.page(TAG, "cer-ac");
    const alive = () => run === seq && page.isConnected;
    const body = h("div", { class: "cer-ac-body" });
    page.append(
      h("header", { class: "cer-ac-head" }, ui.button("", { icon: "left", variant: "ghost", title: "Back", href: "/my/account#!/" }), h("h1", { class: "cer-ac-h1", text: TITLES[sec] })),
      body
    );
    if (sec === "privacy") await privacy(body, alive);
    else if (sec === "notifications") await notifications(body, alive, me);
    else await info(body, alive, me);
  }

  async function start() {
    const sec = sectionNow();
    if (!sec) return ui.release();
    const me = await api.me();
    if (!me) {
      // only a real 401/403 means signed out; anything else is a hiccup
      if (CER.loggedOut) return ui.release();
      const { page } = ui.page(TAG, "cer-ac");
      page.append(ui.empty("Could not load. Try again.", { icon: "refresh", action: ui.button("Try again", { icon: "refresh", onClick: start }) }));
      return;
    }
    await render(sec, me);
  }
  ui.route(TAG, start);

  // ui.route keys on path + query, so moving between sections (same path,
  // new hash) is handled here.
  window.addEventListener("hashchange", async () => {
    if (document.getElementById("cer-app")?.dataset.page !== TAG) return;
    const sec = sectionNow();
    if (!sec || sec === shown) return; // left our sections: ui.route hands over
    const me = await api.me();
    if (me) render(sec, me);
  });
})();
