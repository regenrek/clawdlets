# Troubleshooting

## `ssh-keygen` / “REMOTE HOST IDENTIFICATION HAS CHANGED”

After reinstall, host key changes.

```bash
ssh-keygen -R <ipv4>
ssh-keygen -R "[<ipv4>]:22" || true
```

`clawdlets bootstrap` also clears known_hosts entries.

## Provisioning troubleshooting

Run OpenTofu via nix directly (from your project repo, example plan):

```bash
nix run --impure nixpkgs#opentofu -- -chdir=.clawdlets/infra/opentofu/<host> plan
```

## GitHub flake fetch 404

If your base flake repo is private, set `GITHUB_TOKEN` in your environment (fine-grained PAT, Contents read).

## `journalctl --since 5m` parse error

Use `--since "5 min ago"` or `clawdlets server logs --since 5m` (CLI normalizes `5m`).

## `sudo: a terminal is required`

Use SSH TTY:

```bash
ssh -t <host> "sudo systemctl status clawdbot-melinda --no-pager"
```

CLI commands that may need sudo default to `--ssh-tty=true`.

## Gateway port already in use

Check listeners:

```bash
ssh -t <host> "sudo ss -ltnp | grep ':187' || true"
```

Restart the unit:

```bash
clawdlets server restart --target-host <host> --unit clawdbot-melinda.service
```

## CI deploy can’t reach host (tailnet)

- Verify `TAILSCALE_AUTHKEY` is valid and not expired.
- Ensure the host is in the tailnet and MagicDNS resolves.
- Confirm `fleet/clawdlets.json` has `targetHost` set (e.g. `admin@<magicdns-name>`).

## CI deploy: SSH auth failed

- Ensure the public key for `DEPLOY_SSH_KEY` is in `hosts.<host>.sshAuthorizedKeys`.
- If the host was reprovisioned, re-add the key and redeploy.

## Cache miss / toplevel not found

- Confirm the manifest’s `toplevel` exists in the cache (Garnix).
- Re-run the manifest workflow on `main` to republish.
- Ensure the host has `https://cache.garnix.io` in substituters.

## Self-update: minisign verification failed

- Confirm `clawdlets.selfUpdate.publicKey` matches the key used in CI.
- Ensure `.minisig` exists at `.../latest.json.minisig`.
- Re-run the manifest workflow to republish signatures.

## `clf` socket: permission denied / ENOENT

- Verify socket exists:
  - `ls -la /run/clf/orchestrator.sock`
  - `systemctl status clf-orchestrator.socket`
- Verify caller is allowed:
  - `id` includes group `clf-bots`
  - or run as root

## Cattle job stuck (queued/running)

- Orchestrator logs: `journalctl -u clf-orchestrator --since 30m --no-pager`
- Job inspect: `clf jobs show --job-id <jobId> --json`
- Common causes:
  - Hetzner API rate limits / quota
  - bad `cattle.hetzner.image`
  - cattle didn’t join tailnet (bad `tailscale_auth_key`)
