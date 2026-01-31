#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: update-apply

Applies the signed desired-state release manifest from the updater state directory.

Required env:
- CLAWDLETS_UPDATER_BASE_URL
- CLAWDLETS_UPDATER_STATE_DIR
- CLAWDLETS_UPDATER_KEYS_FILE
- CLAWDLETS_UPDATER_HOST_NAME
- CLAWDLETS_UPDATER_CHANNEL
- CLAWDLETS_UPDATER_SECRETS_DIR
- CLAWDLETS_UPDATER_ALLOWED_SUBSTITUTERS          space-separated list
- CLAWDLETS_UPDATER_ALLOWED_TRUSTED_PUBLIC_KEYS   space-separated list

Optional env:
- CLAWDLETS_UPDATER_ALLOW_UNSIGNED   "true" (dev only; skips signature verification)
- CLAWDLETS_UPDATER_ALLOW_ROLLBACK   "true" (break-glass; accepts lower releaseId)
- CLAWDLETS_UPDATER_HEALTHCHECK_UNIT systemd unit to require active after switch (record-only)
USAGE
}

base_url="${CLAWDLETS_UPDATER_BASE_URL:-}"
state_dir="${CLAWDLETS_UPDATER_STATE_DIR:-/var/lib/clawdlets/updates}"
keys_file="${CLAWDLETS_UPDATER_KEYS_FILE:-}"
host_name="${CLAWDLETS_UPDATER_HOST_NAME:-}"
channel="${CLAWDLETS_UPDATER_CHANNEL:-}"
secrets_dir="${CLAWDLETS_UPDATER_SECRETS_DIR:-}"
allow_unsigned="${CLAWDLETS_UPDATER_ALLOW_UNSIGNED:-false}"
allow_rollback="${CLAWDLETS_UPDATER_ALLOW_ROLLBACK:-false}"
health_unit="${CLAWDLETS_UPDATER_HEALTHCHECK_UNIT:-}"
allowed_substituters="${CLAWDLETS_UPDATER_ALLOWED_SUBSTITUTERS:-}"
allowed_trusted_keys="${CLAWDLETS_UPDATER_ALLOWED_TRUSTED_PUBLIC_KEYS:-}"

if [[ -z "${base_url}" || -z "${keys_file}" || -z "${host_name}" || -z "${channel}" || -z "${secrets_dir}" ]]; then
  usage
  exit 2
fi

if [[ "${allow_unsigned}" != "true" && "${allow_unsigned}" != "false" ]]; then
  echo "error: CLAWDLETS_UPDATER_ALLOW_UNSIGNED must be true|false" >&2
  exit 2
fi
if [[ "${allow_rollback}" != "true" && "${allow_rollback}" != "false" ]]; then
  echo "error: CLAWDLETS_UPDATER_ALLOW_ROLLBACK must be true|false" >&2
  exit 2
fi

if [[ ! -f "${keys_file}" ]]; then
  echo "error: keys file not found: ${keys_file}" >&2
  exit 2
fi

install -d -m 0700 -o root -g root "${state_dir}"

desired_json="${state_dir}/desired.json"
desired_sig="${state_dir}/desired.json.minisig"

if [[ ! -f "${desired_json}" ]]; then
  echo "error: desired manifest not found: ${desired_json}" >&2
  exit 2
fi
if [[ "${allow_unsigned}" == "false" && ! -f "${desired_sig}" ]]; then
  echo "error: desired signature not found: ${desired_sig}" >&2
  exit 2
fi

lock_file="${state_dir}/lock"
exec 9>"${lock_file}"
flock -n 9 || {
  echo "warn: updater already running; exiting" >&2
  exit 0
}

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

status_tmp="$(mktemp -p "${state_dir}" status.json.tmp.XXXXXX)"
cleanup() {
  rm -f "${status_tmp}" 2>/dev/null || true
}
trap cleanup EXIT

