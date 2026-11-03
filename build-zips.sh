#!/bin/bash
# Store zips: cer-chrome.zip (from extension/) and cer-firefox.zip (from
# firefox-build/, made by build-firefox.sh). Both are STORE builds: the dev
# marker (cer_dev) and the GitHub update host are stripped.
set -e
cd "$(dirname "$0")"
./build-firefox.sh
rm -rf .chrome-build cer-chrome.zip cer-firefox.zip
cp -r extension .chrome-build
find .chrome-build -name .DS_Store -delete
python3 - <<'PY'
import json
p = ".chrome-build/manifest.json"
m = json.load(open(p))
m.pop("cer_dev", None)
m["host_permissions"] = [h for h in m.get("host_permissions", []) if "api.github.com" not in h]
json.dump(m, open(p, "w"), indent=2)
PY
(cd .chrome-build && zip -qr ../cer-chrome.zip .)
(cd firefox-build && zip -qr ../cer-firefox.zip .)
rm -rf .chrome-build
echo "built cer-chrome.zip and cer-firefox.zip ($(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])"))"
