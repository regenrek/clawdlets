# Golden Path (first-class)

Goal: one boring, cache-only workflow for bootstrap + updates.

## 0) Bootstrap once

```bash
clawdlets secrets init
clawdlets doctor --scope bootstrap
clawdlets bootstrap
```

Optional (image-based bootstrap):

```bash
clawdlets image build --host <host>
clawdlets image upload --host <host> --image-url https://<bucket>/<image>.raw --compression bz2
clawdlets host set --host <host> --hetzner-image <image_id_or_name>
clawdlets bootstrap --mode image
```

After tailnet is up:

```bash
clawdlets host set --target-host admin@<magicdns-or-100.x>
clawdlets host set --ssh-exposure tailnet
clawdlets server deploy --manifest deploy-manifest.<host>.json
clawdlets lockdown
```

## 1) Push changes

Edit config/secrets, commit, push to `main`.

CI (Garnix + GH Actions):
- builds `packages.x86_64-linux.<host>-system`
- computes `deploy-manifest.<host>.json` (rev + toplevel + secretsDigest)
- publishes manifests to GitHub Pages (optional but recommended)

## 2) GitOps deploy (push-based)

Enable `.github/workflows/deploy.yml` with:
- `TAILSCALE_AUTHKEY` (ephemeral/preauth key)
- `DEPLOY_SSH_KEY` (private key)

CI joins tailnet and runs:

```bash
node cli/dist/main.js server deploy --host <host> --manifest deploy-manifest.<host>.json --ssh-tty false
```

Promote to prod (manual approval):

- Run the `deploy` workflow with `environment=prod` and `rev=<40-hex>` to deploy a pinned manifest.

## 3) Optional self-update (pull-based)

Enable on the host:

```nix
clawdlets.selfUpdate.enable = true;
clawdlets.selfUpdate.manifestUrl = "https://<pages>/deploy/<host>/latest.json";
# optional signature verification
clawdlets.selfUpdate.publicKey = "<minisign-pubkey>";
clawdlets.selfUpdate.signatureUrl = "https://<pages>/deploy/<host>/latest.json.minisig";
```

The host fetches the manifest on a timer and switches by `/nix/store/...` (cache-only).
