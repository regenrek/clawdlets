# Quickstart (CLI-first)

> 🚨🚨
> **Use at your own risk!** This project is under active development and not production-ready. You absolutely need to know what you're doing before deploying this. Misconfiguration can expose credentials, open security holes, or cause data loss.
>
> **Important:** clawdlets infrastructure does not automatically mean your clawdbot setup is secure. A misconfigured clawdbot config can still expose your VPS. Read the [Security Guide](https://docs.clawd.bot/cli/security#security) carefully before proceeding.

Goal: provision a Hetzner VM + install NixOS + bring up Discord bots, with secrets in `secrets/` (sops-encrypted) and runtime state in `.clawdlets/` (gitignored).

## Prereqs (local)

- Nix installed (`nix --version`)
- Node 22+ (for `clawdlets`)
- SSH keypair (`~/.ssh/id_ed25519.pub` recommended)

## CLI commands

Run `clawdlets --help` for full flags.

Install from local monorepo:

```bash
pnpm install
pnpm run clawdlets -- --help
```

Use the pnpm wrapper for all commands (example): `pnpm run clawdlets -- secrets init` == `clawdlets secrets init`.

- `clawdlets doctor --scope bootstrap`: bootstrap preflight (fails on missing).
- `clawdlets doctor --scope server-deploy --strict`: deploy gate (fails on warn/missing).
- `clawdlets secrets init`: generates operator keys + host key, writes encrypted secrets under `secrets/hosts/<host>/`, and generates `.clawdlets/extra-files/<host>/...` for first install.
- `clawdlets bootstrap`: runs provisioning + `nixos-anywhere` install (prints target IPv4; clears stale `known_hosts`).
- `clawdlets infra apply`: provisioning apply only (driven by `fleet/clawdlets.json`).
- `clawdlets lockdown`: reconcile to tailnet-only SSH (provisioning only).
- `clawdlets server <cmd>`: run server-side operations over SSH (`status`, `logs`, `restart`, `deploy`).

## Recommended workflow (new host)

0) (optional) create a fresh project repo:
```bash
export CLAWDLETS_INTERACTIVE=1
clawdlets project init --dir ./clawdlets-myproject
cd ./clawdlets-myproject
```

Note: `project init` already includes `fleet/clawdlets.json`. Don’t run `clawdlets config init` unless you want to reset it (`--force`).
Template source defaults to the pinned config in `config/template-source.json` (repo + path + 40-hex ref).
Override with `--template`, `--template-path`, or `--template-ref` (or env `CLAWDLETS_TEMPLATE_*`).

0.5) Enable Garnix for the project repo (private cache) and add the netrc secret:
- turn on Garnix for the repo and set the cache to private
- add `secrets/hosts/<host>/garnix_netrc.yaml` with your netrc credentials (required)

1) Configure fleet + host (CLI-first):
- configure channels (Discord/Telegram/Slack/WhatsApp) in each bot’s `fleet.bots.<bot>.clawdbot` (recommended via web UI: Setup → Bots → Integrations)
- add bots: `clawdlets bot add --bot <id>` (repeat)
- host basics:
  - add SSH key: `clawdlets host set --add-ssh-key-file ~/.ssh/id_ed25519.pub`
  - pin host key (for CI deploy): `clawdlets host set --add-ssh-known-host "<host> ssh-ed25519 AAAA..."`
  - set disk device: `clawdlets host set --disk-device /dev/sda`
  - enable fleet: `clawdlets host set --enable true`
  - tailnet defaults to Tailscale (change via `clawdlets host set --tailnet none|tailscale` if needed)
  - set SSH exposure for bootstrap: `clawdlets host set --ssh-exposure bootstrap`

Canonical config lives in `fleet/clawdlets.json` (don’t edit Nix files directly).

2) Create secrets + preflight:
```bash
clawdlets secrets init
clawdlets doctor --scope bootstrap
```

Non-interactive: keep inputs in `.clawdlets/secrets.json` and run `clawdlets secrets init --from-json .clawdlets/secrets.json` (if the file is missing, `secrets init` will write a template and exit).

LLM API keys are provided via `secrets.<secretName>` in that JSON (e.g. `secrets.z_ai_api_key`) and wired to env via `fleet.secretEnv` (e.g. `fleet.secretEnv.ZAI_API_KEY = "z_ai_api_key"`).

3) Provision + install:
```bash
clawdlets bootstrap
```

Optional image-based bootstrap: see `docs/image-based-provisioning.md` and run:

```bash
clawdlets image build --host <host>
clawdlets image upload --host <host> --image-url https://<bucket>/<image>.raw --compression bz2
clawdlets bootstrap --mode image
```

4) Verify access:
- SSH (when `sshExposure.mode=bootstrap|public`): `ssh admin@<ipv4>`
- Console: `admin` login should work (sudo password exists; SSH stays key-only)

5) Lock down after VPN/tailnet works:

> 🚨 **CRITICAL:** Lockdown is mandatory! Without it, your server remains publicly accessible via SSH. Run `clawdlets lockdown` as soon as your VPN/tailnet connection is confirmed working. Skipping this step leaves your server exposed to the internet.

```bash
clawdlets host set --target-host admin@<tailscale-ip>
clawdlets host set --ssh-exposure tailnet
clawdlets server deploy --manifest deploy-manifest.<host>.json
clawdlets lockdown
```

6) Deploy (pinned to a full commit SHA):
```bash
clawdlets server deploy --manifest deploy-manifest.<host>.json
```

Manifest pins the full 40-hex SHA.

If you don’t have CI manifests yet, generate one locally:

```bash
clawdlets server manifest --host <host> --out deploy-manifest.<host>.json
```

Note: building NixOS system artifacts requires Linux. On macOS, use CI (`deploy-manifest.yml`) or a Linux builder and then deploy by `--manifest`/`--toplevel`.

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
    - `clawdlets config set --path fleet.bots.<bot>.profile.skills.allowBundled --value-json '["github","brave-search"]'`
  - if it needs secrets: add `secrets/hosts/<host>/<secret>.yaml`, then `clawdlets server deploy`
- Add another operator machine: add their age public key to `secrets/.sops.yaml` recipients for that host and re-encrypt.
