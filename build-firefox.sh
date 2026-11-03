#!/bin/bash
# Generates firefox-build/ from extension/ with a Firefox-compatible manifest.
# Firefox uses background.scripts; Chrome MV3 hard-rejects that and needs
# service_worker — so we keep extension/ as Chrome and build a Firefox copy.
# It is also a STORE build: the dev marker (cer_dev) and the GitHub update
# check host are stripped, so no dev-only code path can run for players.
set -e
cd "$(dirname "$0")"
rm -rf firefox-build
cp -r extension firefox-build
find firefox-build -name .DS_Store -delete
python3 - <<'PY'
import json
p = "firefox-build/manifest.json"
m = json.load(open(p))
# Firefox: background page runs the listeners as plain scripts
m["background"] = {"scripts": ["background.js"]}
# store build: no dev switches (dev-reload, cer-dry-writes, update nag)
m.pop("cer_dev", None)
m["host_permissions"] = [h for h in m.get("host_permissions", []) if "api.github.com" not in h]
gecko = m.setdefault("browser_specific_settings", {}).setdefault("gecko", {})
# 128+: content script world "MAIN" (bridge.js, game launch) and MV3 host
# permissions granted at install
gecko["strict_min_version"] = "128.0"
# what can leave the device: only the feedback box, when the player presses
# Send (their message plus Roblox username and user id, see PRIVACY.md)
gecko["data_collection_permissions"] = {"required": ["personallyIdentifyingInfo", "personalCommunications"]}
json.dump(m, open(p, "w"), indent=2)
print("firefox-build ready: background scripts, dev marker stripped, gecko 128+")
PY
