// Game-title cleanup across the site: strips [BRACKETS]/(parens) and emojis,
// per settings. IMPORTANT: only text nodes are edited — replacing whole
// elements (textContent =) nuked React-managed children and crashed entire
// sections (the Charts page bug).

(async function () {
  if (typeof CER === "undefined") return;

  const SELECTOR = ".game-card-name, .game-name-title, h1.game-name, .cer-card-name";
  const HEADING_SELECTOR = "h1, h2, h3, h4, span";

  let settings = await CER.get();
  const renames = () => {
    const r = [
      [/^\s*Experiences\s*$/, "Experiences", "Games"],
      [/^\s*Experience\s*$/, "Experience", "Game"],
    ];
    if (settings.features.renameGroups) {
      r.push(
        [/^\s*Communities\s*$/, "Communities", "Groups"],
        [/^\s*My Communities\s*$/, "My Communities", "My Groups"],
        [/^\s*Create Community\s*$/, "Create Community", "Create Group"]
      );
    }
    return r;
  };
  let RENAMES = renames();

  function fixText(el) {
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      for (const [re, from, to] of RENAMES) {
        if (re.test(node.nodeValue)) {
          node.nodeValue = node.nodeValue.replace(from, to);
          break;
        }
      }
    }
  }
  function fixTitle(el) {
    const anyOn = settings.features.cleanTitles || settings.features.stripEmojis;
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      // React reuses card nodes for other games: if the text isn't what we
      // last wrote, it's a new title, so adopt it as the original
      if (node.cerOriginal === undefined || node.nodeValue !== node.cerWritten) node.cerOriginal = node.nodeValue;
      const original = node.cerOriginal;
      const wanted = anyOn ? CER.cleanTitle(original, settings.features) : original;
      node.cerWritten = wanted;
      if (node.nodeValue !== wanted) {
        node.nodeValue = wanted;
        el.title = original.trim();
      }
    }
  }
  const RENAME_SEL = HEADING_SELECTOR + ", button, a";
  // only look inside what changed — a full-page querySelectorAll of every
  // span after each React update was the biggest idle CPU cost on busy pages
  function process(root) {
    if (root.nodeType !== Node.ELEMENT_NODE) {
      if (root.nodeType === Node.TEXT_NODE && root.parentElement) process(root.parentElement);
      return;
    }
    if (root.matches(RENAME_SEL)) fixText(root);
    if (root.matches(SELECTOR)) fixTitle(root);
    for (const el of root.querySelectorAll(RENAME_SEL)) fixText(el);
    for (const el of root.querySelectorAll(SELECTOR)) fixTitle(el);
  }

  const pending = new Set();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    for (const n of pending) if (n.isConnected) process(n);
    pending.clear();
  };
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "characterData") {
        if (m.target.nodeValue !== m.target.cerWritten) pending.add(m.target);
      } else for (const n of m.addedNodes) pending.add(n);
    }
    if (!scheduled && pending.size) {
      scheduled = true;
      requestAnimationFrame(flush); // before paint, so the raw title never shows
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  CER.onSettingsChanged(async (changes) => {
    if (!changes.features) return;
    settings = await CER.get();
    RENAMES = renames();
    process(document.body);
  });
  process(document.body);
})();
