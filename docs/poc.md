# POC (acceptance criteria)

Goal: prove clawdlets can provision + operate a single Hetzner host end-to-end with **no** manual secret handling and **no** drift.

## Acceptance criteria (must pass)

### Provision + install

- `fleet/clawdlets.json` exists (schemaVersion 11) and is the single source of truth for fleet + hosts.
- `CLAWDLETS_INTERACTIVE=1 clawdlets secrets init` created/updated:
  - `secrets/.sops.yaml`
  - `secrets/keys/hosts/<host>.agekey.yaml` (encrypted host age key)
  - `secrets/hosts/<host>/*.yaml` (one secret per file; encrypted)
  - `.clawdlets/keys/operators/<operator>.agekey` (local operator key; never committed)
  - `.clawdlets/extra-files/<host>/var/lib/sops-nix/key.txt`
  - `.clawdlets/extra-files/<host>/var/lib/clawdlets/secrets/hosts/<host>/*.yaml`
- `clawdlets doctor --scope bootstrap` passes.
- `clawdlets bootstrap` succeeds.

### Post-install validation

- SSH works: `ssh admin@<ipv4>` (or your SSH alias).
- Secrets are out-of-store:
  - encrypted secrets exist at `/var/lib/clawdlets/secrets/hosts/<host>/`
  - decrypted runtime material exists under `/run/secrets/`
- Services are healthy:
  - `systemctl status 'clawdbot-*' --no-pager`
  - expected bots are running (per `fleet/clawdlets.json`).
- Discord routing works (bots respond in expected channels).

### Lockdown (no public SSH)

- Tailnet works (WireGuard or Tailscale).
- `clawdlets doctor --scope server-deploy --strict` passes.
- `clawdlets host set --target-host admin@<tail-ip>` + `clawdlets host set --ssh-exposure tailnet` then `clawdlets lockdown` succeeds.
- Public SSH closed:
  - Hetzner firewall removes TCP/22 from internet
  - NixOS only allows SSH via `tailscale0` when `sshExposure.mode=tailnet`

### Day-2 ops

- Deploy pinned: `clawdlets server deploy --manifest deploy/<host>/prod/<releaseId>.json` works.
- Rotate a Discord token:
  - edit `secrets/hosts/<host>/discord_token_<bot>.yaml` with `sops`
  - `clawdlets secrets sync`
  - deploy pinned; bot uses new token
- Roll back by deploying an older commit SHA (pinned) and confirm bot still runs.

## Non-goals

- Multi-host fleet orchestration
- CI-driven cache/signing infra (Attic)
