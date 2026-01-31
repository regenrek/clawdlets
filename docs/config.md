# Config (`fleet/clawdlets.json`)

Single source of truth for fleet + host settings.

This file is **committed to git**. Secrets are not stored here (see `docs/secrets.md`).

## Related dirs

- `fleet/clawdlets.json`: canonical config (validated)
- `secrets/`: canonical encrypted secrets (sops + age; safe to commit)
- `.clawdlets/`: local runtime dir (gitignored)
  - local operator age keys (`.clawdlets/keys/operators/`)
  - `nixos-anywhere --extra-files` payload (`.clawdlets/extra-files/<host>/...`)
  - image builds (`.clawdlets/images/<host>/...`)
  - provisioning state (gitignored): `.clawdlets/infra/opentofu/<host>/...`

## Schema overview

Top-level:

- `schemaVersion`: currently `9`
- `defaultHost` (optional): used when `--host` is omitted
- `baseFlake` (optional): flake URI for remote builds (e.g. `github:<owner>/<repo>`)
  - if empty, CLI falls back to `git remote origin` (recommended)
- `fleet.*`: bots + infra policy + raw clawdbot config
- `cattle.*`: ephemeral agent instances (Hetzner)
- `hosts.<host>`: host entries keyed by host name

Fleet (`fleet.*`):

- `fleet.secretEnv`: env var name -> sops secret name (global defaults)
- `fleet.secretFiles`: host-scoped secret files (id -> `{ secretName, targetPath, ... }`)
- `fleet.botOrder`: ordered bot ids (deterministic ports/services)
- `fleet.bots.<bot>`: per-bot config object
  - `profile`: clawdlets/template infra knobs (systemd/env/secrets/limits)
    - `profile.secretEnv`: per-bot env var -> sops secret name overrides (merged onto `fleet.secretEnv`)
    - `profile.secretEnvAllowlist`: optional allowlist of env vars written into the bot env file (least-privilege)
    - `profile.secretFiles`: bot-scoped secret files (id -> `{ secretName, targetPath, ... }`)
    - other keys are forwarded into Nix `services.clawdbotFleet.botProfiles.<bot>` (forward compatible)
  - `clawdbot`: raw clawdbot config (canonical; channels/routing/agents/tools/etc)
  - `clf`: clawdlets/clf policy (bot access to orchestrator/queue)

Host entry (`hosts.<host>`):

- `enable`: whether fleet services should run
- `diskDevice`: passed into the disko module (required for install)
- `sshAuthorizedKeys`: admin SSH public keys (key-only; no passwords over SSH)
- `sshKnownHosts`: pinned SSH host keys (known_hosts lines) for deploy automation
- `flakeHost` (optional): nixosConfiguration output name override
- `targetHost` (optional): SSH target for server ops (ssh config alias or `user@host`)
- `hetzner.serverType`: e.g. `cx43`
- `hetzner.image`: custom image ID/name (optional; used for image-based bootstrap)
- `hetzner.location`: e.g. `nbg1` (used by provisioning + image upload helpers)
- `provisioning.adminCidr`: CIDR allowed to SSH during bootstrap (e.g. `203.0.113.10/32`)
- `provisioning.adminCidrAllowWorldOpen`: allow `0.0.0.0/0` or `::/0` (default: `false`)
- `provisioning.sshPubkeyFile`: local path to `.pub` used for provisioning
- `operator.deploy.enable`: allow `admin` to run constrained deploy entrypoints (switch-system/install-secrets). Default: `false`.
- `sshExposure.mode`: `tailnet|bootstrap|public` (single SSH exposure policy)
- `tailnet.mode`: `tailscale` or `none` (tailscale mode opens UDP/41641 at the provider firewall for direct tailnet connectivity)
- `cache.garnix.private.enable`: enable private Garnix cache access (requires netrc secret)
- `cache.garnix.private.netrcSecret`: sops secret name containing `/etc/nix/netrc`
- `cache.garnix.private.netrcPath`: path for the netrc file (default: `/etc/nix/netrc`)
- `cache.garnix.private.narinfoCachePositiveTtl`: TTL for private Garnix cache (default: `3600`)
- `selfUpdate.enable`: enable pull-based self-updates from a manifest URL
- `selfUpdate.manifestUrl`: URL to the per-host deploy manifest
- `selfUpdate.interval`: systemd timer cadence (e.g. `30min`)
- `selfUpdate.publicKey`: minisign public key (optional)
- `selfUpdate.signatureUrl`: minisign signature URL (required if publicKey is set)

Cattle (`cattle.*`):

- `cattle.enabled`: enable cattle commands (requires `cattle.hetzner.image`)
- `cattle.hetzner.image`: Hetzner image ID/name for cattle VMs (custom image)
- `cattle.hetzner.serverType`: e.g. `cx22`
- `cattle.hetzner.location`: e.g. `nbg1`
- `cattle.hetzner.maxInstances`: hard cap for parallel cattle instances
- `cattle.hetzner.defaultTtl`: TTL like `2h` / `30m` (used when `--ttl` omitted)
- `cattle.hetzner.labels`: extra base labels to stamp on cattle servers (safe keys/values only)
- `cattle.defaults.autoShutdown`: power off after task completes (recommended)
- `cattle.defaults.callbackUrl`: optional callback URL for task results

