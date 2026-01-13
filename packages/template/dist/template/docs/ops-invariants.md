# Ops invariants

Goal: zero drift. Repo + `.clawdlets/` are the only sources of truth.

## Rebuild-only

- Any persistent change must be done by editing this repo (or `.clawdlets/`) and rebuilding.
- Prefer pinned rebuilds: `clawdlets server rebuild --rev <sha|HEAD>`.
- Assume the box is disposable. Reinstall beats debugging a snowflake.

## No manual host edits

Do **not**:

- edit `/etc/nixos/*`
- run `passwd` / mutate users on-host (`users.mutableUsers = false`)
- copy secrets by hand into `/run/secrets/*` or `/nix/store`
- “quick fix” systemd units locally

Do:

- change config in `infra/` + rebuild
- rotate secrets by editing `secrets/hosts/<host>/<secret>.yaml` (sops) then `clawdlets secrets sync` + rebuild
- use `clawdlets server status|logs|restart|rebuild` for day-2 ops
- run `clawdlets server audit --target-host <host>` after bootstrap/lockdown and after major changes

## Breakglass (explicit)

If you *must* do a live fix:

1) do the minimum to restore service
2) immediately codify it in Nix/docs
3) rebuild pinned and treat the live fix as temporary

Default breakglass path:

- console login as `breakglass` (wheel user) then `sudo -i`
- `admin` is intentionally not wheel

## Rebuild privilege model

- Default: `admin` cannot run `nixos-rebuild` (breakglass required).
- Optional: enable `clawdlets.operator.rebuild` to allow `admin` to run a constrained pinned rebuild command.

Example (in your base flake host module):

```nix
{
  clawdlets.operator.rebuild = {
    enable = true;
    flakeBase = "github:OWNER/REPO"; # must be public
  };
}
```

## Egress posture (honesty)

Default posture blocks outbound SMTP ports only (anti-spam). For real bot egress control, enable `clawdlets.egress.mode = "proxy-allowlist"`.
