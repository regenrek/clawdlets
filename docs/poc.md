# POC (acceptance criteria)

Goal: prove clawdlets can provision + operate a single Hetzner host end-to-end with **no** manual secret handling and **no** drift.

## Acceptance criteria (must pass)

### Provision + install

- `CLAWDLETS_INTERACTIVE=1 clawdlets stack init` created `.clawdlets/stack.json` (schemaVersion 2).
- `CLAWDLETS_INTERACTIVE=1 clawdlets secrets init` created:
  - `.clawdlets/secrets/.sops.yaml`
  - `.clawdlets/secrets/hosts/<host>/*.yaml` (one secret per file)
  - `.clawdlets/extra-files/<host>/var/lib/sops-nix/key.txt`
  - `.clawdlets/extra-files/<host>/var/lib/clawdlets/secrets/hosts/<host>/*.yaml`
- `clawdlets doctor --scope deploy` passes.
- `clawdlets bootstrap --host <host>` succeeds.

### Post-install validation

- SSH works: `ssh admin@<ipv4>` (or your SSH alias).
- Secrets are out-of-store:
  - encrypted secrets exist at `/var/lib/clawdlets/secrets/hosts/<host>/`
  - decrypted runtime material exists under `/run/secrets/`
- Services are healthy:
  - `systemctl status 'clawdbot-*' --no-pager`
  - expected bots are running (per `infra/configs/clawdlets.json`).
- Discord routing works (bots respond in expected channels).

### Lockdown (no public SSH)

- Tailnet works (WireGuard or Tailscale).
- `clawdlets doctor --scope deploy --strict` passes.
- `clawdlets lockdown --target-host admin@<tail-ip>` succeeds.
- Public SSH closed:
  - Hetzner firewall removes TCP/22 from internet
  - NixOS only allows SSH via `tailscale0` when `publicSsh.enable=false`

### Day-2 ops

- Rebuild pinned: `clawdlets server rebuild --target-host <host> --rev HEAD` works.
- Rotate a Discord token:
  - edit `.clawdlets/secrets/hosts/<host>/discord_token_<bot>.yaml` with `sops`
  - `clawdlets secrets sync --host <host>`
  - rebuild pinned; bot uses new token
- Roll back by rebuilding an older commit SHA (pinned) and confirm bot still runs.

## Non-goals

- Multi-host fleet orchestration
- CI-driven cache/signing infra (Attic)
