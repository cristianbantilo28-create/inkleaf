#!/bin/sh
# Builds index.html + artifact.html and packs the folder for Netlify Drop / GitHub Pages:  sh tools/package.sh
set -e
cd "$(dirname "$0")/.."
node tools/build.mjs
rm -f ../inkleaf-pwa.zip tools/shot-*.png tools/fail-*.png tools/artifact-host.html
( cd .. && zip -rq inkleaf-pwa.zip inkleaf -x "inkleaf/.*" "inkleaf/tools/crnn/out/*" "inkleaf/tools/crnn/out3/*" "inkleaf/tools/crnn/__pycache__/*" )
ls -la ../inkleaf-pwa.zip
