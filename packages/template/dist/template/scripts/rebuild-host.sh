#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: rebuild-host --rev <40-hex-sha>

Runs: nixos-rebuild switch --flake "${FLAKE_BASE}?rev=<sha>#${HOST}"

Requires /etc/clawdlets/rebuild.env to define:
- CLAWDLETS_REBUILD_FLAKE_BASE (github:owner/repo)
- CLAWDLETS_REBUILD_HOST (flake host, e.g. clawdbot-fleet-host)
EOF
}

if [[ $# -ne 2 || "${1:-}" != "--rev" ]]; then
  usage
  exit 2
fi

rev="${2:-}"
if [[ ! "${rev}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "error: --rev must be a full 40-char lowercase hex sha" >&2
  exit 2
fi

env_file="/etc/clawdlets/rebuild.env"
if [[ ! -f "${env_file}" ]]; then
  echo "error: missing ${env_file} (enable clawdlets.operator.rebuild + set flakeBase)" >&2
  exit 2
fi

# shellcheck disable=SC1090
source "${env_file}"

flake_base="${CLAWDLETS_REBUILD_FLAKE_BASE:-}"
host="${CLAWDLETS_REBUILD_HOST:-}"

if [[ -z "${flake_base}" || -z "${host}" ]]; then
  echo "error: ${env_file} must set CLAWDLETS_REBUILD_FLAKE_BASE and CLAWDLETS_REBUILD_HOST" >&2
  exit 2
fi

if [[ "${flake_base}" =~ [[:space:]] || "${flake_base}" == *\?* || "${flake_base}" == *\#* ]]; then
  echo "error: CLAWDLETS_REBUILD_FLAKE_BASE must not include whitespace, '?' or '#'" >&2
  exit 2
fi

if [[ ! "${flake_base}" =~ ^github:[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "error: CLAWDLETS_REBUILD_FLAKE_BASE must be github:owner/repo" >&2
  exit 2
fi

if [[ ! "${host}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "error: CLAWDLETS_REBUILD_HOST contains invalid characters" >&2
  exit 2
fi

flake="${flake_base}?rev=${rev}#${host}"
exec /run/current-system/sw/bin/nixos-rebuild switch --flake "${flake}"

