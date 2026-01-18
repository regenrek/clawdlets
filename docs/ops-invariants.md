# Ops invariants

Goal: zero drift. Project repo + `.clawdlets/` are the only sources of truth.

## Deploy-only

- Any persistent change must be done by editing the project repo (or `.clawdlets/`) and deploying.
- Prefer pinned deploys: `clawdlets server deploy --manifest deploy-manifest.<host>.json`.
- Assume the box is disposable. Reinstall beats debugging a snowflake.

## Cache-only

- Hosts never evaluate flakes from GitHub.
- Switching happens by `/nix/store/...` path + `nix copy` from trusted caches.

## No manual host edits

Do **not**:

- edit `/etc/nixos/*`
- run `passwd` / mutate users on-host (`users.mutableUsers = false`)
- copy secrets by hand into `/run/secrets/*` or `/nix/store`
- “quick fix” systemd units locally

Do:

- change config in the project repo (`fleet/clawdlets.json`, or `flake.nix` for advanced overrides) + deploy
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
- Recommended: enable `clawdlets.operator.deploy.enable` to allow `admin` to run constrained deploy entrypoints (`/etc/clawdlets/bin/switch-system` + `install-secrets`).

## Egress posture (honesty)

Default posture blocks outbound SMTP ports only (anti-spam). For real bot egress control, enable `clawdlets.egress.mode = "proxy-allowlist"`.