## Secret scoping + `${ENV}` wiring

- fleet scope: `fleet.secretEnv` (shared env var -> secret name mappings)
- bot scope: `fleet.bots.<bot>.profile.secretEnv` (per-bot overrides)
- host secret files: `fleet.secretFiles` → `targetPath` must be under `/var/lib/clawdlets/`
- bot secret files: `fleet.bots.<bot>.profile.secretFiles` → `targetPath` must be under `/var/lib/clawdlets/secrets/bots/<bot>/`

Clawdbot config should use `${ENV_VAR}` (uppercase/underscores). Clawdlets scans `fleet.bots.<bot>.clawdbot` for `${ENV_VAR}` refs plus channel tokens, hooks tokens, skill apiKey fields, and provider `apiKey` fields to build the secrets plan.

- Inline tokens/API keys emit warnings; strict mode fails them.
- Escape literal `${ENV_VAR}` as `$${ENV_VAR}`.

Hooks + skills env wiring:
- `hooks.token` → `${CLAWDBOT_HOOKS_TOKEN}`
- `hooks.gmail.pushToken` → `${CLAWDBOT_HOOKS_GMAIL_PUSH_TOKEN}`
- `skills.entries.<skill>.apiKey` → `${CLAWDBOT_SKILL_<SKILL>_API_KEY}`

If you set `profile.hooks.*Secret` or `profile.skills.entries.*.apiKeySecret`, clawdlets derives the env mapping automatically.

## Autowire missing secretEnv

CLI:
- `clawdlets config wire-secrets --write` (adds missing mappings; auto scope)
- `clawdlets secrets init --autowire` (runs autowire before init)

UI:
- Host secrets panel: Missing secret wiring -> Wire all
- Bot integrations panel: Secret wiring (advanced)

Default autowire scope:
- channel secrets → bot
- model/provider secrets → fleet

## Least-privilege env injection (optional)

- Set `profile.secretEnvAllowlist` to restrict which env vars are written into each bot env file.
- Generate from current config: `clawdlets config derive-allowlist --write`.
- `clawdlets config validate --strict` fails if the allowlist doesn’t match derived requirements.

## Strict mode

- `clawdlets config validate --strict`: treat inline secrets + invariant overrides + allowlist mismatches as errors.
- `clawdlets doctor --scope server-deploy --strict`: deploy gate; fails on warn.

## Migration notes

- v10: SSH keys are project-scoped under `fleet.sshAuthorizedKeys`/`fleet.sshKnownHosts` (no longer per-host).
- v9: inline secrets are deprecated; move tokens/api keys to `${ENV_VAR}` wiring and secretEnv mappings (hooks/skills included).

## Example

```json
{
  "schemaVersion": 10,
  "defaultHost": "clawdbot-fleet-host",
  "baseFlake": "",
  "fleet": {
    "secretEnv": { "ZAI_API_KEY": "z_ai_api_key" },
    "secretFiles": {},
    "sshAuthorizedKeys": [],
    "sshKnownHosts": [],
    "botOrder": ["maren"],
    "bots": {
      "maren": {
        "profile": { "secretEnv": { "DISCORD_BOT_TOKEN": "discord_token_maren" }, "secretFiles": {} },
        "clawdbot": {
          "channels": {
            "discord": {
              "enabled": true,
              "token": "${DISCORD_BOT_TOKEN}",
              "dm": { "enabled": true, "policy": "pairing" }
            }
          }
        }
      }
    },
    "codex": { "enable": false, "bots": [] },
    "backups": { "restic": { "enable": false, "repository": "" } }
  },
  "cattle": {
    "enabled": false,
    "hetzner": {
      "image": "",
      "serverType": "cx22",
      "location": "nbg1",
      "maxInstances": 10,
      "defaultTtl": "2h",
      "labels": { "managed-by": "clawdlets" }
    },
    "defaults": { "autoShutdown": true, "callbackUrl": "" }
  },
  "hosts": {
    "clawdbot-fleet-host": {
      "enable": false,
      "diskDevice": "/dev/sda",
      "sshAuthorizedKeys": [],
      "sshKnownHosts": [],
      "flakeHost": "",
      "hetzner": { "serverType": "cx43", "image": "", "location": "nbg1" },
      "provisioning": {
        "adminCidr": "",
        "adminCidrAllowWorldOpen": false,
        "sshPubkeyFile": "~/.ssh/id_ed25519.pub"
      },
      "cache": {
        "garnix": {
          "private": {
            "enable": false,
            "netrcSecret": "garnix_netrc",
            "netrcPath": "/etc/nix/netrc",
            "narinfoCachePositiveTtl": 3600
          }
        }
      },
      "sshExposure": { "mode": "bootstrap" },
      "tailnet": { "mode": "tailscale" },
      "selfUpdate": {
        "enable": false,
        "manifestUrl": "",
        "interval": "30min",
        "publicKey": "",
        "signatureUrl": ""
      },
      "agentModelPrimary": "zai/glm-4.7"
    }
  }
}
```
