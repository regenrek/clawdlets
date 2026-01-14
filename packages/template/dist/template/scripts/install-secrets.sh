#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: install-secrets --host <host> --tar <path> --rev <40-hex-sha> [--digest <sha256>]

Installs encrypted secrets tarball to /var/lib/clawdlets/secrets/hosts/<host>.
USAGE
}

host=""
tar_path=""
rev=""
digest=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --host)
      host="${2:-}"
      shift 2
      ;;
    --tar)
      tar_path="${2:-}"
      shift 2
      ;;
    --rev)
      rev="${2:-}"
      shift 2
      ;;
    --digest)
      digest="${2:-}"
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ -z "${host}" || -z "${tar_path}" || -z "${rev}" ]]; then
  usage
  exit 2
fi

if [[ ! "${host}" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "error: --host must be [a-z][a-z0-9-]*" >&2
  exit 2
fi

if [[ ! "${rev}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "error: --rev must be a full 40-char lowercase hex sha" >&2
  exit 2
fi

if [[ "${tar_path}" =~ [[:space:]] ]]; then
  echo "error: --tar must not include whitespace" >&2
  exit 2
fi

if [[ "${tar_path}" != /* ]]; then
  echo "error: --tar must be an absolute path" >&2
  exit 2
fi

if [[ ! -f "${tar_path}" ]]; then
  echo "error: tar file not found: ${tar_path}" >&2
  exit 2
fi

if [[ -n "${digest}" && ! "${digest}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "error: --digest must be lowercase hex sha256" >&2
  exit 2
fi

entries=$(tar -tzf "${tar_path}")
if [[ -z "${entries}" ]]; then
  echo "error: tar is empty" >&2
  exit 2
fi

while IFS= read -r entry; do
  [[ -z "${entry}" ]] && continue
  if [[ "${entry}" == */* ]]; then
    echo "error: tar entry contains slash: ${entry}" >&2
    exit 2
  fi
  if [[ "${entry}" == *".."* ]]; then
    echo "error: tar entry contains '..': ${entry}" >&2
    exit 2
  fi
  if [[ ! "${entry}" =~ ^[A-Za-z0-9._-]+\.yaml$ ]]; then
    echo "error: tar entry must be a .yaml file: ${entry}" >&2
    exit 2
  fi
done <<< "${entries}"

if [[ -n "${digest}" ]]; then
  actual_digest=$(sha256sum "${tar_path}" | awk '{print $1}')
  if [[ "${actual_digest}" != "${digest}" ]]; then
    echo "error: digest mismatch (expected ${digest}, got ${actual_digest})" >&2
    exit 2
  fi
fi

tmpdir=$(mktemp -d)
trap 'rm -rf "${tmpdir}"' EXIT

tar -xzf "${tar_path}" -C "${tmpdir}"

secrets_dir="/var/lib/clawdlets/secrets/hosts/${host}"
install -d -m 0700 -o root -g root "${secrets_dir}"

shopt -s nullglob
files=("${tmpdir}"/*.yaml)
shopt -u nullglob

if [[ ${#files[@]} -eq 0 ]]; then
  echo "error: no secrets found in tar" >&2
  exit 2
fi

for f in "${files[@]}"; do
  bn=$(basename "${f}")
  install -m 0400 -o root -g root "${f}" "${secrets_dir}/${bn}"
done

printf '%s\n' "${rev}" > "${secrets_dir}/.clawdlets-secrets-rev"
chown root:root "${secrets_dir}/.clawdlets-secrets-rev"
chmod 0400 "${secrets_dir}/.clawdlets-secrets-rev"

if [[ -n "${digest}" ]]; then
  printf '%s\n' "${digest}" > "${secrets_dir}/.clawdlets-secrets-digest"
  chown root:root "${secrets_dir}/.clawdlets-secrets-digest"
  chmod 0400 "${secrets_dir}/.clawdlets-secrets-digest"
fi

rm -f "${tar_path}"
