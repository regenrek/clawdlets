# Secrets (sops + age)

Files:

- `.clawdlets/secrets/.sops.yaml` (recipients + rules)
- `.clawdlets/secrets/hosts/<host>/` (encrypted secrets payload; one secret per file)
- `.clawdlets/secrets/hosts/*.age.pub` (public)
- `.clawdlets/secrets/hosts/*.agekey` (private; never commit)
- `.clawdlets/secrets/operators/*.agekey` (private; never commit)

## Recommended: use the CLI

```bash
clawdlets secrets init
```

This generates:
- host + operator age keys
- `.clawdlets/secrets/.sops.yaml`
- `.clawdlets/extra-files/<host>/var/lib/sops-nix/key.txt`
- `.clawdlets/extra-files/<host>/var/lib/clawdlets/secrets/hosts/<host>/`
- encrypts `.clawdlets/secrets/hosts/<host>/*.yaml`

Then sync to the host (used by sops-nix on the server):

```bash
clawdlets secrets sync --host <host>
```

Verify (recommended before rebuild):

```bash
clawdlets secrets verify --host <host>
```

## Migration (legacy stacks)

If you previously used a single file per host (like `.clawdlets/secrets/hosts/clawdbot-fleet-host.yaml`) and/or your `.clawdlets/stack.json` is `schemaVersion: 1`:

```bash
clawdlets secrets migrate --host <host>
```

Notes:
- Refuses to overwrite non-empty target dirs unless you pass `--yes`.
- Renames legacy secrets files to `*.bak*` (no delete).
- Upgrades `.clawdlets/stack.json` to `schemaVersion: 2` (and upgrades all hosts’ `secrets.*` fields).

After migrating:

```bash
clawdlets secrets sync --host <host>
```

## Manual steps (if needed)

### 1) Generate host age key

```bash
mkdir -p .clawdlets/secrets/hosts
age-keygen -o .clawdlets/secrets/hosts/clawdbot-fleet-host.agekey
age-keygen -y .clawdlets/secrets/hosts/clawdbot-fleet-host.agekey > .clawdlets/secrets/hosts/clawdbot-fleet-host.age.pub
```

Update `.clawdlets/secrets/.sops.yaml` with the `clawdbot-fleet-host.age.pub` recipient.

### 2) Edit secrets and encrypt

Edit files under `.clawdlets/secrets/hosts/clawdbot-fleet-host/`, then:

```bash
sops -e -i .clawdlets/secrets/hosts/clawdbot-fleet-host/discord_token_maren.yaml
```

### 3) nixos-anywhere extra files

Key for first boot:

```bash
mkdir -p .clawdlets/extra-files/clawdbot-fleet-host/var/lib/sops-nix
cp .clawdlets/secrets/hosts/clawdbot-fleet-host.agekey .clawdlets/extra-files/clawdbot-fleet-host/var/lib/sops-nix/key.txt
```

## Common keys

- `wg_private_key`
- `discord_token_<bot>`
- `z_ai_api_key` (Z.AI provider; mapped to ZAI_API_KEY/Z_AI_API_KEY env)

Secret env vars are rendered into `/run/secrets/rendered/clawdbot-<bot>.env` and loaded
via systemd `EnvironmentFile`.

Optional:

- skill secrets referenced by `fleet.botOverrides.<bot>.skills.entries.*.envSecrets/*Secret`
- hook secrets referenced by `fleet.botOverrides.<bot>.hooks.*Secret`
- GitHub App private key PEM referenced by `fleet.botOverrides.<bot>.github.privateKeySecret`
- restic secrets (`restic_password`, optional `restic_env`)
