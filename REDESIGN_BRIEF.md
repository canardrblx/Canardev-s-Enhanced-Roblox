# CER full redesign: brief for page agents

Extension: "Canardev's Enhanced Roblox" (CER), a Chrome/Firefox MV3 extension. Unpacked build
is `extension/`, loaded in the owner's Chrome. You are rebuilding ONE area of the site from
scratch as an original product.

## The vision (owner's words, paraphrased)
- Redesign every page FULLY, from scratch. Do NOT use Roblox's page as a base or as inspiration.
  It should feel like an original, modern product, not Roblox's 20 years of stacked features.
- Visually INDEPENDENT of Roblox's DOM, so Roblox updates can't break it. Use Roblox only for
  DATA (its web APIs) and ACTIONS (launching games, its own purchase flows).
- He loved a fork's Discover page: genre chips, a big FEATURED hero with a blurred thumbnail
  backdrop, title, playing count, rating %, a big white Play button, "Top games" ranked #N cards,
  and a "Friends' games" right column. That is the quality and feel to aim for everywhere.
- Speed matters most. He stopped using CER because it was slow.

## LOOK: game platform, minimal (owner correction, overrides anything below)
The first pass looked "vibecoded", like a professional/SaaS website. CER must feel like a GAME
PLATFORM (console home screen, game launcher), minimal and modern. The owner loved CER because it
REMOVED clutter and useless info. Every element must earn its place.
- Art first (game thumbnails, avatars, item images). Text and buttons last.
- No page subtitles, helper sentences, "N items" lines, or section counts.
- Section titles are plain bold words: no icon in front.
- No badges/pills/stat cards unless real player info (playing count, rating, price, online).
- One obvious primary action per screen (usually Play). Secondary actions small and quiet.
- No bordered info cards, no settings-style modals for simple things.
- Fewer sections; cut what is rarely useful. Icons only where they replace words.

## Architecture (already built; read these files first)
- `extension/content/ui.js`: the design system. Read ALL of it before writing code.
  - `CER.PAGES` route table + `CER.pageFor`. theme.js adds `html.cer-takeover` at
    document_start for owned routes, so Roblox's `#content` never paints.
  - `CER.ui.route(tag, start)`: runs `start()` on your route (and on SPA navigation).
    If `start` throws, Roblox's page comes back (`ui.release()`).
  - `CER.ui.page(tag)` → `{ root, page }`: mounts `#cer-app[data-page=tag]` and gives you the
    centered column (`.cer-view`). Build everything inside it.
  - Components: `h`, `icon`, `button`, `chip`/`chips`, `tabs`, `search`, `select`, `toggle`,
    `section`, `link`, `grid`, `rail`, `cols`, `card`, `header`, `hero`, `stat`, `badge`, `empty`,
    `skeleton`, `gameCard`, `hydrateGames`, `userTile`, `avatar`, `thumb`, `play`, `modal`,
    `copy`, `clamp`, `whenVisible`, `nativeUrl`.
  - Data: `CER.api.json(url, { method, body, ttl, bg })` (never throws, returns null on error,
    retries 429, caches GETs with `ttl`), `api.thumb(kind, id)` / `api.thumbs` (batched,
    Webp), `api.user(s)`, `api.presence`, `api.presenceState`, `api.game(s)` (info + votes),
    `api.friends`, `api.universeOf`, `api.me`, `api.batcher`.
  - Formatting: `CER.fmt.num / full / pct / ago / date`.
  - `?cer=native` on any URL shows Roblox's own page (`ui.nativeUrl(url)`). Use it to hand
    off flows only Roblox should run (purchases, security settings, captcha).
- `extension/content/ui.css`: tokens (`--cer-bg, --cer-surface, --cer-surface-2, --cer-raise,
  --cer-hover, --cer-press, --cer-line, --cer-line-2, --cer-text, --cer-text-2, --cer-text-3,
  --cer-acc, --cer-acc-soft, --cer-good/warn/bad, --cer-online/ingame/studio, --cer-r-*`)
  and all component styles. Use the tokens; never hard-code theme colors (white text over hero
  art is fine). Must look right in light AND dark (tokens handle it).
