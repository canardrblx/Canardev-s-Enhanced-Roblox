// CER account page (/my/account). Built on CER.ui (content/ui.js).
// Account settings touch security and real money, so this page only READS:
// an overview of read-only cards. Every "Change" button opens Roblox's own
// settings section (ui.nativeUrl), which runs its own checks and captchas.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;

  // Roblox settings sections (hash routes of its own /my/account page)
  const native = (section) => ui.nativeUrl("/my/account#!/" + section);

  // Privacy values come back as enum names. Unknown ones get split words.
  const WHO = {
    NoOne: "No one",
    Friends: "Friends",
    FriendsAndFollowing: "Friends and people I follow",
    FriendsFollowingAndFollowers: "Friends, following, followers",
    Following: "People I follow",
    Followers: "My followers",
    TopFriends: "Top friends",
    AllAuthenticatedUsers: "Everyone",
    AllUsers: "Everyone",
    Everyone: "Everyone",
    Disabled: "No one",
    Enabled: "Everyone",
  };
  const who = (v) => (v == null ? null : WHO[v] ?? String(v).replace(/([a-z])([A-Z])/g, "$1 $2"));

  const MEDIA = { Authenticator: "Authenticator app", Email: "Email", SMS: "Text message", SecurityKey: "Security key", Passkey: "Passkey", CrossDevice: "Another device" };

  // How long ago, in words a kid can read: "3 years", "5 months", "12 days"
  function accountAge(created) {
    const t = new Date(created).getTime();
    if (!t) return null;
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days >= 365) {
      const y = Math.floor(days / 365.25);
      return y + (y === 1 ? " year" : " years");
    }
    if (days >= 31) {
      const m = Math.floor(days / 30.44);
      return m + (m === 1 ? " month" : " months");
    }
    return days + (days === 1 ? " day" : " days");
  }

  // ---------------------------------------------------------------- card
  // A settings card: icon, title, short line, rows of label/value, actions.
  // rows: [{ label, key }]; card.set(key, value | node | null) fills a row,
  // null shows a soft "Open to see" so a failed read never looks broken.
  function infoCard(o) {
    const rows = new Map();
    const list = h("dl", { class: "cer-acct-rows" });
    for (const r of o.rows ?? []) {
      const val = h("dd", { class: "cer-acct-val" }, h("span", { class: "cer-acct-sk" }));
      list.append(h("div", { class: "cer-acct-row" }, h("dt", { text: r.label }), val));
      rows.set(r.key, val);
    }
    const card = h(
      "section",
      { class: "cer-acct-card" + (o.class ? " " + o.class : "") },
      h(
        "div",
        { class: "cer-acct-card-head" },
        h("span", { class: "cer-acct-card-icon" + (o.tone ? " is-" + o.tone : "") }, ui.icon(o.icon, 20)),
        h("div", { class: "cer-acct-card-titles" }, h("h2", { text: o.title }), o.sub && h("p", { text: o.sub }))
      ),
      rows.size ? list : null,
      o.body,
      h("div", { class: "cer-acct-card-foot" }, o.actions)
    );
    card.set = (key, value) => {
      const el = rows.get(key);
      if (!el) return;
      if (value == null || value === "") el.replaceChildren(h("span", { class: "cer-acct-muted", text: "Open to see" }));
      else el.replaceChildren(value instanceof Node ? value : String(value));
    };
    card.done = () => {
      for (const [k, el] of rows) if (el.querySelector(".cer-acct-sk")) card.set(k, null);
    };
    return card;
  }
  const change = (section, label = "Change") => ui.button(label, { href: native(section), variant: "soft", size: "sm", icon: "edit" });
  const yes = (text) => ui.badge(text, "good", "check");
  const no = (text) => ui.badge(text, "plain");
  const warn = (text) => ui.badge(text, "warn");

  // ---------------------------------------------------------------- page
  ui.route("settings", async () => {
    const me = await api.me();
    if (!me) return ui.release();
    const { page } = ui.page("settings", "cer-acct");

    // ---- shell, painted before any data arrives ----
    const name = h("h1", { class: "cer-acct-name", text: me.displayName || me.name });
    const handle = h("p", { class: "cer-acct-handle", text: "@" + me.name });
    const tags = h("div", { class: "cer-acct-tags" });
    const head = h(
      "header",
      { class: "cer-acct-hero" },
      ui.avatar(me.id, { size: 96 }),
      h("div", { class: "cer-acct-hero-text" }, h("span", { class: "cer-acct-eyebrow", text: "Your account" }), name, handle, tags),
      h(
        "div",
        { class: "cer-acct-hero-actions" },
        ui.button("Profile", { href: `https://www.roblox.com/users/${me.id}/profile`, variant: "soft", icon: "user" }),
        ui.button("All Roblox settings", { href: native("info"), variant: "outline", icon: "external" })
      )
    );

    const info = infoCard({
      icon: "user",
      title: "Account info",
      sub: "Your name, email, and phone.",
      rows: [
        { label: "Username", key: "user" },
        { label: "Display name", key: "display" },
        { label: "Joined", key: "joined" },
        { label: "Email", key: "email" },
        { label: "Phone", key: "phone" },
      ],
      actions: change("info"),
    });
    const security = infoCard({
      icon: "shield",
      tone: "good",
      title: "Security",
      sub: "Keep your account safe.",
      rows: [
        { label: "2-step check", key: "2sv" },
        { label: "Methods", key: "methods" },
      ],
      actions: change("security"),
    });
    const privacy = infoCard({
      icon: "lock",
      title: "Privacy",
      sub: "Who can reach you.",
      rows: [
        { label: "Messages", key: "msg" },
        { label: "Trades", key: "trade" },
        { label: "Inventory", key: "inv" },
      ],
      actions: change("privacy"),
    });
    const notes = infoCard({
      icon: "bell",
      title: "Notifications",
      sub: "Choose what pings you.",
      rows: [{ label: "New for you", key: "unread" }],
      actions: change("notifications"),
    });
    const billing = infoCard({
      icon: "wallet",
      tone: "accent",
      title: "Robux and billing",
      sub: "Your Robux and Premium.",
      rows: [
        { label: "Robux", key: "robux" },
        { label: "Premium", key: "premium" },
        { label: "Gift card credit", key: "credit" },
      ],
      actions: [ui.button("History", { href: "/transactions", variant: "ghost", size: "sm", icon: "list" }), change("billing")],
    });
    const parents = infoCard({
      icon: "users",
      title: "Parental controls",
      sub: "A parent can help manage this account.",
      rows: [{ label: "Account type", key: "age" }],
      actions: change("parental-controls", "Open"),
    });
    const cer = infoCard({
      icon: "sliders",
      tone: "accent",
      class: "is-cer",
      title: "CER settings",
      sub: "Themes, features, and more for this extension.",
      body: h(
        "div",
        { class: "cer-acct-cer-chips" },
        ["Themes", "Features", "Playtime", "Join"].map((t) => h("button", { type: "button", class: "cer-chip", onClick: () => CER.openSettings?.(t), text: t }))
      ),
      actions: ui.button("Open CER settings", { variant: "primary", size: "sm", icon: "sliders", onClick: () => CER.openSettings?.() }),
    });

    page.append(
      head,
      h("div", { class: "cer-acct-grid" }, info, security, billing, privacy, notes, parents, cer),
      h("p", { class: "cer-acct-foot", text: "To change a setting, Roblox asks you on its own page." })
    );

    // ---- data, all in parallel. Each read fills only its own rows. ----
    const J = (url, ttl) => api.json(url, ttl ? { ttl } : {});

    info.set("user", "@" + me.name);
    info.set("display", me.displayName || me.name);

    J(`https://users.roblox.com/v1/users/${me.id}`, 600000).then((u) => {
      const age = accountAge(u?.created);
      info.set("joined", u?.created ? h("span", {}, fmt.date(u.created), h("span", { class: "cer-acct-muted", text: " · " + age })) : null);
      if (u?.hasVerifiedBadge) tags.append(ui.badge("Verified", "accent", "verified"));
      if (u?.created) tags.append(ui.badge("Joined " + new Date(u.created).getFullYear(), "plain", "calendar"));
    });

    // email + phone: status only, never the address itself
    J("https://accountsettings.roblox.com/v1/email").then((e) => {
      if (!e) return info.set("email", null);
      info.set("email", !e.emailAddress ? warn("Not added") : e.verified ? yes("Verified") : warn("Not verified"));
    });
    J("https://accountinformation.roblox.com/v1/phone").then((p) => {
      if (!p) return info.set("phone", null);
      info.set("phone", !p.phone ? no("Not added") : p.isVerified ? yes("Verified") : warn("Not verified"));
    });

    J(`https://twostepverification.roblox.com/v1/users/${me.id}/configuration`).then((c) => {
      // unknown shape: say "Open to see", never a wrong "Off"
      const on = (c?.methods ?? []).filter((m) => m.enabled);
      if (!Array.isArray(c?.methods)) {
        security.set("2sv", null);
        security.set("methods", null);
        return;
      }
      security.set("2sv", on.length ? yes("On") : ui.badge("Off", "bad", "x"));
      security.set("methods", on.length ? on.map((m) => MEDIA[m.mediaType] ?? m.mediaType).join(", ") : h("span", { class: "cer-acct-muted", text: "Turn it on to stay safe" }));
    });

    J("https://accountsettings.roblox.com/v1/private-message-privacy").then((r) => privacy.set("msg", who(r?.privateMessagePrivacy)));
    J("https://accountsettings.roblox.com/v1/trade-privacy").then((r) => privacy.set("trade", who(r?.tradePrivacy)));
    J("https://accountsettings.roblox.com/v1/inventory-privacy").then((r) => privacy.set("inv", who(r?.inventoryPrivacy)));

    J("https://notifications.roblox.com/v2/stream-notifications/unread-count").then((n) => {
      const c = n?.unreadNotifications;
      notes.set("unread", c == null ? null : c ? ui.badge(fmt.full(c) + " new", "accent", "bell") : h("span", { class: "cer-acct-muted", text: "All caught up" }));
    });

    J("https://economy.roblox.com/v1/user/currency").then((c) => {
      billing.set("robux", c?.robux == null ? null : h("span", { class: "cer-acct-robux" }, ui.icon("robux", 16), fmt.full(c.robux)));
    });
    J(`https://premiumfeatures.roblox.com/v1/users/${me.id}/validate-membership`).then((p) => {
      if (p == null) return billing.set("premium", null);
      billing.set("premium", p === true ? yes("Member") : no("Not a member"));
      if (p === true) tags.prepend(ui.badge("Premium", "accent", "crown"));
    });
    J("https://billing.roblox.com/v1/credit").then((c) => {
      const bal = c?.balance;
      billing.set("credit", bal == null ? null : bal > 0 ? (c.currencyCode ? bal.toLocaleString("en", { style: "currency", currency: c.currencyCode }) : String(bal)) : h("span", { class: "cer-acct-muted", text: "None" }));
    });

    J("https://users.roblox.com/v1/users/authenticated/age-bracket", 600000).then((a) => {
      const b = a?.ageBracket;
      parents.set("age", b == null ? null : b === 0 ? "13 or older" : "Under 13");
    });

    // anything still loading after 8 s shows "Open to see"
    setTimeout(() => [info, security, privacy, notes, billing, parents].forEach((c) => c.isConnected && c.done()), 8000);
  });
})();
