# Overview

This repo = **public-safe infra + fleet config**.

Everything instance-specific (tokens/keys/IPs) lives in **`.clawdlets/`** (gitignored).

## What lives where

**In git**
- `infra/`: NixOS + OpenTofu + fleet module
- `docs/`: operating manual
- `cli/`: `clawdlets` (single entrypoint)
- `packages/core/`: shared logic (CLI + future UI)

**Not in git (`.clawdlets/`)**
- `stack.json`: instance config (hosts, flake base, opentofu inputs)
- `.env`: local tokens needed for provisioning (Hetzner, optional GitHub)
- `secrets/`: sops/age keys + encrypted host secrets
- `extra-files/`: files injected during `nixos-anywhere` (host age key + host secrets)

## Deployment lifecycle (Hetzner)

0) (optional) scaffold a fresh project repo:
```bash
export CLAWDLETS_INTERACTIVE=1
clawdlets project init --dir ./clawdlets-myproject
cd ./clawdlets-myproject
```

Note: `project init` already includes `infra/configs/clawdlets.json`. Don’t run `clawdlets config init` unless you want to reset it (`--force`).

1) **Configure canonical config (bots/host)**

```bash
clawdlets fleet set --guild-id <id>
clawdlets bot add --bot <id>
clawdlets host set --add-ssh-key-file ~/.ssh/id_ed25519.pub
clawdlets host set --disk-device /dev/disk/by-id/...
clawdlets host set --enable true
```

2) **Create stack**
```bash
export CLAWDLETS_INTERACTIVE=1
clawdlets stack init
```

3) **Create secrets (sops/age)**
```bash
clawdlets secrets init
```

4) **Sanity checks**
```bash
clawdlets doctor --scope deploy
```

5) **Provision + install (OpenTofu + nixos-anywhere)**
```bash
clawdlets bootstrap
```

6) **Lock down (after tailnet works)**
```bash
clawdlets lockdown --target-host admin@<tailscale-ip>
```

7) **Operate**
- status: `clawdlets server status --target-host <host>`
- logs: `clawdlets server logs --target-host <host> --unit clawdbot-melinda.service --follow`
- rebuild pinned: `just server-rebuild-rev <host> HEAD`

## Secrets model (important)

- Host secrets file lives on the **host filesystem**:
  - `/var/lib/clawdlets/secrets/hosts/<host>/<secret>.yaml`
- `sops-nix` reads it from that path (so secrets don’t end up in `/nix/store`).
- `nixos-anywhere` injects on first install via `.clawdlets/extra-files/<host>/...`.

See `docs/secrets.md` and `docs/security.md`.
