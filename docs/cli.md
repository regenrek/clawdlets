# CLI (`clawdlets`)

Canonical source: `clawdlets --help`.

## Core workflow

- project scaffold: `clawdlets project init --dir ./clawdlets-myproject`
- note: `project init` already includes `infra/configs/clawdlets.json` (skip `clawdlets config init` unless resetting with `--force`)
- set fleet guild id: `clawdlets fleet set --guild-id <id>`
- add bots: `clawdlets bot add --bot <id>`
- set host basics: `clawdlets host set --add-ssh-key-file ~/.ssh/id_ed25519.pub --disk-device /dev/disk/by-id/... --enable true`
- init stack: `clawdlets stack init` (interactive: set `CLAWDLETS_INTERACTIVE=1` or pass `--interactive`)
- init secrets: `clawdlets secrets init` (interactive: set `CLAWDLETS_INTERACTIVE=1` or pass `--interactive`)
- preflight: `clawdlets doctor --scope deploy`
- lockdown gate: `clawdlets doctor --scope deploy --strict`
- bootstrap: `clawdlets bootstrap`
- lockdown: `clawdlets lockdown --target-host admin@<tailscale-ip>`

## Server ops

- status: `clawdlets server status --target-host <host>`
- logs: `clawdlets server logs --target-host <host> --unit clawdbot-melinda.service --since 10m --follow`
- restart: `clawdlets server restart --target-host <host> --unit clawdbot-melinda.service`
- rebuild pinned: `clawdlets server rebuild --target-host <host> --rev HEAD`
- GitHub sync timers: `clawdlets server github-sync status --target-host <host>`
- GitHub sync run: `clawdlets server github-sync run --target-host <host> --bot melinda`
- GitHub sync logs: `clawdlets server github-sync logs --target-host <host> --bot melinda --follow`
- GitHub sync snapshot: `clawdlets server github-sync show --target-host <host> --bot melinda --kind prs`

## Infra ops

- terraform apply: `clawdlets infra apply --public-ssh=true`
- terraform lockdown: `clawdlets infra apply --public-ssh=false`

## Justfile shortcuts

Run `just --list`.
