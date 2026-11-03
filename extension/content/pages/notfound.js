// CER not-found / error page. Built on CER.ui (content/ui.js).
// Two ways in (route "notfound" in CER.PAGES):
//  - /request-error?code=NNN: where Roblox sends dead games, users, items
//    (302, checked 2026-11-03). Owned from document_start, so Roblox's
//    version never paints.
//  - any other dead URL: Roblox answers 404 IN PLACE (same URL) with its
//    server-rendered error block in #content. That is only known once the
//    HTML is parsed, so the route test also checks for that block.
// Art first: your own avatar, big and a little lost, one short line, Home.
(function () {
  if (typeof CER === "undefined" || !CER.ui) return;
  const { ui, api } = CER;
  const h = ui.h;

  // one short line per kind of error (kids 5-10)
  const LINES = {
    400: "Something went wrong.",
    401: "Log in to see this page.",
    403: "You can't see this page.",
    404: "This page is not here.",
    429: "Too fast. Wait a bit.",
  };
  const codeNow = () => {
    const c = Number(new URLSearchParams(location.search).get("code"));
    if (c >= 400 && c < 600) return c;
    return /^\/request-?error/i.test(location.pathname) ? 0 : 404;
  };
  const lineFor = (c) => LINES[c] ?? (c >= 500 ? "Roblox is having trouble. Try again soon." : "This page is not here.");

  ui.route("notfound", async () => {
    const code = codeNow();
    const { page } = ui.page("notfound", "cer-nf");

    const art = h("div", { class: "cer-nf-art", "aria-hidden": "true" }, code ? h("span", { class: "cer-nf-code", text: String(code) }) : null);
    const fallback = () => art.append(h("span", { class: "cer-nf-icon" }, ui.icon("compass", 72)));
    page.append(
      art,
      h("h1", { class: "cer-nf-line", text: lineFor(code) }),
      ui.button("Home", { icon: "home", variant: "primary", size: "lg", href: "https://www.roblox.com/home", class: "cer-nf-home" })
    );

    // your avatar is the art; a compass when logged out or it fails
    const me = await api.me();
    const url = me?.id ? await api.thumb("avatar", me.id) : null;
    if (!page.isConnected) return;
    if (!url) return fallback();
    const img = ui.img(url, { class: "cer-nf-avatar", alt: "" });
    img.addEventListener("error", () => (img.remove(), fallback()), { once: true });
    art.append(img);
  });
})();
