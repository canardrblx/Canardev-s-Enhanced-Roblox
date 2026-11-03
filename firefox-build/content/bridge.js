// Runs in the PAGE's world (see manifest "world": "MAIN"), not the extension's
// isolated world — that's the only place Roblox's own GameLauncher is visible.
// The extension side talks to it with window.postMessage.
// Security: only accepts messages from this same window/origin, and the only
// thing it can do is launch a game. The only thing sent back is a bare
// "launched" ack, so the caller can skip its roblox:// fallback (doing both
// opened two launch prompts).

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  const launcher = window.Roblox && window.Roblox.GameLauncher;
  if (!launcher) return;

  // placeId must be a real number and jobId a non-empty string — a forged
  // message with junk fields would otherwise reach the launcher as NaN
  if (msg.cer === "join-instance" && Number.isFinite(Number(msg.placeId)) && msg.placeId && typeof msg.jobId === "string" && msg.jobId) {
    launcher.joinGameInstance(Number(msg.placeId), msg.jobId);
    window.postMessage({ cer: "launch-ack", nonce: msg.nonce }, location.origin);
  } else if (msg.cer === "join-multiplayer" && msg.placeId && Number.isFinite(Number(msg.placeId))) {
    launcher.joinMultiplayerGame(Number(msg.placeId));
    window.postMessage({ cer: "launch-ack", nonce: msg.nonce }, location.origin);
  }
});
