// Game pages: Pin button inside the title, and a ⚙ button next to Play that
// opens the settings panel on the Join tab.

(async function () {
  if (typeof CER === "undefined") return;

  const placeId = location.pathname.match(/\/games\/(\d+)/)?.[1];
  if (!placeId) return;

  // the ⚙ button doesn't need the universe id — don't make it wait for one
  addJoinButton();

  // The page embeds the universe id in a meta element; fall back to the API.
  let universeId = document.querySelector("#game-detail-meta-data")?.dataset?.universeId;
  if (!universeId) {
    try {
      const res = await fetch("https://apis.roblox.com/universes/v1/places/" + placeId + "/universe");
      const id = res.ok ? (await res.json()).universeId : null;
      universeId = id ? String(id) : null; // never "undefined" → a bad games call
    } catch {
      universeId = null;
    }
  }

  // ---- "Updated" stat → relative time ("3 hours ago") ----

  if (universeId) {
    CER.waitFor(() => {
      for (const label of document.querySelectorAll(".game-stat .text-label")) {
        if (/^updated$/i.test(label.textContent.trim())) return label;
      }
      return null;
    }, 15000)
      .then(async (label) => {
        const valueEl = [...label.parentElement.children].find((c) => c !== label);
        if (!valueEl) return;
        const res = await fetch("https://games.roblox.com/v1/games?universeIds=" + universeId, { credentials: "include" });
        if (!res.ok) return; // a 4xx/5xx returns HTML, not JSON
        const updated = (await res.json())?.data?.[0]?.updated;
        if (!updated) return;
        const full = new Date(updated);
        valueEl.title = full.toLocaleString();
        valueEl.textContent = relativeTime(full);
      })
      .catch(() => {});
  }

  function relativeTime(date) {
    const s = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + (m === 1 ? " minute ago" : " minutes ago");
    const h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    const d = Math.floor(h / 24);
    if (d < 30) return d + (d === 1 ? " day ago" : " days ago");
    const mo = Math.floor(d / 30);
    if (mo < 12) return mo + (mo === 1 ? " month ago" : " months ago");
    const y = Math.floor(d / 365);
    return y + (y === 1 ? " year ago" : " years ago");
  }

  // ---- ⚙ button next to Play → opens settings on the Join tab ----
  // Roblox's container is flex-column and the Play button can render after us,
  // so styles.css forces row direction and uses `order` to keep ⚙ on the right
  // regardless of DOM order.

  async function addJoinButton() {
    const playContainer = await CER.waitFor(
      () => document.querySelector(".game-details-play-button-container"),
      15000
    ).catch(() => null);
    if (!playContainer || playContainer.querySelector(".cer-join-btn")) return;

    playContainer.classList.add("cer-play-row");

    const joinBtn = CER.el("button", "btn-common-play-game-lg btn-primary-md cer-join-btn");
    joinBtn.title = "Join options";
    joinBtn.appendChild(CER.gearIcon()); // currentColor SVG — white on the accent button
    joinBtn.addEventListener("click", () => CER.openSettings?.("Join"));
    playContainer.appendChild(joinBtn);
  }
})();
