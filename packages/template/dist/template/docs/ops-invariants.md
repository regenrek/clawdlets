# Ops invariants

Goal: zero drift. Repo + `.clawdlets/` are the only sources of truth.

## Deploy-only

- Any persistent change must be done by editing this repo (or `.clawdlets/`) and deploying.
- Prefer pinned deploys: `clawdlets server deploy --rev <sha|HEAD> --toplevel /nix/store/...` (or `--manifest <deploy.json>`).
- Assume the box is disposable. Reinstall beats debugging a snowflake.

## No manual host edits

Do **not**:

- edit `/etc/nixos/*`
- run `passwd` / mutate users on-host (`users.mutableUsers = false`)
- copy secrets by hand into `/run/secrets/*` or `/nix/store`
- “quick fix” systemd units locally

Do:

- change config in `infra/` + deploy
- rotate secrets by editing `secrets/hosts/<host>/<secret>.yaml` (sops) then `clawdlets server deploy`
- use `clawdlets server status|logs|restart|deploy` for day-2 ops
- run `clawdlets server audit --target-host <host>` after bootstrap/lockdown and after major changes

## Breakglass (explicit)

If you *must* do a live fix:

1) do the minimum to restore service
2) immediately codify it in Nix/docs
3) deploy pinned and treat the live fix as temporary

Default breakglass path:

- console login as `breakglass` (wheel user) then `sudo -i`
- `admin` is intentionally not wheel

## Deploy privilege model

- Default: `admin` cannot run `nixos-rebuild` (breakglass required).
- Optional: enable `clawdlets.operator.deploy` to allow `admin` to run constrained deploy entrypoints.

## Egress posture (honesty)

Default posture blocks outbound SMTP ports only (anti-spam). For real bot egress control, enable `clawdlets.egress.mode = "proxy-allowlist"`.
