# Deploy / Updates (cache-only)

Goal: keep the **repo public-safe** (no plaintext secrets) and keep local operator private keys in `.clawdlets/` (gitignored).

## Recommended: CI build + cache-only deploy

**Principle:** the host never evaluates a flake from GitHub. It only:

- downloads signed store paths from trusted caches (Garnix, optionally Attic)
- installs encrypted secrets to `/var/lib/clawdlets/secrets/hosts/<host>`
- switches to a prebuilt NixOS system closure by store path

### CI build

Build the host toplevel (per host):

```bash
nix build .#nixosConfigurations.<host>.config.system.build.toplevel
```

Record a deploy manifest (example):

```json
{
  "rev": "<40-hex-sha>",
  "host": "clawdbot-fleet-host",
  "toplevel": "/nix/store/<hash>-nixos-system-<host>-<version>",
  "secretsDigest": "<sha256>"
}
```

### Deploy (switch by store path)

```bash
clawdlets server deploy --target-host admin@<tailscale-ip> \
  --toplevel /nix/store/<hash>-nixos-system-<host>-<version> \
  --rev <sha>
```

Or, if you have a manifest:

```bash
clawdlets server deploy --target-host admin@<tailscale-ip> --manifest ./deploy.json
```

`server deploy` always installs secrets and then switches the system profile.

### Secrets only (optional)

If you want to update secrets without switching:

```bash
clawdlets secrets sync --rev <sha|HEAD>
```

## Cache configuration (host)

Public cache only (default): just add substituters + trusted keys.

Private Garnix cache:

- enable `clawdlets.cache.garnix.private.enable = true`
- provide `/etc/nix/netrc` via sops secret (`clawdlets.cache.garnix.private.netrcSecret`)
- keep `narinfo-cache-positive-ttl` at 3600 (required for presigned URLs)

See `infra/nix/modules/clawdlets-host-baseline.nix` for the module options.

## Other options (tradeoffs)

### Local build (workstation)

If you have a Linux builder, `clawdlets server deploy` can build the toplevel locally
when `--toplevel` is omitted. macOS builders are not supported for NixOS system builds.

### Private base repo + PAT (bootstrap/lockdown)

`bootstrap`/`lockdown` may still need `GITHUB_TOKEN` if your base flake is private.
Deploys do not require GitHub access on the host.
