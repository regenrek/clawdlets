# Secrets (sops + age)

Files:

- `secrets/.sops.yaml` (recipients + rules; committed)
- `secrets/hosts/<host>/` (encrypted secrets payload; committed)
- `secrets/keys/hosts/<host>.agekey.yaml` (encrypted host age key; committed; operator recipients only)
- `.clawdlets/keys/operators/<operator>.agekey` (operator private key; local only; never commit)

## Scope: fleet vs bot

All secret values live under `secrets/hosts/<host>/...`. Scope is about wiring, not storage.

- fleet scope: `fleet.secretEnv` and `fleet.secretFiles` (shared by all bots)
- bot scope: `fleet.bots.<bot>.profile.secretEnv` and `fleet.bots.<bot>.profile.secretFiles`

Secret file targets:
- `fleet.secretFiles.*.targetPath` must be under `/var/lib/clawdlets/`
- `fleet.bots.<bot>.profile.secretFiles.*.targetPath` must be under `/var/lib/clawdlets/secrets/bots/<bot>/`

## `${ENV}` wiring + autowire

Clawdlets detects `${ENV_VAR}` refs inside `fleet.bots.<bot>.clawdbot`, plus known channel tokens, hooks, skills, and provider `apiKey` fields.

- use uppercase env vars (`${ENV_VAR}` only)
- escape literal `${ENV_VAR}` as `$${ENV_VAR}`
- no inline tokens; use `${ENV_VAR}` + env file injection only
- secret names are allowlisted from detected refs (no custom/unmanaged names)
- `secrets init` + UI reject custom secret names; add `${ENV_VAR}` refs to extend allowlist

Missing mappings:
- CLI: `clawdlets config wire-secrets --write` or `clawdlets secrets init --autowire`
- UI: Host secrets panel Missing secret wiring; Bot integrations panel Secret wiring

## Recommended: use the CLI

```bash
clawdlets secrets init
```

This generates:
- local operator age keypair in `.clawdlets/keys/operators/`
- encrypted host age key at `secrets/keys/hosts/<host>.agekey.yaml`
- `secrets/.sops.yaml` rules for host secrets + host key file
- encrypts `secrets/hosts/<host>/*.yaml`
- generates `.clawdlets/extra-files/<host>/...` (host key + encrypted host secrets) for first install

Then sync to the host (used by sops-nix on the server):

```bash
clawdlets secrets sync
```

Verify (recommended before deploy):

```bash
clawdlets secrets verify
```

## Manual steps (if needed)

Edit a secret (example):

```bash
SOPS_AGE_KEY_FILE=.clawdlets/keys/operators/<you>.agekey \
  sops edit secrets/hosts/<host>/admin_password_hash.yaml
```

## Troubleshooting

If you see:

```text
error loading config: no matching creation rules found
```

Your `secrets/.sops.yaml` rule did not match the file path you are encrypting.
Fast fix: re-run `clawdlets secrets init` (it regenerates/upgrades `.sops.yaml`).

If you see:

```text
Failed to get the data key required to decrypt the SOPS file.
... no identity matched any of the recipients ...
```

This means your age identity cannot decrypt the file (wrong key or wrong recipients).

Fast fix:

```bash
clawdlets secrets init --yes
```

Sanity check your local operator keypair:

```bash
age-keygen -y .clawdlets/keys/operators/<you>.agekey
cat .clawdlets/keys/operators/<you>.age.pub
```

The two public keys must match. If they don’t, `clawdlets secrets init` rewrites the `.age.pub` file from the private key and re-encrypts secrets with the correct recipients.

## Common keys

- `tailscale_auth_key` (required when using Tailscale auto-join)
- `garnix_netrc` (netrc for authenticated cache access; installed at `/etc/nix/netrc` when `hosts.<host>.cache.netrc.enable = true`)
- `discord_token_<bot>` (default mapping via `fleet.bots.<bot>.profile.secretEnv.DISCORD_BOT_TOKEN`)
- LLM API keys (wired via env vars referenced in clawdbot config, then mapped in `fleet.secretEnv` and/or per-bot overrides in `fleet.bots.<bot>.profile.secretEnv`):
  - `z_ai_api_key` (Z.AI; env: `ZAI_API_KEY`)
  - `anthropic_api_key` (Anthropic; env: `ANTHROPIC_API_KEY`)
  - `openai_api_key` (OpenAI; env: `OPENAI_API_KEY`)
- hooks (env vars referenced in clawdbot config; mapped via `fleet.secretEnv` or per-bot overrides):
  - `clawdbot_hooks_token` (env: `CLAWDBOT_HOOKS_TOKEN`)
  - `clawdbot_hooks_gmail_push_token` (env: `CLAWDBOT_HOOKS_GMAIL_PUSH_TOKEN`)
- skills (env vars referenced in clawdbot config; mapped via `fleet.secretEnv` or per-bot overrides):
  - `clawdbot_skill_<skill>_api_key` (env: `CLAWDBOT_SKILL_<SKILL>_API_KEY`)

Secrets are injected by sops-nix at activation time:
- per-bot env vars via `sops.templates` → `EnvironmentFile=...`
- optional secret files via `sops.secrets` with explicit `path=...`

Optional:

- skill secrets referenced by `${ENV_VAR}` in skills config
- hook secrets referenced by `${ENV_VAR}` in hooks config
- GitHub App private key PEM referenced by `fleet.bots.<bot>.profile.github.privateKeySecret`
- restic secrets (`restic_password`, optional `restic_env`)
