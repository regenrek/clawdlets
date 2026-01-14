#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: switch-system --toplevel /nix/store/<...> --rev <40-hex-sha> [--dry-run]

Switches to a prebuilt NixOS system closure by store path.
USAGE
}

dry_run=false
toplevel=""
rev=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --toplevel)
      toplevel="${2:-}"
      shift 2
      ;;
    --rev)
      rev="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ -z "${toplevel}" || -z "${rev}" ]]; then
  usage
  exit 2
fi

if [[ ! "${rev}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "error: --rev must be a full 40-char lowercase hex sha" >&2
  exit 2
fi

if [[ "${toplevel}" =~ [[:space:]] ]]; then
  echo "error: --toplevel must not include whitespace" >&2
  exit 2
fi

if [[ "${toplevel}" != /nix/store/* ]]; then
  echo "error: --toplevel must be an absolute /nix/store path" >&2
  exit 2
fi

nix_bin="/run/current-system/sw/bin/nix"
if [[ ! -x "${nix_bin}" ]]; then
  echo "error: nix not found at ${nix_bin}" >&2
  exit 2
fi

if [[ ! -e "${toplevel}" ]]; then
  if [[ "${dry_run}" == "true" ]]; then
    echo "would run: ${nix_bin} copy ${toplevel}"
  else
    "${nix_bin}" copy "${toplevel}"
  fi
fi

if [[ ! -x "${toplevel}/bin/switch-to-configuration" ]]; then
  echo "error: ${toplevel} missing bin/switch-to-configuration" >&2
  exit 2
fi

if [[ "${dry_run}" == "true" ]]; then
  echo "would set system profile to ${toplevel}"
  echo "would switch to ${toplevel}"
  exit 0
fi

/run/current-system/sw/bin/nix-env -p /nix/var/nix/profiles/system --set "${toplevel}"
"${toplevel}/bin/switch-to-configuration" switch
