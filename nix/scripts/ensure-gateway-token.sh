#!/usr/bin/env bash
set -euo pipefail

out_env_file="${CLAWDLETS_GATEWAY_ENV_FILE:-}"
bot_user="${CLAWDLETS_BOT_USER:-}"
bot_group="${CLAWDLETS_BOT_GROUP:-}"

if [[ -z "${out_env_file}" ]]; then
  echo "error: missing CLAWDLETS_GATEWAY_ENV_FILE" >&2
  exit 2
fi
if [[ -z "${bot_user}" || -z "${bot_group}" ]]; then
  echo "error: missing CLAWDLETS_BOT_USER / CLAWDLETS_BOT_GROUP" >&2
  exit 2
fi

umask 077
mkdir -p "$(dirname "${out_env_file}")"

if [[ -f "${out_env_file}" ]]; then
  chmod 0400 "${out_env_file}"
  chown "${bot_user}:${bot_group}" "${out_env_file}"
  exit 0
fi

token="$(openssl rand -hex 32)"
if [[ -z "${token}" ]]; then
  echo "error: failed to generate token" >&2
  exit 1
fi

tmp="$(mktemp)"
printf 'CLAWDBOT_GATEWAY_TOKEN=%s\n' "${token}" >"${tmp}"
chown "${bot_user}:${bot_group}" "${tmp}"
chmod 0400 "${tmp}"
mv "${tmp}" "${out_env_file}"
