#!/bin/bash
# Store zips: cer-chrome.zip (from extension/) and cer-firefox.zip (from
# firefox-build/, made by build-firefox.sh). Both are STORE builds: the dev
# marker (cer_dev) and the GitHub update host are stripped.
set -e
cd "$(dirname "$0")"
# python3 on Mac/Linux, python on Windows
PY=$(command -v python3 || command -v python)
./build-firefox.sh
rm -rf .chrome-build cer-chrome.zip cer-firefox.zip
cp -r extension .chrome-build
find .chrome-build -name .DS_Store -delete
"$PY" - <<'PY'
import json
p = ".chrome-build/manifest.json"
m = json.load(open(p))
m.pop("cer_dev", None)
m["host_permissions"] = [h for h in m.get("host_permissions", []) if "api.github.com" not in h]
json.dump(m, open(p, "w"), indent=2)
PY
# python, not zip: zip is missing from Git Bash on Windows. Files sit at the zip root.
"$PY" - <<'PY'
import os, zipfile
for src, out in ((".chrome-build", "cer-chrome.zip"), ("firefox-build", "cer-firefox.zip")):
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(src):
            for f in files:
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, src).replace(os.sep, "/"))
PY
rm -rf .chrome-build
echo "built cer-chrome.zip and cer-firefox.zip ($("$PY" -c "import json;print(json.load(open('extension/manifest.json'))['version'])"))"
