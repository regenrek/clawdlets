#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: update-ingest --manifest <path> --signature <path>

Moves a manifest + signature into the updater state directory as desired.json(+.minisig).

This is used by push-based deploy tooling to reuse the host-side apply path.
USAGE
}

state_dir="${CLAWDLETS_UPDATER_STATE_DIR:-/var/lib/clawdlets/updates}"
manifest=""
signature=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --manifest)
      manifest="${2:-}"
      shift 2
      ;;
    --signature)
      signature="${2:-}"
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ -z "${manifest}" || -z "${signature}" ]]; then
  usage
  exit 2
fi

if [[ "${manifest}" =~ [[:space:]] || "${signature}" =~ [[:space:]] ]]; then
  echo "error: paths must not include whitespace" >&2
  exit 2
fi

if [[ "${manifest}" != /* || "${signature}" != /* ]]; then
  echo "error: paths must be absolute" >&2
  exit 2
fi

if [[ ! -f "${manifest}" ]]; then
  echo "error: manifest not found: ${manifest}" >&2
  exit 2
fi

if [[ ! -f "${signature}" ]]; then
  echo "error: signature not found: ${signature}" >&2
  exit 2
fi

install -d -m 0700 -o root -g root "${state_dir}"

write_atomic() {
  local src="$1"
  local dest="$2"
  local tmp
  tmp="$(mktemp -p "${state_dir}" "$(basename "${dest}").tmp.XXXXXX")"
  cat "${src}" > "${tmp}"
  chmod 0600 "${tmp}"
  mv -f "${tmp}" "${dest}"
}

write_atomic "${manifest}" "${state_dir}/desired.json"
write_atomic "${signature}" "${state_dir}/desired.json.minisig"

rm -f "${manifest}" "${signature}"

echo "ok: ingested desired manifest"

