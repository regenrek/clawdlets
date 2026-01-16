# Secrets (sops + age)

Files:

- `secrets/.sops.yaml` (recipients + rules; committed)
- `secrets/hosts/<host>/` (encrypted secrets payload; committed)
- `secrets/keys/hosts/<host>.agekey.yaml` (encrypted host age key; committed; operator recipients only)
- `.clawdlets/keys/operators/<operator>.agekey` (operator private key; local only; never commit)

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

## Common keys

- `tailscale_auth_key` (required when using Tailscale auto-join)
- `garnix_netrc` (netrc for private Garnix cache access; installed at `/etc/nix/netrc` when enabled)
- `discord_token_<bot>`
- LLM API keys (configured via `fleet.envSecrets` in `fleet/clawdlets.json`):
  - `z_ai_api_key` (Z.AI; env: `ZAI_API_KEY` + `Z_AI_API_KEY`)
  - `anthropic_api_key` (Anthropic; env: `ANTHROPIC_API_KEY`)
  - `openai_api_key` (OpenAI; env: `OPENAI_API_KEY` + `OPEN_AI_APIKEY`)

Secret env vars are rendered into `/run/secrets/rendered/clawdbot-<bot>.env` and loaded
via systemd `EnvironmentFile`.

Optional:

- skill secrets referenced by `fleet.botOverrides.<bot>.skills.entries.*.envSecrets/*Secret`
- hook secrets referenced by `fleet.botOverrides.<bot>.hooks.*Secret`
- GitHub App private key PEM referenced by `fleet.botOverrides.<bot>.github.privateKeySecret`
- restic secrets (`restic_password`, optional `restic_env`)
