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

## Schema overview

Top-level:

- `schemaVersion`: currently `6`
- `defaultHost` (optional): used when `--host` is omitted
- `baseFlake` (optional): flake URI for remote builds (e.g. `github:<owner>/<repo>`)
  - if empty, CLI falls back to `git remote origin` (recommended)
- `fleet.*`: bots + routing/skills overrides
- `fleet.envSecrets`: env var -> sops secret name (used for LLM API keys + other secret env)
- `cattle.*`: ephemeral agent instances (Hetzner)
- `hosts.<host>`: host entries keyed by host name

Host entry (`hosts.<host>`):

- `enable`: whether fleet services should run
- `diskDevice`: passed into the disko module (required for install)
- `sshAuthorizedKeys`: admin SSH public keys (key-only; no passwords over SSH)
- `sshKnownHosts`: pinned SSH host keys (known_hosts lines) for deploy automation
- `flakeHost` (optional): nixosConfiguration output name override
- `targetHost` (optional): SSH target for server ops (ssh config alias or `user@host`)
- `hetzner.serverType`: e.g. `cx43`
- `hetzner.image`: custom image ID/name (optional; used for image-based bootstrap)
- `hetzner.location`: e.g. `nbg1` (used by OpenTofu + image upload helpers)
- `opentofu.adminCidr`: CIDR allowed to SSH during bootstrap (e.g. `203.0.113.10/32`)
- `opentofu.sshPubkeyFile`: local path to `.pub` used for provisioning
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
  "schemaVersion": 6,
  "defaultHost": "clawdbot-fleet-host",
  "baseFlake": "",
  "fleet": {
    "guildId": "",
    "envSecrets": { "ZAI_API_KEY": "z_ai_api_key", "Z_AI_API_KEY": "z_ai_api_key" },
    "bots": ["maren", "sonja", "gunnar", "melinda"],
    "botOverrides": {},
    "routingOverrides": {},
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
      "opentofu": { "adminCidr": "", "sshPubkeyFile": "~/.ssh/id_ed25519.pub" },
      "cache": {
        "garnix": {
          "private": {
            "enable": true,
            "netrcSecret": "garnix_netrc",
            "netrcPath": "/etc/nix/netrc",
            "narinfoCachePositiveTtl": 3600
          }
        }
      },
      "sshExposure": { "mode": "tailnet" },
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
