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

- `schemaVersion`: currently `7`
- `defaultHost` (optional): used when `--host` is omitted
- `baseFlake` (optional): flake URI for remote builds (e.g. `github:<owner>/<repo>`)
  - if empty, CLI falls back to `git remote origin` (recommended)
- `fleet.*`: bots + infra policy + raw clawdbot config
- `cattle.*`: ephemeral agent instances (Hetzner)
- `hosts.<host>`: host entries keyed by host name

Fleet (`fleet.*`):

- `fleet.envSecrets`: default env var -> sops secret name (merged into every bot profile)
- `fleet.botOrder`: ordered bot ids (deterministic ports/services)
- `fleet.bots.<bot>`: per-bot config object
  - `profile`: clawdlets/template infra knobs (systemd/env/secrets/limits)
    - `profile.envSecrets`: per-bot env var -> sops secret name (overrides/extends `fleet.envSecrets`)
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

## Example

```json
{
  "schemaVersion": 7,
  "defaultHost": "clawdbot-fleet-host",
  "baseFlake": "",
  "fleet": {
    "envSecrets": { "ZAI_API_KEY": "z_ai_api_key", "Z_AI_API_KEY": "z_ai_api_key" },
    "botOrder": ["maren"],
    "bots": {
      "maren": {
        "profile": { "envSecrets": { "DISCORD_BOT_TOKEN": "discord_token_maren" } },
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
