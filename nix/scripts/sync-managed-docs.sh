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

common_dir="${seed_root}/common"
bot_dir="${seed_root}/bots/${bot_id}"

sync_overlay_dir() {
  local rel="$1"
  local dst="$2"

  local tmp_root=""
  tmp_root="$(mktemp -d)"
  mkdir -p "${tmp_root}/out"

  if [[ -d "${common_dir}/${rel}" ]]; then
    cp -a "${common_dir}/${rel}/." "${tmp_root}/out/"
  fi
  if [[ -d "${bot_dir}/${rel}" ]]; then
    cp -a "${bot_dir}/${rel}/." "${tmp_root}/out/"
  fi

  if [[ -e "${dst}" || -L "${dst}" ]]; then
    rm -rf "${dst}"
  fi
  mkdir -p "$(dirname "${dst}")"
  mv "${tmp_root}/out" "${dst}"
  rm -rf "${tmp_root}"
}

pick_src() {
  local name="$1"
  if [[ -f "${bot_dir}/${name}" ]]; then
    printf '%s\n' "${bot_dir}/${name}"
    return 0
  fi
  if [[ -f "${common_dir}/${name}" ]]; then
    printf '%s\n' "${common_dir}/${name}"
    return 0
  fi
  return 1
}

managed=(
  "AGENTS.md"
  "SOUL.md"
  "IDENTITY.md"
  "TOOLS.md"
  "USER.md"
  "HEARTBEAT.md"
)

for name in "${managed[@]}"; do
  if src="$(pick_src "${name}")"; then
    cp -f "${src}" "${ws}/${name}"
  fi
done

# Custom/local skills: keep canonical skill trees in the repo and sync them into each workspace.
# Expected shape:
# - <seed_root>/common/skills/<skill>/SKILL.md
# - <seed_root>/bots/<bot>/skills/<skill>/SKILL.md
sync_overlay_dir "skills" "${ws}/skills"

if [[ -f "${ws}/TOOLS.md" && -r "${tools_md}" ]]; then
  if ! grep -q 'clawdlets-tools:begin' "${ws}/TOOLS.md"; then
    {
      printf '\n<!-- clawdlets-tools:begin -->\n'
      cat "${tools_md}"
      printf '\n<!-- clawdlets-tools:end -->\n'
    } >>"${ws}/TOOLS.md"
  fi
fi
