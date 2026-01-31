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
clawdlets server deploy --manifest deploy/<host>/prod/<releaseId>.json
clawdlets lockdown
```

## 1) Push changes

Edit config/secrets, commit, push to `main`.

CI (Garnix + GH Actions):
- builds `packages.x86_64-linux.<host>-system`
- computes a signed desired-state release manifest (v1) per host+channel
- publishes manifests to GitHub Pages in the project repo (optional but recommended)
  - requires enabling GitHub Pages (Deploy from branch: `gh-pages` / root)
  - alternative: publish the manifest artifacts to any HTTPS static host

## 2) GitOps deploy (push-based)

Run deploy from your operator machine:

```bash
clawdlets server deploy --host <host> --manifest deploy/<host>/prod/<releaseId>.json --ssh-tty false
```

Optional: wire this into CI (join tailnet + run the same command).

Promote to prod (manual approval):

- Run workflow `updates: promote` (staging → prod) to publish a prod manifest pointing at an already-built toplevel (no rebuild).

## 3) Optional self-update (pull-based)

Enable on the host:

```nix
clawdlets.selfUpdate.enable = true;
clawdlets.selfUpdate.baseUrl = "https://<pages>/deploy/<host>/prod";
clawdlets.selfUpdate.channel = "prod";
clawdlets.selfUpdate.publicKeys = [ "<minisign-pubkey>" ];
```

The host fetches the manifest on a timer and switches by `/nix/store/...` (cache-only).