write_status() {
  local result="$1"
  local message="$2"
  local desired_release_id="${3:-}"
  local desired_toplevel="${4:-}"
  local desired_rev="${5:-}"
  local verified_key_sha="${6:-}"
  local error="${7:-}"

  local finished_at
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  jq -n \
    --arg host "${host_name}" \
    --arg channel "${channel}" \
    --arg startedAt "${started_at}" \
    --arg finishedAt "${finished_at}" \
    --arg result "${result}" \
    --arg message "${message}" \
    --arg desiredReleaseId "${desired_release_id}" \
    --arg desiredToplevel "${desired_toplevel}" \
    --arg desiredRev "${desired_rev}" \
    --arg verifiedKeySha "${verified_key_sha}" \
    --arg error "${error}" \
    '{
      host: $host,
      channel: $channel,
      startedAt: $startedAt,
      finishedAt: $finishedAt,
      result: $result,
      message: $message,
      desired: {
        releaseId: ( ($desiredReleaseId|length) > 0 ? ($desiredReleaseId|tonumber) : null ),
        toplevel: ( ($desiredToplevel|length) > 0 ? $desiredToplevel : null ),
        rev: ( ($desiredRev|length) > 0 ? $desiredRev : null )
      },
      verifiedByKeySha256: ( ($verifiedKeySha|length) > 0 ? $verifiedKeySha : null ),
      error: ( ($error|length) > 0 ? $error : null )
    }' > "${status_tmp}"

  chmod 0600 "${status_tmp}"
  mv -f "${status_tmp}" "${state_dir}/status.json"
  status_tmp="$(mktemp -p "${state_dir}" status.json.tmp.XXXXXX)"
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

is_allowed() {
  local needle="$1"
  local haystack="$2"
  local item
  for item in ${haystack}; do
    if [[ "${item}" == "${needle}" ]]; then
      return 0
    fi
  done
  return 1
}

verified_key=""
verified_key_sha256=""
if [[ "${allow_unsigned}" == "false" ]]; then
  if ! verified_key="$(verify_with_keys "${desired_json}" "${desired_sig}")"; then
    write_status "failed" "manifest signature verification failed" "" "" "" "" "signature verification failed"
    exit 2
  fi
  verified_key_sha256="$(printf '%s' "${verified_key}" | sha256sum | awk '{print $1}')"
fi

schema_version="$(jq -r '.schemaVersion // empty' "${desired_json}" | tr -d '\r' | xargs || true)"
if [[ "${schema_version}" != "1" ]]; then
  write_status "failed" "invalid schemaVersion" "" "" "" "${verified_key_sha256}" "schemaVersion must be 1"
  exit 2
fi

updater_version="1.0.0"
supported_features="manifest-v1 anti-rollback cache-subset healthcheck-unit secrets-digest secrets-url"

manifest_host="$(jq -r '.host // empty' "${desired_json}" | tr -d '\r' | xargs || true)"
manifest_channel="$(jq -r '.channel // empty' "${desired_json}" | tr -d '\r' | xargs || true)"
manifest_system="$(jq -r '.system // empty' "${desired_json}" | tr -d '\r' | xargs || true)"
manifest_release_id="$(jq -er '.releaseId | select(type=="number" and . == floor and . > 0) | tostring' "${desired_json}")"
manifest_issued_at="$(jq -r '.issuedAt // empty' "${desired_json}" | tr -d '\r' | xargs || true)"
manifest_min_updater="$(jq -r '.minUpdaterVersion // empty' "${desired_json}" | tr -d '\r' | xargs || true)"
manifest_required_features="$(jq -r '.requiredFeatures[]? // empty' "${desired_json}" | tr -d '\r' || true)"
manifest_rev="$(jq -r '.rev // empty' "${desired_json}" | tr -d '\r' | xargs || true)"
manifest_toplevel="$(jq -r '.toplevel // empty' "${desired_json}" | tr -d '\r' | xargs || true)"
manifest_secrets_digest="$(jq -r '.secrets.digest // empty' "${desired_json}" | tr -d '\r' | xargs || true)"
manifest_secrets_url="$(jq -r '.secrets.url // empty' "${desired_json}" | tr -d '\r' | xargs || true)"
manifest_secrets_format="$(jq -r '.secrets.format // empty' "${desired_json}" | tr -d '\r' | xargs || true)"

if [[ -z "${manifest_host}" || "${manifest_host}" != "${host_name}" ]]; then
  write_status "failed" "manifest host mismatch" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "host mismatch"
  exit 2
