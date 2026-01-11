# Runbook (Day 0 / Day 2)

Goal: deterministic, rebuild-only ops. Repo + `.clawdlets/` are the only sources of truth.

## Day 0 (bootstrap)

1) Enter deterministic toolchain (optional): `devenv shell`
2) `export CLAWDLETS_INTERACTIVE=1`
3) `clawdlets stack init`
4) `clawdlets secrets init`
5) `clawdlets doctor --scope deploy`
6) `clawdlets infra apply --public-ssh=true`
7) `clawdlets bootstrap`
8) Verify tailnet, then: `clawdlets doctor --scope deploy --strict`
9) Switch admin access to VPN + close public SSH: `clawdlets lockdown --target-host admin@<vpn-ip>`
10) `clawdlets server audit --target-host admin@<vpn-ip>`

## Day 2 (routine ops)

Pinned rebuilds:

- `clawdlets server rebuild --target-host admin@<vpn-ip> --rev HEAD`

Secrets rotation:

- edit `.clawdlets/secrets/hosts/<host>/*.yaml` → `clawdlets secrets sync --host <host>` → rebuild pinned

## GitHub inventory sync (optional)

If enabled (`services.clawdbotFleet.githubSync.enable = true`):

- `clawdlets server github-sync status --target-host admin@<vpn-ip>`
- `clawdlets server github-sync run --target-host admin@<vpn-ip> --bot <bot>`
- `clawdlets server github-sync show --target-host admin@<vpn-ip> --bot <bot> --kind prs --lines 80`

## Ops snapshots (recommended)

If enabled (`services.clawdbotFleet.opsSnapshot.enable = true`):

- snapshots at `/var/lib/clawdlets/ops/snapshots/latest.json`
- retention via `services.clawdbotFleet.opsSnapshot.keepDays/keepLast`
