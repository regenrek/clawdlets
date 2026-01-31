# Deploy / Updates (cache-only)

Goal: keep the **repo public-safe** (no plaintext secrets) and keep local operator private keys in `.clawdlets/` (gitignored).

## Recommended: CI build + cache-only deploy

**Principle:** the host never evaluates a flake from GitHub. It only:

- downloads signed store paths from trusted caches (Garnix, optionally Attic)
- installs encrypted secrets to `/var/lib/clawdlets/secrets/hosts/<host>`
- switches to a prebuilt NixOS system closure by store path

### CI build + release manifest (v1)

Build the host system output (per host):

```bash
nix build .#packages.x86_64-linux.<host>-system
```

Garnix is the canonical builder for `packages.x86_64-linux.<host>-system` (derived from `nixosConfigurations.<host>.config.system.build.toplevel`).

Generate a signed desired-state release manifest:

```bash
clawdlets release manifest build --host <host> --channel prod --system x86_64-linux --release-id <n> --out deploy/<host>/prod/<n>.json
clawdlets release manifest sign --in deploy/<host>/prod/<n>.json
clawdlets release pointer write --release-id <n> --out deploy/<host>/prod/latest.json
clawdlets release manifest sign --in deploy/<host>/prod/latest.json
```

Manifest format (schemaVersion 1):

```json
{
  "schemaVersion": 1,
  "host": "<host>",
  "system": "x86_64-linux",
  "channel": "prod",
  "releaseId": 123,
  "issuedAt": "2026-01-01T00:00:00.000Z",
  "rev": "<40-hex-sha>",
  "toplevel": "/nix/store/<hash>-nixos-system-<host>-<version>",
  "secrets": {
    "digest": "<sha256>",
    "format": "sops-tar",
    "url": "secrets/<digest>.tgz"
  }
}
```

### GitOps (CI)

Recommended: use the built-in workflow shipped by the project template (in your project repo):

- `.github/workflows/updates-publish.yml` writes `deploy/<host>/<channel>/<releaseId>.json`, signs it, and publishes to GitHub Pages (including `latest.json` pointer).
- It also publishes an encrypted secrets bundle at `deploy/<host>/<channel>/secrets/<digest>.tgz` and pins it in the manifest (`secrets.url`).

Optional: add a push-deploy workflow that joins the tailnet and runs `clawdlets server deploy --manifest ...` (signature verified).

If you publish to GitHub Pages, enable it in your project repo:
- Settings → Pages → Source: Deploy from a branch
- Branch: `gh-pages` / root

Required for signed manifests:
- `MINISIGN_PRIVATE_KEY` (passwordless; generated with `minisign -G -n`)

If you add a push-deploy workflow:
- `TAILSCALE_AUTHKEY`
- `DEPLOY_SSH_KEY`

Optional: set GitHub environment protection rules for `prod` to require approvals.

Promote without rebuild (manual, approved):

- publish once to `staging`, then publish a new `prod` manifest pointing at the same `toplevel` (new `releaseId`).

### Deploy (switch by store path)

```bash
clawdlets server deploy --manifest deploy/<host>/prod/<releaseId>.json
```

Manifest deploy requires signature verification:
- provide `<manifest>.minisig`
- set a public key (`config/manifest.minisign.pub`, `hosts.<host>.selfUpdate.publicKeys`, or `--manifest-public-key`)

`server deploy` uploads secrets, ingests the manifest, and triggers the host-side updater apply unit.

### Self-update (pull-based)

Enable on a host to pull a manifest and switch by store path:

```nix
clawdlets.selfUpdate.enable = true;
clawdlets.selfUpdate.baseUrl = "https://<pages>/deploy/<host>/prod";
clawdlets.selfUpdate.channel = "prod";
clawdlets.selfUpdate.publicKeys = [ "<minisign-pubkey>" ];
```

Secrets behavior:

- `secrets.digest` is the sha256 of the published secrets bundle bytes (the bundle contains **sops-encrypted** `.yaml` files).
- If `secrets.url` is set and installed secrets don't match `secrets.digest`, the updater downloads the bundle, verifies sha256, installs it, then proceeds.
- `secrets.url` may be an absolute `https://...` URL or a relative path (resolved against `selfUpdate.baseUrl`).
- Secrets are never placed in the Nix store (downloaded to `/var/lib/clawdlets/updates/`, installed into `/var/lib/clawdlets/secrets/hosts/<host>`).

Signature workflow:

1) Generate keypair locally (passwordless for CI):

```bash
minisign -G -n -p minisign.pub -s minisign.key
```

2) Store `minisign.key` as `MINISIGN_PRIVATE_KEY` in GitHub Actions secrets.
3) Copy the public key value into `fleet/clawdlets.json` (`hosts.<host>.selfUpdate.publicKeys = [ "<...>" ]`).

Key management + rotation:

- **Where keys live**
  - CI signing key: GitHub Actions secret `MINISIGN_PRIVATE_KEY` (passwordless minisign secret key contents).
  - Host trust roots: `hosts.<host>.selfUpdate.publicKeys` (supports multiple keys for rotation windows).
- **Rotate (planned)**
  1) Generate a new minisign keypair.
  2) Add the new public key to `hosts.<host>.selfUpdate.publicKeys` **alongside** the old key.
  3) Deploy so hosts trust both keys.
  4) Switch CI to sign with the new key.
  5) After a safe window, remove the old public key from `hosts.<host>.selfUpdate.publicKeys` and deploy again.
- **Emergency revoke**
  - If a signing key is compromised, treat update trust as compromised. You must replace the trusted key on hosts (manual access / out-of-band channel may be required) and re-issue manifests signed by the new key.

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

If you have a Linux builder, `clawdlets release manifest build` can build the toplevel locally.
macOS builders are not supported for NixOS system builds.

### Private base repo + PAT (bootstrap/lockdown)

`bootstrap`/`lockdown` may still need `GITHUB_TOKEN` if your base flake is private.
Deploys do not require GitHub access on the host.
