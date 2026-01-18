# Deploy / Updates (cache-only)

Goal: keep the **repo public-safe** (no plaintext secrets) and keep local operator private keys in `.clawdlets/` (gitignored).

## Recommended: CI build + cache-only deploy

**Principle:** the host never evaluates a flake from GitHub. It only:

- downloads signed store paths from trusted caches (Garnix, optionally Attic)
- installs encrypted secrets to `/var/lib/clawdlets/secrets/hosts/<host>`
- switches to a prebuilt NixOS system closure by store path

### CI build + manifest

Build the host system output (per host):

```bash
nix build .#packages.x86_64-linux.<host>-system
```

Garnix is the canonical builder for `packages.x86_64-linux.<host>-system` (derived from `nixosConfigurations.<host>.config.system.build.toplevel`).

Generate a deploy manifest:

```bash
clawdlets server manifest --host <host> --out deploy-manifest.<host>.json
```

Manifest format:

```json
{
  "rev": "<40-hex-sha>",
  "host": "clawdbot-fleet-host",
  "toplevel": "/nix/store/<hash>-nixos-system-<host>-<version>",
  "secretsDigest": "<sha256>"
}
```

### GitOps (CI)

Recommended: use the built-in workflows shipped by the project template (in your project repo):

- `.github/workflows/deploy-manifest.yml` builds all host systems, writes `deploy-manifest.<host>.json`, signs them, and publishes them (GitHub Pages).
- `.github/workflows/deploy.yml` joins the tailnet and runs `clawdlets server deploy --manifest ...` for each host (signature verified).

If you publish to GitHub Pages, enable it in your project repo:
- Settings → Pages → Source: GitHub Actions

Required secrets:
- `TAILSCALE_AUTHKEY`
- `DEPLOY_SSH_KEY`

Required for signed manifests:
- `MINISIGN_PRIVATE_KEY` (passwordless; generated with `minisign -G -n`)

Optional: set GitHub environment protection rules for `prod` to require approvals.

Promote a pinned SHA (manual, approved):

1) Find the 40-hex rev (manifest workflow writes `deploy/<host>/<rev>.json`).
2) Run `deploy` workflow with inputs:
   - `environment=prod`
   - `rev=<40-hex>`

### Deploy (switch by store path)

```bash
clawdlets server deploy --manifest deploy-manifest.<host>.json
```

Manifest deploy requires signature verification:
- provide `<manifest>.minisig`
- set a public key (`config/manifest.minisign.pub`, `hosts.<host>.selfUpdate.publicKey`, or `--manifest-public-key`)

`server deploy` always installs secrets and then switches the system profile.

### Self-update (pull-based)

Enable on a host to pull a manifest and switch by store path:

```nix
clawdlets.selfUpdate.enable = true;
clawdlets.selfUpdate.manifestUrl = "https://<pages>/deploy/<host>/latest.json";
```

If you publish signatures, add:

```nix
clawdlets.selfUpdate.publicKey = "<minisign-pubkey>";
clawdlets.selfUpdate.signatureUrl = "https://<pages>/deploy/<host>/latest.json.minisig";
```

Signature workflow:

1) Generate keypair locally (passwordless for CI):

```bash
minisign -G -n -p minisign.pub -s minisign.key
```

2) Store `minisign.key` as `MINISIGN_PRIVATE_KEY` in GitHub Actions secrets.
3) Copy the public key value into `fleet/clawdlets.json` (`hosts.<host>.selfUpdate.publicKey`).

### Secrets only (optional)

If you want to update secrets without switching:

```bash
clawdlets secrets sync --rev <sha|HEAD>
```

## Cache configuration (host)

Public cache only (default): just add substituters + trusted keys.

Private Garnix cache:

- set `hosts.<host>.cache.garnix.private.enable = true` in `fleet/clawdlets.json`
- provide `/etc/nix/netrc` via sops secret (`hosts.<host>.cache.garnix.private.netrcSecret`)
- keep `narinfo-cache-positive-ttl` at 3600 (required for presigned URLs)
- ensure the Garnix project/cache is set to private in Garnix

See `nix/modules/clawdlets-host-baseline.nix` (in this repo) for the module options.

## Other options (tradeoffs)

### Local build (workstation)

If you have a Linux builder, `clawdlets server manifest` can build the toplevel locally.
macOS builders are not supported for NixOS system builds.

### Private base repo + PAT (bootstrap/lockdown)

`bootstrap`/`lockdown` may still need `GITHUB_TOKEN` if your base flake is private.
Deploys do not require GitHub access on the host.