fi
if [[ -z "${manifest_channel}" || "${manifest_channel}" != "${channel}" ]]; then
  write_status "failed" "manifest channel mismatch" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "channel mismatch"
  exit 2
fi
if [[ -z "${manifest_system}" || ! "${manifest_system}" =~ ^[a-z0-9_]+-[a-z0-9_]+$ ]]; then
  write_status "failed" "invalid system field" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "invalid system"
  exit 2
fi
if [[ -z "${manifest_issued_at}" || "${manifest_issued_at}" =~ [[:space:]] ]]; then
  write_status "failed" "invalid issuedAt" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "invalid issuedAt"
  exit 2
fi
if [[ ! "${manifest_rev}" =~ ^[0-9a-f]{40}$ ]]; then
  write_status "failed" "invalid rev" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "invalid rev"
  exit 2
fi
if [[ -z "${manifest_toplevel}" || "${manifest_toplevel}" =~ [[:space:]] || "${manifest_toplevel}" != /nix/store/* ]]; then
  write_status "failed" "invalid toplevel" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "invalid toplevel"
  exit 2
fi
if [[ ! "${manifest_secrets_digest}" =~ ^[0-9a-f]{64}$ ]]; then
  write_status "failed" "invalid secrets digest" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "invalid secrets.digest"
  exit 2
fi
if [[ -n "${manifest_secrets_url}" && "${manifest_secrets_url}" =~ [[:space:]] ]]; then
  write_status "failed" "invalid secrets url" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "secrets.url must not include whitespace"
  exit 2
fi
if [[ -n "${manifest_secrets_url}" && -z "${manifest_secrets_format}" ]]; then
  write_status "failed" "invalid secrets config" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "secrets.format is required when secrets.url is set"
  exit 2
fi
if [[ -n "${manifest_secrets_format}" && -z "${manifest_secrets_url}" ]]; then
  write_status "failed" "invalid secrets config" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "secrets.url is required when secrets.format is set"
  exit 2
fi
if [[ -n "${manifest_secrets_format}" && "${manifest_secrets_format}" != "sops-tar" ]]; then
  write_status "failed" "unsupported secrets format" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "secrets.format must be sops-tar"
  exit 2
fi

semver_ge() {
  local a="$1"
  local b="$2"
  local a_clean b_clean
  a_clean="${a%%+*}"
  b_clean="${b%%+*}"
  a_clean="${a_clean%%-*}"
  b_clean="${b_clean%%-*}"

  IFS=. read -r a1 a2 a3 <<<"${a_clean}"
  IFS=. read -r b1 b2 b3 <<<"${b_clean}"

  if [[ -z "${a1:-}" || -z "${a2:-}" || -z "${a3:-}" || -z "${b1:-}" || -z "${b2:-}" || -z "${b3:-}" ]]; then
    return 1
  fi
  if [[ ! "${a1}" =~ ^[0-9]+$ || ! "${a2}" =~ ^[0-9]+$ || ! "${a3}" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  if [[ ! "${b1}" =~ ^[0-9]+$ || ! "${b2}" =~ ^[0-9]+$ || ! "${b3}" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  if (( a1 > b1 )); then return 0; fi
  if (( a1 < b1 )); then return 1; fi
  if (( a2 > b2 )); then return 0; fi
  if (( a2 < b2 )); then return 1; fi
  if (( a3 >= b3 )); then return 0; fi
  return 1
}

if [[ -n "${manifest_min_updater}" ]]; then
  if [[ "${manifest_min_updater}" == *"-"* || "${manifest_min_updater}" == *"+"* ]]; then
    write_status "failed" "unsupported minUpdaterVersion" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "minUpdaterVersion must be plain x.y.z"
    exit 2
  fi
  if ! semver_ge "${updater_version}" "${manifest_min_updater}"; then
    write_status "failed" "updater too old" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "requires updater >= ${manifest_min_updater} (have ${updater_version})"
    exit 2
  fi
fi

if [[ -n "${manifest_required_features}" ]]; then
  feature=""
  while IFS= read -r feature; do
    feature="$(echo "${feature}" | tr -d '\r' | xargs)"
    [[ -z "${feature}" ]] && continue
    if ! is_allowed "${feature}" "${supported_features}"; then
      write_status "failed" "missing updater feature" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "required feature not supported: ${feature}"
      exit 2
    fi
  done <<< "${manifest_required_features}"
fi

current_json="${state_dir}/current.json"
current_release_id=""
if [[ -f "${current_json}" ]]; then
  current_release_id="$(jq -r '.releaseId // empty' "${current_json}" | tr -d '\r' | xargs || true)"
fi

if [[ -n "${current_release_id}" && "${current_release_id}" =~ ^[0-9]+$ ]]; then
  if (( manifest_release_id < current_release_id )) && [[ "${allow_rollback}" != "true" ]]; then
    write_status "failed" "refusing rollback (replay protection)" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "releaseId ${manifest_release_id} < lastAccepted ${current_release_id}"
    exit 2
  fi
fi

installed_digest_file="${secrets_dir}/.clawdlets-secrets-digest"
installed_digest=""
if [[ -f "${installed_digest_file}" ]]; then
  installed_digest="$(cat "${installed_digest_file}" | tr -d '\r' | xargs || true)"
fi
if [[ -z "${installed_digest}" || "${installed_digest}" != "${manifest_secrets_digest}" ]]; then
  if [[ -z "${manifest_secrets_url}" ]]; then
    write_status "failed" "secrets digest mismatch (no secrets.url; install secrets first)" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "expected ${manifest_secrets_digest}, got ${installed_digest:-missing}"
    exit 2
  fi

  base_url="${base_url%/}"
  if [[ -z "${base_url}" ]]; then
    write_status "failed" "missing updater base URL" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "CLAWDLETS_UPDATER_BASE_URL is required"
    exit 2
  fi

  secrets_url="$(echo "${manifest_secrets_url}" | tr -d '\r' | xargs)"
  if [[ -z "${secrets_url}" || "${secrets_url}" =~ [[:space:]] ]]; then
    write_status "failed" "invalid secrets url" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "secrets.url must not include whitespace"
    exit 2
  fi

  secrets_fetch_url=""
  if [[ "${secrets_url}" == *"://"* ]]; then
    if [[ "${secrets_url}" != https://* ]]; then
      write_status "failed" "invalid secrets url scheme" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "secrets.url must be https://... when absolute"
      exit 2
    fi
    secrets_fetch_url="${secrets_url}"
  else
    if [[ "${secrets_url}" == /* || "${secrets_url}" == *".."* ]]; then
      write_status "failed" "invalid secrets url path" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "secrets.url must be a safe relative path"
      exit 2
    fi
    secrets_fetch_url="${base_url}/${secrets_url}"
  fi

  if [[ ! -x "/etc/clawdlets/bin/install-secrets" ]]; then
    write_status "failed" "install-secrets missing" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "/etc/clawdlets/bin/install-secrets not found"
    exit 2
  fi

  secrets_tmp="$(mktemp -p "${state_dir}" secrets.bundle.tmp.XXXXXX)"
  chmod 0600 "${secrets_tmp}"
  if ! curl --fail --location --silent --output "${secrets_tmp}" "${secrets_fetch_url}"; then
    rm -f "${secrets_tmp}" 2>/dev/null || true
    write_status "failed" "failed to download secrets bundle" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "download failed"
    exit 2
  fi

  actual_digest="$(sha256sum "${secrets_tmp}" | awk '{print $1}')"
  if [[ "${actual_digest}" != "${manifest_secrets_digest}" ]]; then
    rm -f "${secrets_tmp}" 2>/dev/null || true
    write_status "failed" "secrets bundle digest mismatch" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "expected ${manifest_secrets_digest}, got ${actual_digest}"
    exit 2
  fi

  if ! /etc/clawdlets/bin/install-secrets --host "${host_name}" --tar "${secrets_tmp}" --rev "${manifest_rev}" --digest "${manifest_secrets_digest}"; then
    rm -f "${secrets_tmp}" 2>/dev/null || true
    write_status "failed" "secrets install failed" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "install-secrets failed"
    exit 2
  fi

  installed_digest=""
  if [[ -f "${installed_digest_file}" ]]; then
    installed_digest="$(cat "${installed_digest_file}" | tr -d '\r' | xargs || true)"
  fi
  if [[ -z "${installed_digest}" || "${installed_digest}" != "${manifest_secrets_digest}" ]]; then
    write_status "failed" "secrets digest still mismatched after install" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "expected ${manifest_secrets_digest}, got ${installed_digest:-missing}"
    exit 2
  fi
fi

cache_substituters="$(jq -r '.cache.substituters[]? // empty' "${desired_json}" | tr -d '\r' | xargs || true)"
cache_keys="$(jq -r '.cache.trustedPublicKeys[]? // empty' "${desired_json}" | tr -d '\r' | xargs || true)"
cache_ttl="$(jq -r '.cache.narinfoCachePositiveTtl? // empty' "${desired_json}" | tr -d '\r' | xargs || true)"

if [[ -n "${cache_substituters}" ]]; then
  for s in ${cache_substituters}; do
    if ! is_allowed "${s}" "${allowed_substituters}"; then
      write_status "failed" "manifest cache substituter not allowed" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "substituter not allowed: ${s}"
      exit 2
    fi
  done
fi

if [[ -n "${cache_keys}" ]]; then
  for k in ${cache_keys}; do
    if ! is_allowed "${k}" "${allowed_trusted_keys}"; then
      write_status "failed" "manifest cache trusted key not allowed" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "trusted key not allowed: ${k}"
      exit 2
    fi
  done
fi

nix_bin="/run/current-system/sw/bin/nix"
if [[ ! -x "${nix_bin}" ]]; then
  echo "error: nix not found at ${nix_bin}" >&2
  write_status "failed" "nix missing" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "nix not found"
  exit 2
fi

if [[ ! -e "${manifest_toplevel}" ]]; then
  nix_args=(copy)
  if [[ -n "${cache_substituters}" ]]; then
    nix_args+=(--option substituters "${cache_substituters}")
  fi
  if [[ -n "${cache_keys}" ]]; then
    nix_args+=(--option trusted-public-keys "${cache_keys}")
  fi
  if [[ -n "${cache_ttl}" && "${cache_ttl}" =~ ^[0-9]+$ ]]; then
    nix_args+=(--option narinfo-cache-positive-ttl "${cache_ttl}")
  fi
  nix_args+=("${manifest_toplevel}")
  "${nix_bin}" "${nix_args[@]}"
fi

current_toplevel="$(readlink -f /run/current-system || true)"
if [[ -n "${current_toplevel}" && "${current_toplevel}" == "${manifest_toplevel}" ]]; then
  # noop but still accept issuance (anti-rollback)
  :
else
  /etc/clawdlets/bin/switch-system --toplevel "${manifest_toplevel}" --rev "${manifest_rev}"
fi

if [[ -n "${health_unit}" ]]; then
  if ! /run/current-system/sw/bin/systemctl is-active --quiet "${health_unit}"; then
    write_status "failed" "health check failed (record-only; manual rollback available)" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" "unit not active: ${health_unit}"
    exit 2
  fi
fi

write_atomic_copy() {
  local src="$1"
  local dest="$2"
  local tmp
  tmp="$(mktemp -p "${state_dir}" "$(basename "${dest}").tmp.XXXXXX")"
  cat "${src}" > "${tmp}"
  chmod 0600 "${tmp}"
  mv -f "${tmp}" "${dest}"
}

if [[ -f "${current_json}" ]]; then
  write_atomic_copy "${current_json}" "${state_dir}/previous.json"
  if [[ -f "${state_dir}/current.json.minisig" ]]; then
    write_atomic_copy "${state_dir}/current.json.minisig" "${state_dir}/previous.json.minisig"
  fi
fi

write_atomic_copy "${desired_json}" "${state_dir}/current.json"
if [[ -f "${desired_sig}" ]]; then
  write_atomic_copy "${desired_sig}" "${state_dir}/current.json.minisig"
fi

if [[ -n "${current_toplevel}" && "${current_toplevel}" == "${manifest_toplevel}" ]]; then
  write_status "noop" "already on desired toplevel; recorded manifest" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" ""
else
  write_status "applied" "switched to desired release" "${manifest_release_id}" "${manifest_toplevel}" "${manifest_rev}" "${verified_key_sha256}" ""
fi

echo "ok: applied releaseId=${manifest_release_id}"
