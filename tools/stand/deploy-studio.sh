#!/bin/bash
# deploy-studio.sh — fast deploy of briix-studio client static (+ optional bff.py) on stand A.
# Installed at /home/badai/briix-studio-deploy/deploy-studio.sh  (2026-11-21, own-git-deploy flow)
#
# Usage:
#   tar -cf - -C <repo> studio assets [server-contract/bff.py] | ssh fonotext-stand deploy-studio.sh
# Reads a tar bundle from stdin, stages it, verifies the build fingerprint
# (studio/version.json build == window.__BRIIX_BUILD__ in studio/index.html),
# makes dated backups, swaps atomically, logs.
#
# Idempotent: re-running with the same bundle yields the same state.
# Rollback: every replaced dir/file gets a sibling .bak-<utc>; restore = mv back.

set -euo pipefail
TS=$(date -u +%Y%m%d-%H%M%S)
BASE=/home/badai/briix-studio-deploy
LOGDIR=$BASE/logs
WEB=/home/badai/briix-demo
BFF_DIR=/home/badai/briix-media/media-bff
LOG=$LOGDIR/deploy-$(date -u +%Y%m%d).log
mkdir -p "$LOGDIR"
exec >>"$LOG" 2>&1
echo "=== deploy-studio start $(date -u +%FT%TZ) ==="

STAGE=$(mktemp -d "$BASE/.stage.$TS.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
tar -xf - -C "$STAGE"
echo "bundle unpacked: $(ls "$STAGE")"

have() { [ -e "$STAGE/$1" ]; }

# --- fingerprint check: version.json build must match index.html __BRIIX_BUILD__ ---
if have studio/index.html; then
  expected=$(sed -n "s/.*window\.__BRIIX_BUILD__ = '\([0-9a-f]\{10\}\)'.*/\1/p" "$STAGE/studio/index.html" | head -1)
  got=$(python3 -c "import json;print(json.load(open('$STAGE/studio/version.json'))['build'])" 2>/dev/null || echo "")
  if [ -z "$expected" ] || [ -z "$got" ]; then
    echo "FINGERPRINT MISSING: expected='$expected' got='$got' — refusing deploy"; exit 1
  fi
  if [ "$expected" != "$got" ]; then
    echo "FINGERPRINT MISMATCH: index.html=$expected version.json=$got — refusing deploy"; exit 1
  fi
  echo "fingerprint OK: build $expected"
fi

# --- studio static ---
if have studio; then
  if [ -d "$WEB/studio" ]; then
    cp -a "$WEB/studio" "$WEB/studio.bak-$TS"
    echo "backup: studio -> studio.bak-$TS"
  fi
  STG="$WEB/.studio-new-$TS"
  rm -rf "$STG"; cp -a "$STAGE/studio" "$STG"
  # atomic-ish swap: two renames back-to-back
  rm -rf "$WEB/.studio-old-$TS"
  mv "$WEB/studio" "$WEB/.studio-old-$TS" 2>/dev/null || true
  mv "$STG" "$WEB/studio"
  rm -rf "$WEB/.studio-old-$TS"
  echo "studio deployed ($(ls "$WEB/studio" | wc -l) entries)"
else
  echo "bundle has no studio/ — skip static"
fi

# --- assets -> assets/data ---
if have assets; then
  if [ -d "$WEB/assets/data" ]; then
    cp -a "$WEB/assets/data" "$WEB/assets/data.bak-$TS"
    echo "backup: assets/data -> assets/data.bak-$TS"
  fi
  mkdir -p "$WEB/assets/data"
  cp -a "$STAGE/assets/." "$WEB/assets/data/"
  echo "assets/data updated"
fi

# --- optional bff.py: replace + restart ONLY if content changed ---
if have server-contract/bff.py; then
  if cmp -s "$STAGE/server-contract/bff.py" "$BFF_DIR/bff.py"; then
    echo "bff.py unchanged — no restart"
  else
    cp -a "$BFF_DIR/bff.py" "$BFF_DIR/bff.py.bak-$TS"
    cp "$STAGE/server-contract/bff.py" "$BFF_DIR/bff.py.new-$TS"
    mv "$BFF_DIR/bff.py.new-$TS" "$BFF_DIR/bff.py"
    echo "bff.py replaced (backup bff.py.bak-$TS), restarting media-bff"
    systemctl --user restart media-bff.service
    sleep 2
    N=$(pgrep -fc 'media-bff/bff.py' || true)
    if [ "${N:-0}" != "1" ]; then
      echo "WARN: media-bff process count=$N (expected 1) — check systemctl --user status media-bff"
    fi
  fi
fi

# --- post-deploy live check ---
sleep 1
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8440/studio/ || echo 000)
VJSON=$(curl -s --max-time 10 http://127.0.0.1:8440/studio/version.json | python3 -c "import json,sys;print(json.load(sys.stdin).get('build',''))" 2>/dev/null || echo "")
echo "live check: /studio/ http=$CODE version.json build=$VJSON"
if [ "$CODE" != "200" ]; then
  echo "ERROR: live /studio/ not 200 — ROLLBACK: mv $WEB/studio.bak-$TS back over studio"
  exit 1
fi
echo "=== deploy-studio done $(date -u +%FT%TZ) ==="
