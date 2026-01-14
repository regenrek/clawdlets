# Quickstart (CLI-first)

Goal: provision a Hetzner VM + install NixOS + bring up Discord bots, with secrets in `secrets/` (sops-encrypted) and runtime state in `.clawdlets/` (gitignored).

## Prereqs (local)

- Nix installed (`nix --version`)
- Node 22+ (for `clawdlets`)
- SSH keypair (`~/.ssh/id_ed25519.pub` recommended)

## CLI commands

Run `clawdlets --help` for full flags.

Install (recommended):

```bash
npm install -g clawdlets
clawdlets --help
```

If you’re developing inside this monorepo, use the pnpm wrappers (example): `pnpm run clawdlets:secrets -- init` == `clawdlets secrets init`.

- `clawdlets doctor --scope deploy`: deploy preflight (fails on missing).
- `clawdlets doctor --scope deploy --strict`: lockdown gate (fails on warn/missing).
- `clawdlets secrets init`: generates operator keys + host key, writes encrypted secrets under `secrets/hosts/<host>/`, and generates `.clawdlets/extra-files/<host>/...` for first install.
- `clawdlets bootstrap`: runs OpenTofu + `nixos-anywhere` install (prints target IPv4; clears stale `known_hosts`).
- `clawdlets infra apply`: opentofu apply only (bootstrap SSH toggle).
- `clawdlets lockdown`: remove public SSH from Hetzner firewall (use `--skip-rebuild` if you deploy by store path).
- `clawdlets server <cmd>`: run server-side operations over SSH (`status`, `logs`, `restart`, `deploy`).

## Recommended workflow (new host)

0) (optional) create a fresh project repo:
```bash
export CLAWDLETS_INTERACTIVE=1
clawdlets project init --dir ./clawdlets-myproject
cd ./clawdlets-myproject
```

Note: `project init` already includes `fleet/clawdlets.json`. Don’t run `clawdlets config init` unless you want to reset it (`--force`).

1) Configure fleet + host (CLI-first):
- set guild id: `clawdlets fleet set --guild-id <discord-guild-id>`
- add bots: `clawdlets bot add --bot <id>` (repeat)
- host basics:
  - add SSH key: `clawdlets host set --add-ssh-key-file ~/.ssh/id_ed25519.pub`
  - set disk device: `clawdlets host set --disk-device /dev/disk/by-id/...`
  - enable fleet: `clawdlets host set --enable true`
  - tailnet defaults to Tailscale (change via `clawdlets host set --tailnet none|tailscale` if needed)

Canonical config lives in `fleet/clawdlets.json` (don’t edit Nix files directly).

2) Create secrets + preflight:
```bash
clawdlets secrets init
clawdlets doctor --scope deploy
```

Non-interactive: keep inputs in `.clawdlets/secrets.json` and run `clawdlets secrets init --from-json .clawdlets/secrets.json` (if the file is missing, `secrets init` will write a template and exit).

LLM API keys are provided via `secrets.<secretName>` in that JSON (e.g. `secrets.z_ai_api_key`) and wired to env via `fleet.envSecrets` in `fleet/clawdlets.json`.

3) Provision + install:
```bash
clawdlets bootstrap
```

4) Verify access:
- SSH: `ssh admin@<ipv4>`
- Console: `admin` login should work (sudo password exists; SSH stays key-only)

5) Lock down after VPN/tailnet works:
- ensure `publicSsh.enable=false`: `clawdlets host set --public-ssh false`
- then:
```bash
clawdlets host set --target-host admin@<tailscale-ip>
clawdlets lockdown
```

6) Deploy (pinned to a full commit SHA):
```bash
clawdlets server deploy --target-host admin@<ipv4> --toplevel /nix/store/... --rev HEAD
```

`--rev HEAD` resolves to the full SHA locally before the deploy.

## Server checks

```bash
clawdlets server status --target-host admin@<ipv4>
clawdlets server logs --target-host admin@<ipv4> --unit clawdbot-maren.service --since 15m --follow
```

## Common follow-ups

- Change tokens/passwords: edit `secrets/hosts/<host>/*.yaml` with sops, then deploy.
- Add a bot: `clawdlets bot add --bot <id>` → re-run `clawdlets secrets init` → deploy.
- Add/enable a skill:
  - add it to `fleet/bundled-skills.json` (if bundled)
  - allow it per-bot via canonical config:
    - `clawdlets config set --path fleet.botOverrides.<bot>.skills.allowBundled --value-json '["github","brave-search"]'`
  - if it needs secrets: add `secrets/hosts/<host>/<secret>.yaml`, then `clawdlets server deploy`
- Add another operator machine: add their age public key to `secrets/.sops.yaml` recipients for that host and re-encrypt.
