#!/usr/bin/env bash
set -euo pipefail

ws="${CLAWDLETS_WORKSPACE_DIR:-}"
seed_root="${CLAWDLETS_SEED_DIR:-}"
bot_id="${CLAWDLETS_BOT_ID:-}"
tools_md="${CLAWDLETS_TOOLS_MD:-/etc/clawdlets/tools.md}"

if [[ -z "${ws}" || -z "${seed_root}" || -z "${bot_id}" ]]; then
  echo "error: CLAWDLETS_WORKSPACE_DIR, CLAWDLETS_SEED_DIR, and CLAWDLETS_BOT_ID must be set" >&2
  exit 2
fi

if [[ ! -d "${ws}" ]]; then
  echo "error: workspace dir missing: ${ws}" >&2
  exit 2
fi

if [[ ! -d "${seed_root}" ]]; then
  echo "error: seed dir missing: ${seed_root}" >&2
  exit 2
fi

if find "${ws}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
  exit 0
fi

common_dir="${seed_root}/common"
bot_dir="${seed_root}/bots/${bot_id}"

srcs=()
if [[ -d "${common_dir}" ]]; then
  srcs+=("${common_dir}")
fi
if [[ -d "${bot_dir}" ]]; then
  srcs+=("${bot_dir}")
fi

if [[ "${#srcs[@]}" -eq 0 ]]; then
  echo "error: seed dir has no overlay sources (expected ${seed_root}/common and/or ${seed_root}/bots/${bot_id})" >&2
  exit 2
fi

for src in "${srcs[@]}"; do
  cp -a "${src}/." "${ws}/"
done

if [[ -f "${ws}/TOOLS.md" && -r "${tools_md}" ]]; then
  if ! grep -q 'clawdlets-tools:begin' "${ws}/TOOLS.md"; then
    {
      printf '\n<!-- clawdlets-tools:begin -->\n'
      cat "${tools_md}"
      printf '\n<!-- clawdlets-tools:end -->\n'
    } >>"${ws}/TOOLS.md"
  fi
fi
