# Stack (`.clawdlets/stack.json`)

`clawdlets` reads one local stack directory (default: `.clawdlets/`).

This is the local-only place for deploy inputs (CIDRs, SSH target, secret paths) and tokens.
Fleet/host config in git lives in `infra/configs/clawdlets.json`.

## Files

- `.clawdlets/stack.json`: stack config (validated)
- `.clawdlets/.env`: tokens (Hetzner, optional GitHub)
- `.clawdlets/dist/stack.schema.json`: generated JSON Schema for editor autocomplete

## Schema

Top-level:

- `schemaVersion`: currently `3`
- `base.flake` (optional): base flake URI (usually `github:<owner>/<repo>`). If unset, `clawdlets` tries to infer it from `git remote origin`.
- `envFile`: relative to `.clawdlets/` (default `.env`)
- `hosts.<name>`: host entries keyed by stack host name

Host entry (`hosts.<name>`):

- `flakeHost`: nixosConfiguration name (often same as host key)
- `targetHost` (optional): SSH target (e.g. `botsmj` or `admin@100.x`). You can skip this until after bootstrap.
- `hetzner.serverType`: e.g. `cx43` (x86_64 only: use `CX*`/`CPX*`/`CCX*`, not `CAX*`). See https://www.hetzner.com/de/cloud/
- `opentofu.adminCidr`: CIDR allowed for bootstrap SSH rule (e.g. `203.0.113.10/32`)
- `opentofu.sshPubkeyFile`: local path to `.pub`
- `secrets.localDir`: relative to `.clawdlets/` (directory of encrypted sops YAML files)
- `secrets.remoteDir`: absolute path on server (directory; used by sops-nix)

## Example

```json
{
  "schemaVersion": 3,
  "envFile": ".env",
  "hosts": {
    "clawdbot-fleet-host": {
      "flakeHost": "clawdbot-fleet-host",
      "targetHost": "botsmj",
      "hetzner": { "serverType": "cx43" },
      "opentofu": {
        "adminCidr": "203.0.113.10/32",
        "sshPubkeyFile": "~/.ssh/id_ed25519.pub"
      },
      "secrets": {
        "localDir": "secrets/hosts/clawdbot-fleet-host",
        "remoteDir": "/var/lib/clawdlets/secrets/hosts/clawdbot-fleet-host"
      }
    }
  }
}
```
