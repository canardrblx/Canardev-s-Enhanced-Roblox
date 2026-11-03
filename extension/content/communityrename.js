// Roblox rebranded "Groups" to "Communities"; canardev wants the old name back
// in the UI. This swaps the word in Roblox's own chrome only: buttons, tabs,
// menus, breadcrumbs, headings and page titles. Game names, group names, user
// names, descriptions, posts and chat are never touched ("Community Tycoon"
// stays "Community Tycoon"). titles.js already does the exact one-word labels
// ("Communities", "My Communities", "Create Community"); this covers the rest.
(async function () {
  if (typeof CER === "undefined") return;
  let settings = await CER.get();

  function fix(s) {
    return s
      .replace(/\bCommunities\b/g, "Groups")
      .replace(/\bcommunities\b/g, "groups")
      .replace(/\bCommunity\b/g, "Group")
      .replace(/\bcommunity\b/g, "group");
  }

  // Known UI phrases ("Leave Community", "Community Funds", "Communities: 3").
  // Headings, links, nav lists and labels also show group names, so outside a
  // real control ONLY a whole-text match on one of these gets renamed.
  const PHRASE = new RegExp(
    "^(?:(?:in|my|your|all|join|leave|back to|create|create a|configure|report|search|find|popular|recommended|no|more|other|new|top)\\s+)?" +
      "communit(?:y|ies)" +
      "(?:\\s+(?:funds|shout|info|information|settings|name|owner|members|store|games|experiences|guidelines|standards|rules|links|" +
      "picks|favorites|chat|events|forums|page|details|roles|payouts|revenue|ownership|admins|affiliates|allies|enemies|posts))?" +
      "\\s*(?::|\\(\\d[\\d,.]*\\)|\\d[\\d,.]*)?$",
    "i"
  );

  // Real controls: any short label inside one is Roblox's own text.
  const CONTROL =
    "button, [role='button'], [role='tab'], [role='menuitem'], [role='option'], label, legend, th, [class*='breadcrumb' i]";
  // Never inside these (user content / game + group names / inputs).
  const SKIP_SEL =
    "script, style, textarea, input, select, code, pre, noscript, [contenteditable], " +
    ".game-card-name, .game-name-title, h1.game-name, .cer-card-name, " +
    "a[href*='/games/'], a[href*='/users/'], a[href*='/catalog/'], a[href*='/bundles/'], a[href*='/badges/']";
  // class words that mark user content (split on - _ space and camelCase, so
  // "pointer-events-none" isn't read as an events list)
  const SKIP_WORDS = new Set([
    "name", "names", "username", "displayname", "description", "desc", "bio", "about", "post", "posts", "comment",
    "comments", "message", "messages", "chat", "linkify", "markup", "ugc", "announcement", "announcements",
    "shout", "forum", "forums", "wall", "event", "events", "status",
  ]);

  function userClass(el) {
    const c = typeof el.className === "string" ? el.className : el.getAttribute("class") ?? "";
    if (!c) return false;
    if (/user-?content|para-overflow/i.test(c)) return true;
    const words = c
      .replace(/pointer-events-\w+/g, "")
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .split(/[\s_-]+/);
    return words.some((w) => SKIP_WORDS.has(w));
  }

  function eligible(node) {
    const el = node.parentElement;
    if (!el) return false;
    const text = node.nodeValue.trim();
    if (!text || text.length > 40) return false;
    if (el.closest(SKIP_SEL)) return false;
    // a link to one specific group shows that group's name
    if (/\/(communities|groups)\/\d/.test(el.closest("a[href]")?.getAttribute("href") ?? "")) return false;
    for (let p = el; p && p !== document.body; p = p.parentElement) if (userClass(p)) return false;
    if (PHRASE.test(text)) return true; // a known UI phrase, outside user content
    // free text only inside a control, never in a heading (the group name h1)
    return !!el.closest(CONTROL) && !el.closest("h1, h2, h3, h4, h5, h6, [role='heading']");
  }

  function walk(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      if (/communit/i.test(root.nodeValue) && eligible(root)) {
        const nv = fix(root.nodeValue);
        if (nv !== root.nodeValue) root.nodeValue = nv;
      }
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/communit/i.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const nodes = [];
    let x;
    while ((x = tw.nextNode())) if (eligible(x)) nodes.push(x);
    for (const n of nodes) {
      const nv = fix(n.nodeValue);
      if (nv !== n.nodeValue) n.nodeValue = nv;
    }
  }

  // page <title>: only when the part before " - Roblox" is a UI phrase (a
  // group page's title is the group's name)
  function fixTitle() {
    const m = document.title.match(/^(.*?)(\s[-|]\s.*)?$/);
    if (m && PHRASE.test(m[1].trim())) document.title = fix(m[1]) + (m[2] ?? "");
  }

  function run() {
    if (!settings.features.renameGroups) return;
    walk(document.body);
    fixTitle();
  }

  // batched per frame (before paint) and only over what changed
  const pending = new Set();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (settings.features.renameGroups) {
      for (const n of pending) if (n.isConnected) walk(n);
      if (/communit/i.test(document.title)) fixTitle();
    }
    pending.clear();
  };
  new MutationObserver((muts) => {
    if (!settings.features.renameGroups) return;
    for (const m of muts) {
      if (m.type === "characterData") {
        if (/communit/i.test(m.target.nodeValue)) pending.add(m.target);
      } else for (const n of m.addedNodes) pending.add(n);
    }
    if (!scheduled && pending.size) {
      scheduled = true;
      if (document.hidden) setTimeout(flush, 200);
      else requestAnimationFrame(flush);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  CER.onSettingsChanged(async (changes) => {
    if (!changes.features) return;
    settings = await CER.get();
    run(); // turning it off takes effect on the next page load
  });
  CER.onNavigate?.(run);
  run();
})();
