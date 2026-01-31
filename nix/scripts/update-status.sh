#!/usr/bin/env bash
set -euo pipefail

state_dir="/var/lib/clawdlets/updates"
if [[ -n "${CLAWDLETS_UPDATER_STATE_DIR:-}" && "${CLAWDLETS_UPDATER_STATE_DIR}" != "${state_dir}" ]]; then
  echo "error: refusing CLAWDLETS_UPDATER_STATE_DIR override (must be ${state_dir})" >&2
  exit 2
fi

status="${state_dir}/status.json"
current="${state_dir}/current.json"
previous="${state_dir}/previous.json"

if [[ -f "${status}" ]]; then
  cat "${status}"
  exit 0
fi

echo "{"
echo "  \"status\": \"missing\","
echo "  \"stateDir\": \"${state_dir}\","
echo "  \"current\": $(if [[ -f \"${current}\" ]]; then echo true; else echo false; fi),"
echo "  \"previous\": $(if [[ -f \"${previous}\" ]]; then echo true; else echo false; fi)"
echo "}"
