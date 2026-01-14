# CLI (`clawdlets`)

Canonical source: `clawdlets --help`.

## Core workflow

- project scaffold: `clawdlets project init --dir ./clawdlets-myproject`
- note: `project init` already includes `fleet/clawdlets.json` (skip `clawdlets config init` unless resetting with `--force`)
- set fleet guild id: `clawdlets fleet set --guild-id <id>`
- add bots: `clawdlets bot add --bot <id>`
- set host basics: `clawdlets host set --add-ssh-key-file ~/.ssh/id_ed25519.pub --disk-device /dev/disk/by-id/... --enable true`
- init secrets: `clawdlets secrets init` (TTY defaults to interactive; non-interactive uses `--from-json .clawdlets/secrets.json`)
- preflight: `clawdlets doctor --scope deploy`
- lockdown gate: `clawdlets doctor --scope deploy --strict`
- bootstrap: `clawdlets bootstrap`
- set target host: `clawdlets host set --target-host admin@<tailscale-ip>`
- lockdown: `clawdlets lockdown`

## Server ops

- status: `clawdlets server status --target-host <host>`
- logs: `clawdlets server logs --target-host <host> --unit clawdbot-melinda.service --since 10m --follow`
- restart: `clawdlets server restart --target-host <host> --unit clawdbot-melinda.service`
- deploy pinned: `clawdlets server deploy --target-host <host> --toplevel /nix/store/... --rev <sha|HEAD>`
- GitHub sync timers: `clawdlets server github-sync status --target-host <host>`
- GitHub sync run: `clawdlets server github-sync run --target-host <host> --bot melinda`
- GitHub sync logs: `clawdlets server github-sync logs --target-host <host> --bot melinda --follow`
- GitHub sync snapshot: `clawdlets server github-sync show --target-host <host> --bot melinda --kind prs`

## Infra ops

- opentofu apply: `clawdlets infra apply --public-ssh=true`
- opentofu lockdown: `clawdlets infra apply --public-ssh=false`

## Justfile shortcuts

Run `just --list`.
