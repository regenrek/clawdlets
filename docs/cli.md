# CLI (`clawdlets`)

Canonical source: `clawdlets --help`.

Related
- `clf` is the bot-facing CLI (`clf jobs ...`). See `docs/orchestrator.md`.

## Core workflow

- project scaffold: `clawdlets project init --dir ./clawdlets-myproject`
- note: `project init` already includes `fleet/clawdlets.json` (skip `clawdlets config init` unless resetting with `--force`)
- template source defaults to `config/template-source.json` (repo + path + 40-hex ref); override with `--template`, `--template-path`, `--template-ref`
- set fleet guild id: `clawdlets fleet set --guild-id <id>`
- add bots: `clawdlets bot add --bot <id>`
- set host basics: `clawdlets host set --add-ssh-key-file ~/.ssh/id_ed25519.pub --disk-device /dev/sda --enable true`
- set SSH exposure for bootstrap: `clawdlets host set --ssh-exposure bootstrap`
- init secrets: `clawdlets secrets init` (TTY defaults to interactive; non-interactive uses `--from-json .clawdlets/secrets.json`)
- preflight: `clawdlets doctor --scope bootstrap`
- deploy gate: `clawdlets doctor --scope server-deploy --strict`
- bootstrap: `clawdlets bootstrap`
- image build (optional): `clawdlets image build --host <host>`
- image upload (optional): `clawdlets image upload --host <host> --image-url <url>`
- bootstrap (image): `clawdlets bootstrap --mode image`
- set target host: `clawdlets host set --target-host admin@<tailscale-ip>`
- set SSH exposure to tailnet: `clawdlets host set --ssh-exposure tailnet`
- lockdown: `clawdlets lockdown`

## Server ops

- status: `clawdlets server status --target-host <host>`
- logs: `clawdlets server logs --target-host <host> --unit clawdbot-melinda.service --since 10m --follow`
- restart: `clawdlets server restart --target-host <host> --unit clawdbot-melinda.service`
- manifest: `clawdlets server manifest --host <host> --out deploy-manifest.<host>.json`
- deploy pinned: `clawdlets server deploy --manifest deploy-manifest.<host>.json`
- GitHub sync timers: `clawdlets server github-sync status --target-host <host>`
- GitHub sync run: `clawdlets server github-sync run --target-host <host> --bot melinda`
- GitHub sync logs: `clawdlets server github-sync logs --target-host <host> --bot melinda --follow`
- GitHub sync snapshot: `clawdlets server github-sync show --target-host <host> --bot melinda --kind prs`

## Infra ops

- opentofu apply: `clawdlets infra apply`

## Justfile shortcuts

Run `just --list`.
