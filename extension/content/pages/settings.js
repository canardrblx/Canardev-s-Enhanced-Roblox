// CER account page (/my/account). Built on CER.ui (content/ui.js).
// Minimal on purpose: who you are, then one short list of places to go.
// Every row opens Roblox's own settings section (ui.nativeUrl), which runs
// its own checks; this page only reads a couple of statuses.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api } = CER;
  const h = ui.h;

  const native = (section) => ui.nativeUrl("/my/account#!/" + section);

  // One list row: icon, label, optional status, chevron.
  function row(o) {
    const status = h("span", { class: "cer-acct-status" });
    const el = h(
      o.href ? "a" : "button",
      { class: "cer-acct-row", href: o.href, type: o.href ? null : "button", onClick: o.onClick },
      h("span", { class: "cer-acct-row-icon" }, ui.icon(o.icon, 20)),
      h("span", { class: "cer-acct-row-label", text: o.label }),
      status,
      ui.icon("right", 18, "cer-acct-row-go")
    );
    el.status = (value, tone) => {
      status.className = "cer-acct-status" + (tone ? " is-" + tone : "");
      status.replaceChildren(...[value ?? ""].flat());
    };
    return el;
  }

  ui.route("settings", async () => {
    const me = await api.me();
    if (!me) {
      // only a real 401/403 means signed out; anything else is a hiccup
      if (CER.loggedOut) return ui.release();
      ui.page("settings", "cer-acct").page.append(ui.empty("Could not load this. Try again soon.", { icon: "refresh" }));
      return;
    }
    const { page } = ui.page("settings", "cer-acct");

    const account = row({ icon: "user", label: "Account", href: "/my/account#!/info" });
    const security = row({ icon: "shield", label: "Security", href: native("security") });
    const privacy = row({ icon: "lock", label: "Privacy", href: "/my/account#!/privacy" });
    const notes = row({ icon: "bell", label: "Notifications", href: "/my/account#!/notifications" });
    const billing = row({ icon: "wallet", label: "Billing", href: native("billing") });
    const parents = row({ icon: "users", label: "Parental controls", href: native("parental-controls") });
    const cer = row({ icon: "sliders", label: "CER settings", onClick: () => CER.openSettings?.() });

    page.append(
      h(
        "a",
        { class: "cer-acct-me", href: `https://www.roblox.com/users/${me.id}/profile` },
        ui.avatar(me.id, { size: 88 }),
        h("span", { class: "cer-acct-me-text" }, ui.nameTag({ type: "user", id: me.id, name: me.displayName || me.name, size: "lg", cls: "cer-acct-name" }), h("span", { class: "cer-acct-handle", text: "@" + me.name }))
      ),
      h("nav", { class: "cer-acct-list" }, account, security, privacy, notes, billing, parents),
      // every theme, Roblox's and CER's, in the same picker as CER settings
      h("section", { class: "cer-acct-theme" }, h("h2", { class: "cer-acct-title", text: "Theme" }), CER.themePicker()),
      h("nav", { class: "cer-acct-list" }, cer)
    );

    // Rows stay bare; the one status worth showing is a missing 2-step.
    const tsv = await api.json(`https://twostepverification.roblox.com/v1/users/${me.id}/configuration`);
    if (Array.isArray(tsv?.methods) && !tsv.methods.some((m) => m.enabled)) security.status("2-step off", "warn");
  });
})();
