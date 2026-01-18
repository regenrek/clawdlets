#!/usr/bin/env bash
# ops-snapshot.sh — Write a host snapshot to disk (no secrets).
set -euo pipefail

OUT_DIR="${OUT_DIR:-/var/lib/clawdlets/ops/snapshots}"
KEEP_DAYS="${KEEP_DAYS:-30}"
KEEP_LAST="${KEEP_LAST:-200}"

mkdir -p "$OUT_DIR"

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
host="$(hostname)"

tmp="$(mktemp)"
cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

build_info="/etc/clawdlets/build-info.json"

sysbin="/run/current-system/sw/bin"

sys_rev=""
if [ -x "${sysbin}/nixos-option" ]; then
  sys_rev="$("${sysbin}/nixos-option" system.configurationRevision 2>/dev/null | awk -F': ' '/Value:/{print $2}' | tr -d '\"' | head -n 1 || true)"
fi

nixos_ver="$("${sysbin}/nixos-version" 2>/dev/null || true)"
kernel="$(uname -a 2>/dev/null || true)"

gh_timers="$("${sysbin}/systemctl" list-timers --all --no-pager 'clawdbot-gh-sync-*.timer' 2>/dev/null || true)"
token_timers="$("${sysbin}/systemctl" list-timers --all --no-pager 'clawdbot-gh-token-*.timer' 2>/dev/null || true)"

read_build_info='null'
if [ -r "$build_info" ]; then
  read_build_info="$(cat "$build_info")"
fi

jq -n \
  --arg time_utc "$ts" \
  --arg host "$host" \
  --arg nixos_version "$nixos_ver" \
  --arg kernel "$kernel" \
  --arg system_configuration_revision "$sys_rev" \
  --arg gh_sync_timers "$gh_timers" \
  --arg gh_token_timers "$token_timers" \
  --argjson build_info "$read_build_info" \
  '{
    timeUtc: $time_utc,
    host: $host,
    buildInfo: $build_info,
    system: {
      nixosVersion: $nixos_version,
      kernel: $kernel,
      configurationRevision: ($system_configuration_revision | select(. != ""))
    },
    timers: {
      githubSync: $gh_sync_timers,
      githubToken: $gh_token_timers
    }
  }' >"$tmp"

out="${OUT_DIR}/${ts}-${host}.json"
out="${out//:/-}"
mv "$tmp" "$out"

ln -sfn "$out" "${OUT_DIR}/latest.json"

if [[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] && [ "$KEEP_DAYS" -gt 0 ]; then
  find "$OUT_DIR" -maxdepth 1 -type f -name '*.json' ! -name 'latest.json' -mtime "+${KEEP_DAYS}" -delete || true
fi

if [[ "$KEEP_LAST" =~ ^[0-9]+$ ]] && [ "$KEEP_LAST" -gt 0 ]; then
  find "$OUT_DIR" -maxdepth 1 -type f -name '*.json' ! -name 'latest.json' -printf '%T@ %p\n' \
    | sort -nr \
    | awk -v keep="$KEEP_LAST" 'NR>keep {print $2}' \
    | xargs -r rm -f || true
fi
