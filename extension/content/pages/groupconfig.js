// CER group manager: /communities/configure?id=N, /communities/N/configure,
// /groups/configure?id=N. Built on CER.ui (content/ui.js), from scratch.
//
// A guild screen for owners and admins. The hero is the group (icon, name,
// Rename / Change icon); under it four tabs: Members, Requests, Roles, Info
// (shout, about, links). Rare things (Settings, Log, Roblox-only sections)
// sit under More. Each shows only when you have the right for it.
// Data comes from groups.roblox.com only (never Roblox's page DOM).
// Powerful rights (kick, ban, change roles, edit games...) and promotions to
// a powerful role ask first, with Cancel focused.
//
// Writes are the official groups API, each behind a clear button:
//   change role   PATCH  /v1/groups/{g}/users/{u}                 { roleId }
//   kick          DELETE /v1/groups/{g}/users/{u}                 (confirm)
//   accept        POST   /v1/groups/{g}/join-requests/users/{u}
//   accept all    POST   /v1/groups/{g}/join-requests             { userIds } (confirm)
//   say no        DELETE /v1/groups/{g}/join-requests/users/{u}   (confirm)
//   role info     PATCH  /v1/groups/{g}/rolesets/{r}              { name, description, rank }
//   permission    PATCH  /v1/groups/{g}/roles/{r}/permissions     { permissions: { key: bool } }
//   description   PATCH  /v1/groups/{g}/description               { description }
//   shout         PATCH  /v1/groups/{g}/status                    { message }
//   links         POST/PATCH/DELETE /v1/groups/{g}/social-links[/{id}] { type, url, title } (remove: confirm)
//   settings      PATCH  /v1/groups/{g}/settings                  { key: bool }
// (Same endpoints and bodies as Roblox's own ConfigureGroup bundle.)
//
// NEVER here: leave, transfer ownership, delete. Anything with Robux (revenue,
// payouts, funds, renaming, new roles, spend permissions) opens Roblox's own
// page through ui.nativeUrl().
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api, fmt } = CER;
  const h = ui.h;
  const TAG = "groupconfig";
  const GROUPS = "https://groups.roblox.com";

  // ---------------------------------------------------------------- urls
  const gidFromUrl = () =>
    location.pathname.match(/^\/(?:communities|groups)\/(\d+)\/configure/i)?.[1] ??
    (new URLSearchParams(location.search).get("id") ?? "").match(/^\d+$/)?.[0] ??
    null;
  const slug = (s) => String(s ?? "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "group";
  const groupUrl = (id, name) => `https://www.roblox.com/communities/${id}/${slug(name)}`;
  const profileUrl = (id) => `https://www.roblox.com/users/${id}/profile`;
  const native = (gid, section) => ui.nativeUrl(`https://www.roblox.com/communities/configure?id=${gid}#!/${section}`);
  const safeHref = (u) => (/^https?:\/\//i.test(u ?? "") ? u : null);

  // Roblox's configure sections (#!/name). Ours map to a tab; the rest are
  // Roblox-only (money, logs, forums...) and open its page.
  const HASH_TAB = { information: "info", members: "members", requests: "requests", roles: "roles", socialLinks: "info", settings: "settings", auditLog: "log" };
  const TAB_HASH = { info: "information", members: "members", requests: "requests", roles: "roles", settings: "settings", log: "auditLog" };
  const hashSection = () => location.hash.replace(/^#!?\/?/, "").split(/[/?]/)[0];
  const NATIVE_ONLY = /^(revenue|payouts|affiliates|forums|contentModeration|analytics|communityTier|bans|experiences)$/i;

  // Rights that let a role hurt the group. Turning one on, or promoting
  // someone into a role that has one, asks first.
  const POWER = new Set(["changeRank", "removeMembers", "banMembers", "manageGroupGames", "manageItems", "manageRelationships", "manageKeywordBlockList"]);
  const hasPower = (perms) => Object.values(perms ?? {}).some((cat) => cat && typeof cat === "object" && Object.entries(cat).some(([k, v]) => v === true && POWER.has(k)));

  // ---------------------------------------------------------------- writes
  // One official API call. { ok, status, data, msg }. Never throws.
  async function write(url, method, body) {
    let res = null;
    try {
      res = await CER.robloxWrite(url, method, body ?? {});
    } catch {
      /* network */
    }
    const data = res ? await res.json().catch(() => null) : null;
    return { ok: !!res?.ok, status: res?.status ?? 0, data, msg: data?.errors?.[0]?.message ?? "" };
  }
  // Short, kid-friendly reason for a failed write
  function failText(r) {
    const m = r.msg || "";
    if (r.status === 429 || /too many|flood/i.test(m)) return "Too fast. Wait a bit and try again.";
    if (r.status === 401 || r.status === 403 || /permission|authoriz/i.test(m)) return "You can't do that here.";
    if (/moderat|filter|inappropriate/i.test(m)) return "Roblox did not allow that text.";
    return "That did not work. Try again.";
  }
  const toastFail = (r) => CER.toast?.(failText(r), "error");

  // Yes / no question. Resolves true only on the yes button. Cancel has the
  // focus, so Enter or a stray tap is the safe answer.
  function ask(o) {
    return new Promise((resolve) => {
      let yes = false;
      const m = ui.modal({
        title: o.title,
        class: "cer-gm-ask",
        body: o.text && h("p", { text: o.text }),
        onClose: () => resolve(yes),
        actions: [
          { label: "Cancel", variant: "ghost", onClick: (close) => close() },
          { label: o.ok, variant: o.tone ?? "danger", onClick: (close) => ((yes = true), close()) },
        ],
      });
      m?.el?.querySelector(".cer-modal-actions .cer-btn")?.focus();
    });
  }

  // ---------------------------------------------------------------- route
  let current = null;
  ui.route(TAG, start);

  async function start() {
    const gid = gidFromUrl();
    if (!gid) return ui.release();
    const section = hashSection();
    if (NATIVE_ONLY.test(section)) {
      location.replace(native(gid, section)); // Roblox-only section: its page
      return;
    }

    const { page } = ui.page(TAG, "cer-gm");
    const run = { gid };
    current = run;
    const alive = () => current === run && page.isConnected;

    // shell first: header, tab bar and body as skeletons
    const top = h("div", { class: "cer-gm-top cer-on-art is-loading" }, h("div", { class: "cer-gm-top-bg" }), h("div", { class: "cer-gm-top-shade" }), h("div", { class: "cer-gm-top-icon" }), h("div", { class: "cer-gm-top-text" }, ui.skeleton("line"), ui.skeleton("line")));
    const bar = h("div", { class: "cer-gm-bar" }, h("div", { class: "cer-gm-bar-sk" }, ui.skeleton("line")));
    const body = h("div", { class: "cer-gm-body" }, h("div", { class: "cer-gm-sk" }, ui.skeleton("row", 6)));
    page.append(top, bar, body);

    // everything in parallel
    const meP = api.me();
    const infoP = api.json(`${GROUPS}/v1/groups/${gid}`);
    const memUrl = `${GROUPS}/v1/groups/${gid}/membership`;
    const memP = api.json(memUrl).then((m) => (m?.groupId ? m : api.json(memUrl, { bg: true })));
    const rolesP = api.json(`${GROUPS}/v1/groups/${gid}/roles`);
    const reqP = memP.then((m) => (m?.permissions?.groupMembershipPermissions?.inviteMembers ? loadRequests(gid, "Desc") : null));

    const [me, info, mem] = await Promise.all([meP, infoP, memP]);
    if (!alive()) return;
    if (!me) {
      if (CER.loggedOut) return ui.release();
      return failPage(page, "We could not load this. Try again soon.");
    }
    if (!info?.id || !mem?.groupId) return failPage(page, "We could not load this group.", native(gid, "information"));

    const P = mem.permissions ?? {};
    const myRank = mem.userRole?.role?.rank ?? 0;
    const owner = !!mem.isOwner || myRank === 255 || info.owner?.userId === me.id;
    const can = {
      owner,
      rank: !!P.groupMembershipPermissions?.changeRank,
      invite: !!P.groupMembershipPermissions?.inviteMembers,
      remove: !!P.groupMembershipPermissions?.removeMembers,
      ban: !!P.groupMembershipPermissions?.banMembers,
      shout: !!P.groupPostsPermissions?.postToStatus,
      allies: !!P.groupManagementPermissions?.manageRelationships,
      log: !!P.groupManagementPermissions?.viewAuditLogs,
      stats: !!(P.groupManagementPermissions?.viewCommunityAnalytics || P.groupEconomyPermissions?.viewAnalytics),
      forums: !!P.groupForumsPermissions?.manageCategories,
      words: !!P.groupContentModerationPermissions?.viewKeywordBlockList,
      money: owner || !!P.groupEconomyPermissions?.spendGroupFunds,
    };
    // not an admin at all: Roblox's page (it explains what you can see)
    if (!(owner || can.rank || can.invite || can.remove || can.shout || mem.canConfigure)) return ui.release();
    if (section === "auditLog" && !can.log) {
      location.replace(native(gid, section));
      return;
    }

    document.title = `Manage ${info.name} - Roblox`;
    // role rights, shared by Roles and the promotion check. A failed load is
    // not kept, so the next ask tries again.
    let permsP = null;
    const rolePerms = () =>
      (permsP ??= api.json(`${GROUPS}/v1/groups/${gid}/roles/permissions`).then((j) => {
        if (!Array.isArray(j?.data)) permsP = null;
        return j;
      }));
    const ctx = { gid, info, mem, me, myRank, can, rolesP, rolePerms, alive, page };
    header(ctx, top);

    // ---- tabs: only the ones you can use
    const tabs = [];
    if (can.rank || can.remove) tabs.push({ id: "members", label: "Members" });
    if (can.invite) tabs.push({ id: "requests", label: "Requests" });
    if (owner) tabs.push({ id: "roles", label: "Roles" });
    if (owner || can.shout) tabs.push({ id: "info", label: "Info" });
    if (!tabs.length) return ui.release();
    // rarely used panes live under More
    const extra = [];
    if (owner) extra.push({ id: "settings", label: "Settings", icon: "sliders" });
    if (can.log) extra.push({ id: "log", label: "Log", icon: "list" });
    const known = (id) => tabs.some((t) => t.id === id) || extra.some((t) => t.id === id);

    const firstReq = await reqP;
    if (!alive()) return;
    ctx.firstReq = firstReq;
    const reqTab = tabs.find((t) => t.id === "requests");
    const setReqCount = (n) => {
      if (!reqTab) return;
      reqTab.count = n > 0 ? n : null;
      renderBar();
    };
    ctx.setReqCount = setReqCount;
    if (reqTab && firstReq?.list.length) reqTab.count = firstReq.list.length;

    const wanted = HASH_TAB[section];
    let active = known(wanted) ? wanted : reqTab?.count ? "requests" : tabs[0].id;
    const panes = {};
    const BUILD = { members: buildMembers, requests: buildRequests, roles: buildRoles, info: buildInfo, settings: buildSettings, log: buildLog };

    const more = moreMenu(ctx, extra, (id) => setTab(id));
    function renderBar() {
      if (!alive()) return;
      bar.replaceChildren(...[ui.tabs(tabs, active, setTab), more].filter(Boolean));
      more?.setActive(extra.some((t) => t.id === active));
    }
    function setTab(id) {
      active = id;
      const u = new URL(location.href);
      u.hash = "#!/" + TAB_HASH[id];
      if (u.href !== location.href) history.replaceState(history.state, "", u.href);
      renderBar();
      if (!panes[id]) {
        panes[id] = h("div", { class: "cer-gm-pane", "data-tab": id });
        body.append(panes[id]);
        BUILD[id](ctx, panes[id]);
      }
      for (const [k, el] of Object.entries(panes)) el.hidden = k !== id;
    }
    body.replaceChildren();
    setTab(active);
  }

  function failPage(page, text, href) {
    page.replaceChildren(ui.empty(text, { icon: "users", action: href ? ui.button("Open on Roblox", { variant: "primary", href }) : ui.button("Try again", { variant: "soft", onClick: () => location.reload() }) }));
  }

  // ---------------------------------------------------------------- header
  // The group lives here and only here: icon over its own blurred colours,
  // name, members, your role. The owner's Change icon / Rename sit on it
  // (both open Roblox: renaming costs Robux). Icon and name go to the group.
  function header(ctx, top) {
    const { gid, info, mem, can } = ctx;
    const role = mem.userRole?.role;
    const bg = top.querySelector(".cer-gm-top-bg");
    api.thumb("groupIconLg", gid).then((u) => {
      if (u) bg.style.backgroundImage = `url("${String(u).replace(/"/g, "")}")`;
      top.classList.toggle("has-image", !!u);
    });
    top.classList.remove("is-loading");
    top.replaceChildren(
      bg,
      h("div", { class: "cer-gm-top-shade" }),
      h("a", { class: "cer-gm-top-icon", href: groupUrl(gid, info.name), title: info.name }, ui.thumb("groupIconLg", gid, { alt: "" })),
      h(
        "div",
        { class: "cer-gm-top-text" },
        ui.nameTag({ type: "group", id: gid, name: info.name, verified: info.hasVerifiedBadge, size: "lg", cls: "cer-gm-top-name", href: groupUrl(gid, info.name) }),
        h(
          "div",
          { class: "cer-gm-top-meta" },
          h("span", {}, ui.icon("users", 16), h("span", { text: fmt.full(info.memberCount) })),
          role && !can.owner && h("span", {}, ui.icon("shield", 16), h("span", { text: role.name }))
        )
      ),
      can.owner &&
        h(
          "div",
          { class: "cer-gm-top-actions" },
          ui.button("Change icon", { icon: "image", variant: "glass", size: "sm", href: native(gid, "information") }),
          ui.button("Rename", { icon: "robux", variant: "glass", size: "sm", href: native(gid, "information"), title: "Renaming costs Robux. Opens Roblox." })
        )
    );
  }

  // "More" menu: CER panes you rarely need (extra), then Roblox-only
  // sections, each opening Roblox's page. null when there is nothing.
  function moreMenu(ctx, extra, open) {
    const { gid, can } = ctx;
    const links = [
      can.money && { icon: "robux", label: "Robux and payouts", section: "revenue" },
      can.allies && { icon: "shield", label: "Allies", section: "affiliates" },
      can.ban && { icon: "lock", label: "Bans", section: "members" },
      can.forums && { icon: "chat", label: "Forums", section: "forums" },
      can.words && { icon: "eye", label: "Chat safety", section: "contentModeration" },
      can.stats && { icon: "trophy", label: "Stats", section: "analytics" },
      can.owner && { icon: "star", label: "Tier", section: "communityTier" },
    ].filter(Boolean);
    if (!extra.length && !links.length) return null;
    const btn = ui.button("More", { icon: "more", variant: "ghost", size: "sm" });
    btn.setAttribute("aria-haspopup", "menu");
    const menu = h(
      "div",
      { class: "cer-gm-menu", role: "menu", hidden: true },
      extra.map((it) =>
        h("button", { type: "button", class: "cer-gm-menu-item", role: "menuitem", onClick: () => (hide(), open(it.id)) }, ui.icon(it.icon, 17), h("span", { text: it.label }))
      ),
      extra.length && links.length && h("div", { class: "cer-gm-menu-line" }),
      links.map((it) => h("a", { class: "cer-gm-menu-item", role: "menuitem", href: native(gid, it.section) }, ui.icon(it.icon, 17), h("span", { text: it.label }), ui.icon("external", 14, "cer-gm-menu-go")))
    );
    const wrap = h("div", { class: "cer-gm-more" }, btn, menu);
    const outside = (e) => !wrap.contains(e.target) && hide();
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      hide();
      btn.focus();
    };
    function hide() {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", onKey);
    }
    btn.addEventListener("click", () => {
      if (!menu.hidden) return hide();
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", onKey);
    });
    // a More pane is on screen: the button reads as the active tab
    wrap.setActive = (on) => btn.classList.toggle("is-active", !!on);
    return wrap;
  }

  // ---------------------------------------------------------------- shared bits
  function loadMore(onClick) {
    const b = ui.button("More", { variant: "soft" });
    const wrap = h("div", { class: "cer-gm-morebar" }, b);
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      b.busy(true);
      const more = await onClick();
      b.busy(false);
      if (more === null) CER.toast?.("Could not load more. Try again.", "error");
      else if (!more) wrap.remove();
    });
    return wrap;
  }
  const field = (props) => h("input", { class: "cer-gm-field", spellcheck: "false", autocomplete: "off", ...props });
  const area = (props) => h("textarea", { class: "cer-textarea cer-gm-area", ...props });
  const userName = (u, opts = {}) => ui.nameTag({ type: "user", id: u.id, name: u.displayName || u.name, sub: opts.sub === false ? null : "@" + u.name, verified: u.verified, size: opts.size ?? "md", href: profileUrl(u.id) });
  // a "Save" button that only shows once the form changes (b.hidden)
  function saveButton(label, onSave, icon) {
    const b = ui.button(label, { variant: "primary", size: "sm", icon });
    b.hidden = true;
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      b.busy(true);
      const ok = await onSave();
      b.busy(false);
      if (ok) b.hidden = true;
    });
    return b;
  }

  // Text box with a counter that shows only while you type and a button
  // that shows only once there is something to save. o: { value, max, rows,
  // placeholder, label, button, icon, clear, onSave(text) -> ok }
  function editor(o) {
    let saved = o.clear ? "" : o.value ?? "";
    const box = area({ value: saved, maxlength: String(o.max), rows: String(o.rows ?? 3), placeholder: o.placeholder ?? "", "aria-label": o.label });
    const left = h("span", { class: "cer-gm-left" });
    const save = saveButton(o.button ?? "Save", async () => {
      const ok = await o.onSave(o.clear ? box.value.trim() : box.value);
      if (!ok) return false;
      saved = o.clear ? "" : box.value;
      if (o.clear) box.value = "";
      sync();
      return true;
    }, o.icon);
    const row = h("div", { class: "cer-gm-row-end" }, left, save);
    let focused = false;
    function sync() {
      const dirty = o.clear ? !!box.value.trim() : box.value !== saved;
      left.textContent = fmt.full(o.max - box.value.length);
      left.hidden = !focused;
      save.hidden = !dirty;
      row.hidden = !focused && !dirty;
    }
    box.addEventListener("input", sync);
    box.addEventListener("focus", () => ((focused = true), sync()));
    box.addEventListener("blur", () => ((focused = false), sync()));
    sync();
    return h("div", { class: "cer-gm-editor" }, box, row);
  }

  // ---------------------------------------------------------------- members
  const normAll = (x) => ({ id: x.user.userId, name: x.user.username, displayName: x.user.displayName, verified: x.user.hasVerifiedBadge, role: x.role });
  const normRole = (u, role) => ({ id: u.userId, name: u.username, displayName: u.displayName, verified: u.hasVerifiedBadge, role });

  function buildMembers(ctx, pane) {
    const { gid, myRank, can, me } = ctx;
    let roles = [];
    let roleFilter = "all";
    let query = "";
    const state = { list: [], cursor: "", done: false };

    const search = ui.search("Find a member", {
      class: "cer-gm-search",
      onInput: (v) => ((query = v.toLowerCase()), render()),
      onSubmit: (v) => v && lookup(v),
    });
    const roleSlot = h("span", { class: "cer-gm-roleslot" });
    const grid = h("div", { class: "cer-gm-members" }, ui.skeleton("row", 8));
    const foot = h("div", { class: "cer-gm-foot" });
    pane.append(h("div", { class: "cer-gm-tools" }, search, roleSlot), grid, foot);

    ctx.rolesP.then((r) => {
      if (!ctx.alive()) return;
      roles = (r?.roles ?? []).filter((x) => x.rank > 0).sort((a, b) => b.rank - a.rank);
      if (roles.length > 1)
        roleSlot.replaceChildren(
          ui.select([{ id: "all", label: "All roles" }, ...roles.filter((x) => x.memberCount > 0).map((x) => ({ id: String(x.id), label: `${x.name} (${fmt.num(x.memberCount)})` }))], "all", (v) => {
            roleFilter = v;
            reset();
          })
        );
      renderRows(); // role pickers need the role list
    });

    // roles you may give: above guest, below you
    const assignable = () => roles.filter((x) => x.rank > 0 && x.rank < myRank);
    const editable = (m) => m.id !== me.id && m.role && m.role.rank > 0 && m.role.rank < myRank;

    function reset() {
      Object.assign(state, { list: [], cursor: "", done: false });
      grid.replaceChildren(...ui.skeleton("row", 8));
      foot.replaceChildren();
      page();
    }
    async function page() {
      const role = roleFilter === "all" ? null : roles.find((x) => String(x.id) === roleFilter);
      const cur = state.cursor ? "&cursor=" + encodeURIComponent(state.cursor) : "";
      const url = role ? `${GROUPS}/v1/groups/${gid}/roles/${role.id}/users?limit=100&sortOrder=Desc${cur}` : `${GROUPS}/v1/groups/${gid}/users?limit=100&sortOrder=Desc${cur}`;
      const j = await api.json(url);
      if (!ctx.alive() || (role ? String(role.id) : "all") !== roleFilter) return false;
      if (!j) {
        if (!state.list.length) grid.replaceChildren(ui.empty("We could not load the members.", { icon: "users", action: ui.button("Try again", { variant: "soft", onClick: reset }) }));
        return null;
      }
      const got = (j.data ?? []).map((x) => (role ? normRole(x, role) : normAll(x)));
      state.list.push(...got);
      state.cursor = j.nextPageCursor;
      state.done = !state.cursor;
      render();
      if (!state.done && !foot.firstChild) foot.append(loadMore(page));
      return !state.done;
    }

    function render() {
      const shown = query ? state.list.filter((m) => (m.name + " " + (m.displayName ?? "")).toLowerCase().includes(query)) : state.list;
      if (!shown.length) {
        grid.replaceChildren(
          h(
            "div",
            { class: "cer-gm-none" },
            ui.empty(query ? "Not in this list. Press Enter to look for them." : "Nobody here yet.", { icon: query ? "search" : "users" })
          )
        );
        return;
      }
      grid.replaceChildren(...shown.map(memberRow));
    }
    const renderRows = () => state.list.length && render();

    // exact username lookup (members not loaded yet)
    async function lookup(name) {
      const local = state.list.find((m) => m.name.toLowerCase() === name.toLowerCase());
      if (local) return;
      grid.replaceChildren(ui.skeleton("row"));
      const u = await api.json("https://users.roblox.com/v1/usernames/users", { method: "POST", body: { usernames: [name], excludeBannedUsers: false } });
      const user = u?.data?.[0];
      if (!ctx.alive() || query !== name.toLowerCase()) return;
      if (!user) return grid.replaceChildren(h("div", { class: "cer-gm-none" }, ui.empty("No one has that name.", { icon: "search" })));
      const g = await api.json(`${GROUPS}/v2/users/${user.id}/groups/roles`);
      if (!ctx.alive() || query !== name.toLowerCase()) return;
      const hit = g?.data?.find((x) => String(x.group?.id) === String(gid));
      if (!hit) return grid.replaceChildren(h("div", { class: "cer-gm-none" }, ui.empty(g ? "They are not in this group." : "We could not check. Try again.", { icon: "users" })));
      grid.replaceChildren(memberRow({ id: user.id, name: user.name, displayName: user.displayName, verified: user.hasVerifiedBadge, role: hit.role }));
    }

    function memberRow(m) {
      const row = h("div", { class: "cer-gm-mem" });
      const tools = h("div", { class: "cer-gm-mem-tools" });
      const mine = assignable();
      if (can.rank && editable(m) && mine.length) {
        const opts = mine.map((x) => ({ id: String(x.id), label: x.name }));
        if (!opts.some((o) => o.id === String(m.role.id))) opts.unshift({ id: String(m.role.id), label: m.role.name });
        const wrap = ui.select(opts, String(m.role.id), (v) => changeRole(m, v, sel));
        wrap.classList.add("cer-gm-rolepick");
        const sel = wrap.querySelector("select");
        sel.setAttribute("aria-label", "Role");
        tools.append(wrap);
      } else if (m.role) tools.append(h("span", { class: "cer-gm-role" + (m.role.rank === 255 ? " is-owner" : "") }, m.role.rank === 255 && ui.icon("crown", 14), h("span", { text: m.role.name })));
      if (can.remove && editable(m)) {
        const kick = ui.button("", { icon: "x", variant: "ghost", size: "sm", title: "Kick" });
        kick.addEventListener("click", () => exile(m, row, kick));
        tools.append(kick);
      }
      row.append(h("a", { class: "cer-gm-mem-art", href: profileUrl(m.id), tabindex: "-1" }, ui.avatar(m.id, { size: 52 })), h("div", { class: "cer-gm-mem-text" }, userName(m)), tools);
      return row;
    }

    // Promoting into a role with strong rights asks first. If we cannot read
    // the role rights, every promotion asks.
    async function powerOf(roleId) {
      const j = await ctx.rolePerms();
      const row = j?.data?.find((x) => String(x.role?.id) === String(roleId));
      return row ? hasPower(row.permissions) : null;
    }

    async function changeRole(m, roleId, sel) {
      const role = roles.find((x) => String(x.id) === roleId);
      if (!role) return;
      sel.disabled = true;
      if (role.rank > (m.role?.rank ?? 0)) {
        const strong = await powerOf(role.id);
        if (!ctx.alive()) return;
        const name = m.displayName || m.name;
        const ok =
          strong === false ||
          (await ask({ title: `Make ${name} ${role.name}?`, text: strong ? "This role has strong powers." : "This gives them a higher role.", ok: "Yes", tone: "primary" }));
        if (!ok) {
          sel.value = String(m.role.id);
          sel.disabled = false;
          return;
        }
      }
      const r = await write(`${GROUPS}/v1/groups/${gid}/users/${m.id}`, "PATCH", { roleId: Number(role.id) });
      sel.disabled = false;
      if (r.ok) {
        m.role = { id: role.id, name: role.name, rank: role.rank };
        CER.toast?.(`${m.displayName || m.name} is ${role.name} now.`);
      } else {
        sel.value = String(m.role.id);
        toastFail(r);
      }
    }

    async function exile(m, row, btn) {
      const name = m.displayName || m.name;
      if (!(await ask({ title: `Kick ${name}?`, text: "They leave the group. They can ask to join again.", ok: "Kick" }))) return;
      btn.busy(true);
      const r = await write(`${GROUPS}/v1/groups/${gid}/users/${m.id}`, "DELETE");
      btn.busy(false);
      if (!r.ok) return toastFail(r);
      state.list = state.list.filter((x) => x.id !== m.id);
      row.classList.add("is-gone");
      setTimeout(() => row.remove(), 220);
      CER.toast?.(`${name} was kicked.`);
    }

    page();
  }

  // ---------------------------------------------------------------- requests
  // One page of join requests. { list, next } or null.
  async function loadRequests(gid, sort, cursor = "") {
    const cur = cursor ? "&cursor=" + encodeURIComponent(cursor) : "";
    const j = await api.json(`${GROUPS}/v1/groups/${gid}/join-requests?limit=100&sortOrder=${sort}${cur}`);
    if (!Array.isArray(j?.data)) return null;
    return {
      list: j.data.filter((x) => x.requester?.userId).map((x) => ({ id: x.requester.userId, name: x.requester.username, displayName: x.requester.displayName, verified: x.requester.hasVerifiedBadge, created: x.created })),
      next: j.nextPageCursor ?? null,
    };
  }

  function buildRequests(ctx, pane) {
    const { gid } = ctx;
    let sort = "Desc";
    let when = "all";
    let query = "";
    let state = { list: [], next: null };

    const search = ui.search("Find a name", { class: "cer-gm-search", onInput: (v) => ((query = v.toLowerCase()), render()) });
    const whenChips = ui.chips(
      [
        { id: "all", label: "All" },
        { id: "day", label: "Today" },
        { id: "week", label: "This week" },
      ],
      when,
      (v) => ((when = v), render())
    );
    const sortPick = ui.select(
      [
        { id: "Desc", label: "Newest" },
        { id: "Asc", label: "Oldest" },
      ],
      sort,
      (v) => ((sort = v), reload())
    );
    const acceptAll = ui.button("Accept all", { icon: "check", variant: "soft", size: "sm" });
    acceptAll.addEventListener("click", () => doAcceptAll());
    const grid = h("div", { class: "cer-gm-reqs" });
    const foot = h("div", { class: "cer-gm-foot" });
    pane.append(h("div", { class: "cer-gm-tools" }, search, whenChips, h("span", { class: "cer-gm-tools-end" }, sortPick, acceptAll)), grid, foot);

    const age = { day: 864e5, week: 7 * 864e5 };
    const shown = () =>
      state.list.filter((r) => (!query || (r.name + " " + (r.displayName ?? "")).toLowerCase().includes(query)) && (when === "all" || Date.now() - new Date(r.created).getTime() < age[when]));
    const count = () => ctx.setReqCount(state.list.length);

    function render() {
      const list = shown();
      acceptAll.hidden = !list.length;
      if (!list.length) {
        grid.replaceChildren(h("div", { class: "cer-gm-none" }, ui.empty(state.list.length ? "No match." : "No one is waiting.", { icon: state.list.length ? "search" : "userCheck" })));
        return;
      }
      grid.replaceChildren(...list.map(tile));
    }

    function setPage(p, append) {
      if (!append) state = { list: [], next: null };
      state.list.push(...p.list);
      state.next = p.next;
      foot.replaceChildren();
      if (state.next) foot.append(loadMore(async () => {
        const more = await loadRequests(gid, sort, state.next);
        if (!more || !ctx.alive()) return null;
        setPage(more, true);
        render();
        count();
        return false; // setPage added a fresh button if there is more
      }));
    }

    async function reload() {
      grid.replaceChildren(...ui.skeleton("tile", 6));
      foot.replaceChildren();
      const p = await loadRequests(gid, sort);
      if (!ctx.alive()) return;
      if (!p) return grid.replaceChildren(h("div", { class: "cer-gm-none" }, ui.empty("We could not load the requests.", { icon: "users", action: ui.button("Try again", { variant: "soft", onClick: reload }) })));
      setPage(p);
      render();
      count();
    }

    const gone = (r, el) => {
      state.list = state.list.filter((x) => x.id !== r.id);
      count();
      el.classList.add("is-gone");
      setTimeout(() => (el.remove(), grid.childElementCount || render()), 220);
    };

    function tile(r) {
      const el = h("div", { class: "cer-gm-req" });
      const yes = ui.button("", { icon: "check", variant: "primary", size: "sm", title: "Accept" });
      const no = ui.button("", { icon: "x", variant: "soft", size: "sm", title: "Say no" });
      yes.addEventListener("click", async () => {
        yes.busy(true);
        no.disabled = true;
        const res = await write(`${GROUPS}/v1/groups/${gid}/join-requests/users/${r.id}`, "POST");
        yes.busy(false);
        no.disabled = false;
        if (!res.ok) return toastFail(res);
        CER.toast?.(`${r.displayName || r.name} joined!`);
        gone(r, el);
      });
      no.addEventListener("click", async () => {
        const name = r.displayName || r.name;
        if (!(await ask({ title: `Say no to ${name}?`, text: "They can ask again later.", ok: "Say no" }))) return;
        no.busy(true);
        yes.disabled = true;
        const res = await write(`${GROUPS}/v1/groups/${gid}/join-requests/users/${r.id}`, "DELETE");
        no.busy(false);
        yes.disabled = false;
        if (!res.ok) return toastFail(res);
        gone(r, el);
      });
      el.append(
        h("a", { class: "cer-gm-req-art", href: profileUrl(r.id), tabindex: "-1" }, ui.avatar(r.id, { size: 96 })),
        h("div", { class: "cer-gm-req-name" }, userName(r, { size: "sm", sub: false })),
        h("div", { class: "cer-gm-req-when", text: fmt.ago(r.created) }),
        h("div", { class: "cer-gm-req-act" }, no, yes)
      );
      return el;
    }

    async function doAcceptAll() {
      const list = shown();
      if (!list.length) return;
      const n = list.length;
      if (!(await ask({ title: n === 1 ? "Let 1 person in?" : `Let ${n} people in?`, text: "They all join the group.", ok: "Accept all", tone: "primary" }))) return;
      acceptAll.busy(true);
      let okCount = 0;
      let fail = null;
      for (let i = 0; i < list.length; i += 50) {
        const chunk = list.slice(i, i + 50);
        const r = await write(`${GROUPS}/v1/groups/${gid}/join-requests`, "POST", { userIds: chunk.map((x) => x.id) });
        if (!r.ok) {
          fail = r;
          break;
        }
        okCount += chunk.length;
        const ids = new Set(chunk.map((x) => x.id));
        state.list = state.list.filter((x) => !ids.has(x.id));
      }
      acceptAll.busy(false);
      if (!ctx.alive()) return;
      render();
      count();
      if (okCount) CER.toast?.(okCount === 1 ? "1 person joined!" : `${okCount} people joined!`);
      if (fail) toastFail(fail);
    }

    // first page came with the shell (it decides the tab count)
    if (ctx.firstReq) {
      setPage(ctx.firstReq);
      render();
    } else reload();
  }

  // ---------------------------------------------------------------- roles
  // Permission switches CER offers. Money, API keys and old rights are left
  // to Roblox's page (they are not listed, so they are never sent).
  const PERMS = [
    ["groupMembershipPermissions", "Members", { changeRank: "Change roles", inviteMembers: "Accept requests", removeMembers: "Kick members", banMembers: "Ban members" }],
    ["groupPostsPermissions", "Shout", { viewStatus: "See the shout", postToStatus: "Post a shout" }],
    ["groupManagementPermissions", "Manage", { manageRelationships: "Manage allies", viewAuditLogs: "See the log", viewCommunityAnalytics: "See group stats", bypassSlowmode: "Skip slow mode" }],
    ["groupEconomyPermissions", "Creations", { createItems: "Make items", manageItems: "Edit items", manageGroupGames: "Edit games", viewAnalytics: "See game stats" }],
    ["groupForumsPermissions", "Forums", { createPosts: "Make posts", createComments: "Write comments", removePosts: "Remove posts", removeComments: "Remove comments", lockPosts: "Lock posts", pinPosts: "Pin posts", manageCategories: "Edit topics", createBugReports: "Send bug reports" }],
    ["groupContentModerationPermissions", "Chat safety", { viewKeywordBlockList: "See blocked words", manageKeywordBlockList: "Edit blocked words" }],
  ];
  const GUEST_OK = { viewWall: true, viewStatus: true, viewForums: true }; // the only rights a guest role can change

  function buildRoles(ctx, pane) {
    const { gid } = ctx;
    const list = h("nav", { class: "cer-gm-rolelist" }, ui.skeleton("row", 5));
    const edit = h("div", { class: "cer-gm-roleedit" }, ui.skeleton("row", 3));
    pane.append(h("div", { class: "cer-gm-roles" }, list, edit));
    let data = [];
    let sel = null;

    ctx.rolePerms().then((j) => {
      if (!ctx.alive()) return;
      data = (j?.data ?? []).filter((x) => x.role).sort((a, b) => b.role.rank - a.role.rank);
      if (!data.length) return pane.replaceChildren(ui.empty("We could not load the roles.", { icon: "shield", action: ui.button("Open on Roblox", { variant: "soft", href: native(gid, "roles") }) }));
      const counts = new Map();
      ctx.rolesP.then((r) => {
        for (const x of r?.roles ?? []) counts.set(String(x.id), x.memberCount);
        renderList();
      });
      sel = data.find((x) => x.role.rank > 0 && x.role.rank < 255) ?? data[0];
      renderList();
      renderEdit();
      function renderList() {
        list.replaceChildren(
          ...data.map((x) => {
            const n = counts.get(String(x.role.id)) ?? x.role.memberCount;
            return h(
              "button",
              {
                type: "button",
                class: "cer-gm-rolebtn" + (x === sel ? " is-active" : ""),
                onClick: () => {
                  if (x === sel) return;
                  sel = x;
                  renderList();
                  renderEdit();
                },
              },
              h("span", { class: "cer-gm-rank", text: String(x.role.rank) }),
              h("span", { class: "cer-gm-rolebtn-name", text: x.role.name }),
              x.role.rank > 0 && n != null && h("span", { class: "cer-gm-rolebtn-n" }, ui.icon("user", 13), fmt.num(n))
            );
          }),
          ui.button("New role", { icon: "robux", variant: "ghost", size: "sm", class: "cer-gm-newrole", href: native(gid, "roles"), title: "New roles cost Robux. Opens Roblox." })
        );
      }
      // exposed for the editor (a rename updates the list)
      edit.renderList = renderList;
    });

    function renderEdit() {
      const x = sel;
      const role = x.role;
      const isOwnerRole = role.rank === 255;
      const isGuest = role.rank === 0;
      const name = field({ value: role.name, maxlength: "100", disabled: isGuest, "aria-label": "Role name" });
      const rank = field({ value: String(role.rank), type: "number", min: "1", max: "254", disabled: isGuest || isOwnerRole, class: "cer-gm-field is-rank", "aria-label": "Rank" });
      const desc = area({ value: role.description ?? "", maxlength: "1000", rows: "2", disabled: isGuest, placeholder: "What this role is for", "aria-label": "About this role" });
      const save = saveButton("Save", async () => {
        const n = name.value.trim();
        const rk = Number(rank.value);
        if (!n) return CER.toast?.("Give the role a name.", "error"), false;
        if (!isOwnerRole && (!Number.isInteger(rk) || rk < 1 || rk > 254)) return CER.toast?.("Rank must be 1 to 254.", "error"), false;
        if (data.some((o) => o !== x && o.role.rank === rk)) return CER.toast?.("Another role has that rank.", "error"), false;
        const r = await write(`${GROUPS}/v1/groups/${gid}/rolesets/${role.id}`, "PATCH", { name: n, description: desc.value, rank: rk });
        if (!r.ok) return toastFail(r), false;
        Object.assign(role, { name: r.data?.name ?? n, description: r.data?.description ?? desc.value, rank: r.data?.rank ?? rk });
        data.sort((a, b) => b.role.rank - a.role.rank);
        edit.renderList?.();
        CER.toast?.("Saved!");
        return true;
      });
      const dirty = () => (save.hidden = name.value.trim() === role.name && Number(rank.value) === role.rank && desc.value === (role.description ?? ""));
      for (const el of [name, rank, desc]) el.addEventListener("input", dirty);

      const groups = PERMS.map(([cat, title, keys]) => {
        const have = x.permissions?.[cat];
        if (!have) return null;
        const rows = Object.entries(keys)
          .filter(([k]) => k in have)
          .map(([k, label]) => {
            const locked = isOwnerRole || (isGuest && !GUEST_OK[k]);
            const t = ui.toggle(have[k], (on) => setPerm(x, cat, k, on, t, label));
            t.disabled = locked;
            t.setAttribute("aria-label", label);
            return h("label", { class: "cer-gm-perm" + (locked ? " is-locked" : "") }, h("span", { text: label }), t);
          });
        return rows.length ? h("div", { class: "cer-gm-permgroup" }, h("h3", { class: "cer-gm-sub", text: title }), h("div", { class: "cer-gm-permrows" }, rows)) : null;
      });

      edit.replaceChildren(
        h(
          "div",
          { class: "cer-gm-rolehead" },
          h("label", { class: "cer-gm-lab is-grow" }, h("span", { text: "Name" }), name),
          h("label", { class: "cer-gm-lab" }, h("span", { text: "Rank" }), rank)
        ),
        h("label", { class: "cer-gm-lab" }, h("span", { text: "About" }), desc),
        !isGuest && h("div", { class: "cer-gm-row-end" }, save),
        h("div", { class: "cer-gm-perms" }, groups),
        h("a", { class: "cer-gm-quiet", href: native(gid, "roles") }, ui.icon("robux", 15), h("span", { text: "Robux rights are on Roblox" }), ui.icon("external", 13))
      );
    }

    async function setPerm(x, cat, key, on, t, label) {
      t.disabled = true;
      if (on && POWER.has(key)) {
        t.checked = false; // stays off unless you say yes
        const yes = await ask({ title: `Turn on ${label}?`, text: `Everyone who is ${x.role.name} can do it.`, ok: "Turn on", tone: "primary" });
        if (!yes || !ctx.alive()) return void (t.disabled = false);
        t.checked = true;
      }
      const r = await write(`${GROUPS}/v1/groups/${gid}/roles/${x.role.id}/permissions`, "PATCH", { permissions: { [key]: on } });
      t.disabled = false;
      if (r.ok) x.permissions[cat][key] = on;
      else {
        t.checked = !on;
        toastFail(r);
      }
    }
  }

  // ---------------------------------------------------------------- info
  // One plain column: Shout, About, Links. No second copy of the name or
  // icon (the hero has them), no boxes around the parts.
  function buildInfo(ctx, pane) {
    const { gid, info, can } = ctx;
    const col = h("div", { class: "cer-gm-info" });
    const block = (title, ...kids) => h("section", { class: "cer-gm-block" }, h("h3", { class: "cer-gm-sub", text: title }), ...kids);

    if (can.shout) {
      const now = h("div", { class: "cer-gm-shout" });
      const showShout = (s) => {
        const p = s?.poster;
        now.replaceChildren(
          ...(s?.body
            ? [
                h("p", { class: "cer-gm-shout-body", text: s.body }),
                h(
                  "div",
                  { class: "cer-gm-shout-by" },
                  p && h("a", { class: "cer-gm-shout-av", href: profileUrl(p.userId), tabindex: "-1" }, ui.avatar(p.userId, { size: 22 })),
                  p && ui.nameTag({ type: "user", id: p.userId, name: p.displayName || p.username, verified: p.hasVerifiedBadge, size: "sm", href: profileUrl(p.userId) }),
                  s.updated && h("span", { class: "cer-gm-muted", text: fmt.ago(s.updated) })
                ),
              ]
            : [])
        );
      };
      showShout(info.shout);
      const post = editor({
        clear: true,
        max: 255,
        rows: 2,
        placeholder: "Say something to everyone",
        label: "New shout",
        button: "Post",
        icon: "megaphone",
        onSave: async (text) => {
          const r = await write(`${GROUPS}/v1/groups/${gid}/status`, "PATCH", { message: text });
          if (!r.ok) return toastFail(r), false;
          // no verified flag on our own copy: the name tag looks it up
          info.shout = r.data?.body ? r.data : { body: text, poster: { userId: ctx.me.id, username: ctx.me.name, displayName: ctx.me.displayName }, updated: new Date().toISOString() };
          showShout(info.shout);
          CER.toast?.("Shout posted!");
          return true;
        },
      });
      col.append(block("Shout", now, post));
    }

    if (can.owner) {
      const about = editor({
        value: info.description ?? "",
        max: 1000,
        rows: 6,
        placeholder: "Tell players what your group is about",
        label: "About",
        onSave: async (text) => {
          const r = await write(`${GROUPS}/v1/groups/${gid}/description`, "PATCH", { description: text });
          if (!r.ok) return toastFail(r), false;
          info.description = r.data?.newDescription ?? text;
          CER.toast?.("Saved!");
          return true;
        },
      });
      const links = block("Links");
      buildLinks(ctx, links);
      col.append(block("About", about), links);
    }

    pane.append(col);
  }

  // ---------------------------------------------------------------- links
  const LINK_TYPES = [
    { id: "Discord", label: "Discord", icon: "chat" },
    { id: "YouTube", label: "YouTube", icon: "play" },
    { id: "Twitter", label: "X", icon: "send" },
    { id: "Twitch", label: "Twitch", icon: "gamepad" },
    { id: "Guilded", label: "Guilded", icon: "shield" },
    { id: "Facebook", label: "Facebook", icon: "users" },
    { id: "RobloxGroup", label: "Roblox group", icon: "users" },
  ];
  const linkType = (t) => LINK_TYPES.find((x) => x.id === t) ?? { id: t, label: t, icon: "link" };

  function buildLinks(ctx, pane) {
    const { gid } = ctx;
    const list = h("div", { class: "cer-gm-links" }, ui.skeleton("row", 2));
    const add = ui.button("Add link", { icon: "plus", variant: "soft", size: "sm" });
    const addSlot = h("div", { class: "cer-gm-addslot" }, add);
    pane.append(list, addSlot);
    let links = [];

    const load = () =>
      api.json(`${GROUPS}/v1/groups/${gid}/social-links`).then((j) => {
        if (!ctx.alive()) return;
        if (!Array.isArray(j?.data)) return list.replaceChildren(ui.empty("We could not load the links.", { icon: "link", action: ui.button("Try again", { variant: "soft", onClick: load }) }));
        links = j.data;
        render();
      });
    load();

    function render() {
      list.replaceChildren(...links.map(row)); // none yet: just the Add button
    }

    function row(l) {
      const t = linkType(l.type);
      const el = h("div", { class: "cer-gm-link" });
      const show = () => {
        const editBtn = ui.button("", { icon: "edit", variant: "ghost", size: "sm", title: "Edit" });
        const delBtn = ui.button("", { icon: "trash", variant: "ghost", size: "sm", title: "Remove" });
        editBtn.addEventListener("click", () => el.replaceChildren(form(l, () => show(), (nl) => (Object.assign(l, nl), show()))));
        delBtn.addEventListener("click", async () => {
          if (!(await ask({ title: "Remove this link?", text: l.title || t.label, ok: "Remove" }))) return;
          delBtn.busy(true);
          const r = await write(`${GROUPS}/v1/groups/${gid}/social-links/${l.id}`, "DELETE");
          delBtn.busy(false);
          if (!r.ok) return toastFail(r);
          links = links.filter((x) => x !== l);
          render();
        });
        el.replaceChildren(
          h("span", { class: "cer-gm-link-icon" }, ui.icon(t.icon, 20)),
          h(
            safeHref(l.url) ? "a" : "span",
            { class: "cer-gm-link-text", href: safeHref(l.url), target: "_blank", rel: "noopener noreferrer" },
            h("span", { class: "cer-gm-link-title", text: l.title || t.label }),
            h("span", { class: "cer-gm-link-url", text: String(l.url ?? "").replace(/^https?:\/\/(www\.)?/i, "") })
          ),
          editBtn,
          delBtn
        );
      };
      show();
      return el;
    }

    // add / edit form. l = existing link or null
    function form(l, onCancel, onSaved) {
      const type = ui.select(LINK_TYPES, l?.type ?? "Discord");
      const typeSel = type.querySelector("select");
      typeSel.setAttribute("aria-label", "Kind");
      const title = field({ value: l?.title ?? "", maxlength: "50", placeholder: "Name", "aria-label": "Name" });
      const url = field({ value: l?.url ?? "", type: "url", placeholder: "https://", "aria-label": "Link" });
      const cancel = ui.button("Cancel", { variant: "ghost", size: "sm", onClick: onCancel });
      const save = ui.button(l ? "Save" : "Add", { variant: "primary", size: "sm" });
      save.addEventListener("click", async () => {
        const body = { type: typeSel.value, url: url.value.trim(), title: title.value.trim() || linkType(typeSel.value).label };
        if (!safeHref(body.url)) return CER.toast?.("The link must start with https://", "error");
        save.busy(true);
        const r = l ? await write(`${GROUPS}/v1/groups/${gid}/social-links/${l.id}`, "PATCH", body) : await write(`${GROUPS}/v1/groups/${gid}/social-links`, "POST", body);
        save.busy(false);
        if (!r.ok) return toastFail(r);
        onSaved(r.data?.id ? r.data : { ...(l ?? {}), ...body });
        CER.toast?.("Saved!");
      });
      return h("div", { class: "cer-gm-linkform" }, type, title, url, h("span", { class: "cer-gm-row-end" }, cancel, save));
    }

    add.addEventListener("click", () => {
      addSlot.replaceChildren(
        form(
          null,
          () => addSlot.replaceChildren(add),
          (nl) => {
            links.push(nl);
            render();
            addSlot.replaceChildren(add);
          }
        )
      );
    });
  }

  // ---------------------------------------------------------------- settings
  const SETTINGS = [
    { key: "isApprovalRequired", label: "Players ask before they join", icon: "userCheck" },
    { key: "areGroupGamesVisible", label: "Show games on the group page", icon: "gamepad" },
    { key: "areEnemiesAllowed", label: "Other groups can be enemies", icon: "shield" },
  ];

  function buildSettings(ctx, pane) {
    const { gid } = ctx;
    const list = h("div", { class: "cer-gm-settings" }, ui.skeleton("row", 3));
    pane.append(list, h("a", { class: "cer-gm-quiet", href: native(gid, "settings") }, ui.icon("sliders", 15), h("span", { text: "More settings" }), ui.icon("external", 13)));

    const load = () =>
      api.json(`${GROUPS}/v1/groups/${gid}/settings`).then((s) => {
        if (!ctx.alive()) return;
        if (!s || typeof s !== "object") return list.replaceChildren(ui.empty("We could not load the settings.", { icon: "sliders", action: ui.button("Try again", { variant: "soft", onClick: load }) }));
        list.replaceChildren(
          ...SETTINGS.filter((x) => typeof s[x.key] === "boolean").map((x) => {
            const t = ui.toggle(s[x.key], async (on) => {
              t.disabled = true;
              const r = await write(`${GROUPS}/v1/groups/${gid}/settings`, "PATCH", { [x.key]: on });
              t.disabled = false;
              if (r.ok) s[x.key] = on;
              else {
                t.checked = !on;
                toastFail(r);
              }
            });
            t.setAttribute("aria-label", x.label);
            return h("label", { class: "cer-gm-setting" }, h("span", { class: "cer-gm-setting-icon" }, ui.icon(x.icon, 20)), h("span", { class: "cer-gm-setting-label", text: x.label }), t);
          })
        );
      });
    load();
  }
  // ---------------------------------------------------------------- log
  // Read only: who did what, newest first. Each name is a name tag.
  // Plain words for the common actions; anything else uses Roblox's name.
  const LOG_WORDS = {
    changerank: "changed the role of",
    removemember: "kicked",
    acceptjoinrequest: "let in",
    declinejoinrequest: "said no to",
    banmember: "banned",
    unbanmember: "unbanned",
    blockuser: "blocked",
    unblockuser: "unblocked",
    poststatus: "posted a shout",
    postshout: "posted a shout",
    changedescription: "changed the about text",
    updatedescription: "changed the about text",
    addally: "added an ally",
    removeally: "removed an ally",
    createitems: "made an item",
    configureitems: "changed an item",
    configuregroupgame: "changed a game",
    spendgroupfunds: "spent group Robux",
    rename: "renamed the group",
    changeowner: "changed the owner",
  };
  // the people actions: these have a user as the target
  const LOG_TARGET = new Set(["changerank", "removemember", "acceptjoinrequest", "declinejoinrequest", "banmember", "unbanmember", "blockuser", "unblockuser", "changeowner"]);
  const pick = (d, k) => d?.[k] ?? d?.[k[0].toLowerCase() + k.slice(1)];

  function buildLog(ctx, pane) {
    const { gid } = ctx;
    const list = h("div", { class: "cer-gm-log" }, ui.skeleton("row", 8));
    const foot = h("div", { class: "cer-gm-foot" });
    pane.append(list, foot, h("a", { class: "cer-gm-quiet", href: native(gid, "auditLog") }, ui.icon("list", 15), h("span", { text: "Full log on Roblox" }), ui.icon("external", 13)));
    let cursor = "";
    let count = 0;

    function row(e) {
      const u = e.actor?.user;
      const d = e.description ?? {};
      const raw = String(e.actionType ?? "");
      const key = raw.replace(/[^a-z]/gi, "").toLowerCase();
      const words = LOG_WORDS[key] ?? raw.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      const tid = pick(d, "TargetId");
      const tname = pick(d, "TargetName");
      const newRole = pick(d, "NewRoleSetName");
      return h(
        "div",
        { class: "cer-gm-logrow" },
        u?.userId ? h("a", { class: "cer-gm-log-art", href: profileUrl(u.userId), tabindex: "-1" }, ui.avatar(u.userId, { size: 40 })) : h("span", { class: "cer-gm-log-art" }),
        h(
          "div",
          { class: "cer-gm-log-text" },
          u?.userId && ui.nameTag({ type: "user", id: u.userId, name: u.displayName || u.username, verified: u.hasVerifiedBadge, size: "sm", href: profileUrl(u.userId) }),
          h("span", { class: "cer-gm-log-what", text: words }),
          LOG_TARGET.has(key) && tid && tname && /^\d+$/.test(String(tid)) && ui.nameTag({ type: "user", id: tid, name: tname, size: "sm", href: profileUrl(tid) }),
          key === "changerank" && newRole && h("span", { class: "cer-gm-log-what", text: "to " + newRole })
        ),
        e.created && h("span", { class: "cer-gm-log-when", text: fmt.ago(e.created) })
      );
    }

    async function page() {
      const cur = cursor ? "&cursor=" + encodeURIComponent(cursor) : "";
      const j = await api.json(`${GROUPS}/v1/groups/${gid}/audit-log?limit=100&sortOrder=Desc${cur}`);
      if (!ctx.alive()) return false;
      if (!Array.isArray(j?.data)) {
        if (!count) list.replaceChildren(h("div", { class: "cer-gm-none" }, ui.empty("We could not load the log.", { icon: "list", action: ui.button("Try again", { variant: "soft", onClick: retry }) })));
        return null;
      }
      if (!count) list.replaceChildren();
      list.append(...j.data.map(row));
      count += j.data.length;
      if (!count) list.replaceChildren(h("div", { class: "cer-gm-none" }, ui.empty("Nothing here yet.", { icon: "list" })));
      cursor = j.nextPageCursor ?? "";
      if (cursor && !foot.firstChild) foot.append(loadMore(page));
      return !!cursor;
    }
    function retry() {
      list.replaceChildren(...ui.skeleton("row", 8));
      page();
    }
    page();
  }
})();