- `extension/content/shared.js`: older helpers (`CER.get`, `CER.set`, `CER.me`, `CER.launch`,
  `CER.getUniverseIds`, `CER.cleanTitle`, `CER.toast`, `CER.robloxWrite`, `CER.bgFetch`).
- `extension/content/pages/<tag>.js` + `<tag>.css`: YOUR files (already wired in
  manifest.json; JS runs at document_end on every roblox.com page, CSS at document_start).
  Scope every CSS rule under `[data-page="<tag>"]` (or a class only your page uses).
- The left nav is CER's own sidebar (`customsidebar.js`); your page fills the column to its right.

## Hard rules
1. Edit ONLY the files assigned to you. Do NOT edit `ui.js`, `ui.css`, `shared.js`, `theme.js`,
   `styles.css`, `manifest.json`, or other agents' files. If you need a new shared component,
   build it inside your page file and list it in your report so it can be promoted later.
   Retiring an old script you own: add an early return when the page is ours, e.g.
   `if ((await CER.takeover) === "home") return;` (`CER.takeover` resolves to the owned tag or
   null). Keep anything in it still needed on non-owned pages.
2. Never read Roblox's page DOM for data. APIs only. (Older scripts did DOM scraping; do not copy that.)
3. ACCOUNT SAFETY (this is the owner's real account): while testing, NEVER perform a write:
   no joining/leaving groups, no friend requests/accepts/declines/unfriends, no follows, no
   messages, no wall posts, no purchases, no favorites, no votes, no avatar/outfit changes, no
   settings changes, no theme changes. You may open your own confirm modal and press Cancel.
   You MAY build these actions for real users, wired to the official API, behind a clear
   button (destructive ones behind a confirm modal). Never build leave-group,
   transfer-ownership, or delete-group UI at all.
4. UI text is for kids aged 5 to 10: short (under 15 words), simple words, NO em dashes
   (use a comma, colon, or period instead). No emojis in UI chrome.
5. Speed: mount the shell with skeletons right away (under 100 ms after start), fetch in
   parallel, lazy-load below-the-fold sections with `ui.whenVisible`, no polling faster than
   30 s, no MutationObserver on the whole document, no layout thrash.
6. Logged out: if your page needs a login and `await CER.api.me()` is null, call
   `CER.ui.release()` and return (Roblox's page shows).
7. Must not break when an API fails: show `ui.empty(...)` for that section, keep the rest.
8. No horizontal page scroll. Must work from ~1000 px to 1920 px wide (resize to check).
9. Don't commit, don't push, don't run build-firefox.sh, don't touch the zip files.

## Testing (Chrome via the claude-in-chrome MCP tools)
- Load tools in ONE ToolSearch call: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__browser_batch,mcp__claude-in-chrome__resize_window,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find`
- Create YOUR OWN tab (`tabs_create_mcp`) and use only that tab. Never touch other tabs
  (other agents are testing in parallel in the same browser).
- After editing, reload the extension from your tab:
  `window.postMessage({cer:'dev-reload'}, location.origin)`, wait ~2 s, then re-navigate your tab.
  Other agents reload too; if your page looks stale or blank, just re-navigate.
- Syntax check: `~/.cer-tools/node/bin/node --check <file>`.
- Content scripts run in an isolated world: from `javascript_tool` you can inspect the DOM but
  not call `CER`. Check `read_console_messages` for errors (filter "CER" or your tag).
- Verify with screenshots: first load, each tab/state, empty states, narrow width (~1000 px),
  scroll to the bottom. Fix what looks off. Take pride: spacing, alignment, hover states,
  no clipped text, no blank images, no layout jumps when data arrives.

## Report back (short)
What you built (sections/features), files touched, old scripts you retired, dead selectors in
`styles.css` that the owner of that file should delete, shared components worth promoting,
anything you could not finish or verify.
