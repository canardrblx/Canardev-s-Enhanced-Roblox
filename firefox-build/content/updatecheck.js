// Out-of-date notice. The background worker stores whether a newer GitHub
// release exists (only for unpacked/git installs — store installs auto-update).
// If so, we show a small notice with Update and a Cancel that stays locked for
// 10 seconds. Cancel snoozes it for 24 hours; it comes back after that until the
// user updates.
(function () {
  if (typeof CER === "undefined" || window.top !== window) return;
  const ext = CER.ext;
  const REPO = "canardrblx/Canardev-s-Enhanced-Roblox";

  // Promise form works in both Chrome (MV3) and Firefox; the callback form
  // never fires in Firefox because browser.storage there is promise-only.
  Promise.resolve(ext.storage.local.get(["cerUpdate", "cerUpdateDismissedAt"])).then((store) => {
    const u = store && store.cerUpdate;
    // no data or stale (>3h) — ask the worker to re-check for next time
    if (!u || !u.checkedAt || Date.now() - u.checkedAt > 3 * 3600e3) {
      try { ext.runtime.sendMessage({ cer: "check-update" }); } catch {}
    }
    if (!u || !u.available) return;
    if (Date.now() - (store.cerUpdateDismissedAt || 0) < 24 * 3600e3) return; // snoozed
    if (document.querySelector(".cer-update-pop")) return;
    show(u);
  }, () => {});

  function show(u) {
    let iv = null; // countdown handle, cleared when the modal closes early
    // centered, blocking modal — the backdrop covers the page so nothing else
    // is clickable until it's acknowledged
    const backdrop = CER.el("div", "cer-update-backdrop");
    const pop = CER.el("div", "cer-update-pop");
    const title = CER.el("div", "cer-update-title", "Your CER version is out of date.");
    const sub = CER.el("div", "cer-update-sub", `You have v${u.current}. v${u.latest} is out.`);
    const actions = CER.el("div", "cer-update-actions");
    pop.append(title, sub, actions);
    backdrop.appendChild(pop);

    const update = CER.el("button", "cer-update-btn cer-update-go", "Update");
    update.addEventListener("click", () => {
      if (iv) clearInterval(iv);
      window.open("https://github.com/" + REPO + "/releases/latest", "_blank");
      backdrop.remove();
    });

    const cancel = CER.el("button", "cer-update-btn cer-update-cancel");
    cancel.disabled = true;
    const cover = CER.el("span", "cer-update-cover"); // shrinking lock bar, like the Trending pill
    const label = CER.el("span", "cer-update-cancel-label", "Cancel (10)");
    cancel.append(cover, label);
    cancel.addEventListener("click", () => {
      if (cancel.disabled) return;
      if (iv) clearInterval(iv);
      ext.storage.local.set({ cerUpdateDismissedAt: Date.now() });
      backdrop.remove();
    });

    actions.append(update, cancel);
    document.body.appendChild(backdrop);

    requestAnimationFrame(() => (cover.style.width = "0%"));
    let left = 10;
    const iv = setInterval(() => {
      left--;
      label.textContent = left > 0 ? `Cancel (${left})` : "Cancel";
      if (left <= 0) {
        clearInterval(iv);
        cancel.disabled = false;
        cancel.classList.add("cer-update-cancel-ready");
      }
    }, 1000);
  }
})();
