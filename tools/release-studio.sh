#!/bin/bash
# release-studio.sh — FAST release path for briix-studio (own-git flow, 2026-11-21).
# One command: push main to Forgejo (git.briix.ru) + ship bundle to stand + live verify.
# Does NOT wait for GitHub Actions checks (browser suites run in parallel; releases don't gate on them).
#
# Usage:
#   bash tools/release-studio.sh            # push to forgejo + deploy studio/assets to stand
#   bash tools/release-studio.sh --with-bff # also ship server-contract/bff.py (backs up + restarts media-bff)
#   bash tools/release-studio.sh --no-push  # deploy current tree without pushing to forgejo
#
# Requirements: ssh alias fonotext-stand; ~/.ssh/forgejo-askpass helper (basic auth for
# forgejo-admin, reads ~/.ssh/forgejo-creds). No tokens on the command line or in git config.

set -euo pipefail
cd "$(dirname "$0")/.."
WITH_BFF=0; DO_PUSH=1
for a in "$@"; do
  case "$a" in
    --with-bff) WITH_BFF=1 ;;
    --no-push) DO_PUSH=0 ;;
    *) echo "unknown arg $a"; exit 2 ;;
  esac
done

BUILD=$(sed -n "s/.*window\.__BRIIX_BUILD__ = '\([0-9a-f]\{10\}\)'.*/\1/p" studio/index.html | head -1)
[ -n "$BUILD" ] || { echo "no __BRIIX_BUILD__ in studio/index.html"; exit 1; }
echo "release build: $BUILD"

if [ "$DO_PUSH" = 1 ]; then
  echo "== push main -> forgejo (git.briix.ru/bestdeejay-design/briix-studio) =="
  GIT_ASKPASS="$HOME/.ssh/forgejo-askpass" GIT_TERMINAL_PROMPT=0 git push forgejo main
fi

echo "== ship bundle to stand =="
TARARGS="studio assets"
if [ "$WITH_BFF" = 1 ]; then TARARGS="$TARARGS server-contract/bff.py"; fi
COPYFILE_DISABLE=1 tar --no-xattrs -cf - $TARARGS | ssh -o BatchMode=yes fonotext-stand /home/badai/briix-studio-deploy/deploy-studio.sh

echo "== live verify https://demo.briix.ru/studio/ =="
got=$(curl -fsS --max-time 15 https://demo.briix.ru/studio/version.json | python3 -c "import json,sys;print(json.load(sys.stdin)['build'])")
if [ "$got" = "$BUILD" ]; then
  echo "OK: https://demo.briix.ru/studio/ serves build $BUILD"
else
  echo "MISMATCH: live build=$got expected=$BUILD (see stand log /home/badai/briix-studio-deploy/logs/)"
  exit 1
fi
