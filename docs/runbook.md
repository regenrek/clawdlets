# Runbook (Day 0 / Day 2)

Goal: deterministic, rebuild-only ops. Repo + `.clawdlets/` are the only sources of truth.

## Repo guardrails (one-time)

Protect `main` before first real deploy:

```bash
./scripts/gh-protect-main.sh --linear-history
```

If/when you want required status checks, re-run with explicit contexts:

```bash
./scripts/gh-protect-main.sh --require-check "ci / node" --require-check "trufflehog"
```

## Day 0 (bootstrap)

1) Enter deterministic toolchain (optional): `devenv shell`
2) `export CLAWDLETS_INTERACTIVE=1` (optional; forces prompts)
3) `clawdlets secrets init`
4) `clawdlets doctor --scope deploy`
5) `clawdlets infra apply --public-ssh=true`
6) `clawdlets bootstrap`
7) Verify tailnet, then: `clawdlets doctor --scope deploy --strict`
8) Switch admin access to VPN + close public SSH:
   - `clawdlets host set --target-host admin@<vpn-ip>`
   - `clawdlets lockdown`
9) `clawdlets server audit --target-host admin@<vpn-ip>`

## Day 2 (routine ops)

Pinned rebuilds:

- `clawdlets server rebuild --target-host admin@<vpn-ip> --rev HEAD`

Secrets rotation:

- edit `secrets/hosts/<host>/*.yaml` → `clawdlets secrets sync` → rebuild pinned

## Rollback (must exist before prod)

Normal rollback (SSH works):

- `sudo nixos-rebuild switch --rollback`
- reboot if needed

Emergency rollback (SSH broken):

- boot Hetzner rescue mode, mount the root FS, switch `/nix/var/nix/profiles/system` to an older generation, reboot

GC policy:

- keep multiple generations (don’t enable aggressive GC until you’ve tested rollback)

## GitHub inventory sync (optional)

If enabled (`services.clawdbotFleet.githubSync.enable = true`):

- `clawdlets server github-sync status --target-host admin@<vpn-ip>`
- `clawdlets server github-sync run --target-host admin@<vpn-ip> --bot <bot>`
- `clawdlets server github-sync show --target-host admin@<vpn-ip> --bot <bot> --kind prs --lines 80`

## Ops snapshots (recommended)

If enabled (`services.clawdbotFleet.opsSnapshot.enable = true`):

- snapshots at `/var/lib/clawdlets/ops/snapshots/latest.json`
- retention via `services.clawdbotFleet.opsSnapshot.keepDays/keepLast`
