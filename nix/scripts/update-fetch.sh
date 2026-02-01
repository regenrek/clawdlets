#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: update-fetch

Fetches the signed desired-state pointer + immutable release manifest into the updater state directory.

Required env:
- CLAWDLETS_UPDATER_BASE_URLS       space-separated (mirrors), e.g. https://a/deploy/<host>/<channel> https://b/deploy/<host>/<channel>
- CLAWDLETS_UPDATER_STATE_DIR       e.g. /var/lib/clawdlets/updates
- CLAWDLETS_UPDATER_KEYS_FILE       newline-delimited minisign public keys

Optional env:
- CLAWDLETS_UPDATER_ALLOW_UNSIGNED  "true" (dev only; skips signature verification)
USAGE
}

base_urls_raw="${CLAWDLETS_UPDATER_BASE_URLS:-}"
state_dir="${CLAWDLETS_UPDATER_STATE_DIR:-/var/lib/clawdlets/updates}"
keys_file="${CLAWDLETS_UPDATER_KEYS_FILE:-}"
allow_unsigned="${CLAWDLETS_UPDATER_ALLOW_UNSIGNED:-false}"

read -r -a base_urls <<<"${base_urls_raw}"

if [[ "${#base_urls[@]}" -eq 0 || -z "${keys_file}" ]]; then
  usage
  exit 2
fi

if [[ "${allow_unsigned}" != "true" && "${allow_unsigned}" != "false" ]]; then
  echo "error: CLAWDLETS_UPDATER_ALLOW_UNSIGNED must be true|false" >&2
  exit 2
fi

if [[ ! -f "${keys_file}" ]]; then
  echo "error: keys file not found: ${keys_file}" >&2
  exit 2
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

curl_fetch() {
  local url="$1"
  local out="$2"
  curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 10 -o "${out}" "${url}"
}

verify_with_keys() {
  local file="$1"
  local sig="$2"
  local key=""
  local key_trim=""

  while IFS= read -r key; do
    key_trim="$(echo "${key}" | tr -d '\r' | xargs)"
    [[ -z "${key_trim}" ]] && continue
    if minisign -Vm "${file}" -P "${key_trim}" -x "${sig}" >/dev/null 2>&1; then
      printf '%s' "${key_trim}"
      return 0
    fi
  done < "${keys_file}"

  return 1
}

pointer_json="${tmpdir}/latest.json"
pointer_sig="${tmpdir}/latest.json.minisig"
manifest_json="${tmpdir}/manifest.json"
manifest_sig="${tmpdir}/manifest.json.minisig"

selected_base_url=""
release_id=""
file=""
verified_key_sha256=""
last_error="unable to fetch"

for base_url in "${base_urls[@]}"; do
  base_url="$(echo "${base_url}" | tr -d '\r' | xargs)"
  [[ -z "${base_url}" ]] && continue
  if [[ "${base_url}" =~ [[:space:]] ]]; then
    last_error="invalid base URL (whitespace): ${base_url}"
    continue
  fi

  base_url="${base_url%/}"
  pointer_url="${base_url}/latest.json"
  pointer_sig_url="${pointer_url}.minisig"

  if ! curl_fetch "${pointer_url}" "${pointer_json}"; then
    last_error="fetch failed: ${pointer_url}"
    continue
  fi
  if ! curl_fetch "${pointer_sig_url}" "${pointer_sig}"; then
    last_error="fetch failed: ${pointer_sig_url}"
    continue
  fi

  if [[ "${allow_unsigned}" == "false" ]]; then
    verified_key=""
    if ! verified_key="$(verify_with_keys "${pointer_json}" "${pointer_sig}")"; then
      last_error="pointer signature verification failed: ${pointer_url}"
      continue
    fi
    verified_key_sha256="$(printf '%s' "${verified_key}" | sha256sum | awk '{print $1}')"
  else
    verified_key_sha256=""
  fi

  if ! release_id="$(jq -er '.releaseId | select(type=="number" and . == floor and . > 0) | tostring' "${pointer_json}")"; then
    last_error="invalid pointer JSON: ${pointer_url}"
    continue
  fi
  file="$(jq -r '.file // empty' "${pointer_json}" | tr -d '\r' | xargs || true)"
  if [[ -z "${file}" ]]; then
    file="${release_id}.json"
  fi
  if [[ ! "${file}" =~ ^[A-Za-z0-9._-]+\.json$ ]]; then
    last_error="invalid pointer file: ${file} (${pointer_url})"
    continue
  fi

  manifest_url="${base_url}/${file}"
  manifest_sig_url="${manifest_url}.minisig"

  if ! curl_fetch "${manifest_url}" "${manifest_json}"; then
    last_error="fetch failed: ${manifest_url}"
    continue
  fi
  if ! curl_fetch "${manifest_sig_url}" "${manifest_sig}"; then
    last_error="fetch failed: ${manifest_sig_url}"
    continue
  fi

  if [[ "${allow_unsigned}" == "false" ]]; then
    if ! verify_with_keys "${manifest_json}" "${manifest_sig}" >/dev/null; then
      last_error="manifest signature verification failed: ${manifest_url}"
      continue
    fi
  fi

  selected_base_url="${base_url}"
  break
done

if [[ -z "${selected_base_url}" ]]; then
  echo "error: failed to fetch+verify desired state (${last_error})" >&2
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

write_atomic "${pointer_json}" "${state_dir}/latest.json"
write_atomic "${pointer_sig}" "${state_dir}/latest.json.minisig"
write_atomic "${manifest_json}" "${state_dir}/desired.json"
write_atomic "${manifest_sig}" "${state_dir}/desired.json.minisig"

if [[ "${allow_unsigned}" == "false" ]]; then
  jq -n \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg baseUrl "${selected_base_url}" \
    --arg releaseId "${release_id}" \
    --arg keySha "${verified_key_sha256}" \
    '{ fetchedAt: $ts, baseUrl: $baseUrl, pointerReleaseId: ($releaseId|tonumber), pointerVerifiedByKeySha256: $keySha }' \
    > "${state_dir}/fetch.json"
  chmod 0600 "${state_dir}/fetch.json"
else
  jq -n \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg baseUrl "${selected_base_url}" \
    --arg releaseId "${release_id}" \
    '{ fetchedAt: $ts, baseUrl: $baseUrl, pointerReleaseId: ($releaseId|tonumber), pointerVerifiedByKeySha256: null, allowUnsigned: true }' \
    > "${state_dir}/fetch.json"
  chmod 0600 "${state_dir}/fetch.json"
fi

echo "ok: fetched desired releaseId=${release_id} (${file}) from ${selected_base_url}"
