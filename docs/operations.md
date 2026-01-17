# Operations

## Update routing / profiles

1) Update `fleet/clawdlets.json` via CLI (example: routing override):

```bash
clawdlets config set --path fleet.routingOverrides.maren --value-json '{"channels":["dev"],"requireMention":true}'
```
2) Deploy:

```bash
clawdlets server manifest --host <host> --out deploy-manifest.<host>.json
clawdlets server deploy --manifest deploy-manifest.<host>.json
```

`--rev HEAD` resolves to the full SHA locally before the deploy.

## Rotate tokens/secrets

1) Edit files under `secrets/hosts/clawdbot-fleet-host/` (example: `discord_token_maren.yaml`)
2) Re-encrypt (or use `clawdlets secrets init` to regenerate)
3) `clawdlets secrets sync`
4) `clawdlets secrets verify`
5) Deploy (pinned):

```bash
clawdlets server deploy --manifest deploy-manifest.<host>.json
```

## Add a bot

1) Add bot id:
```bash
clawdlets bot add --bot <id>
```

2) Add secret `secrets/hosts/<host>/discord_token_<id>.yaml` (use `clawdlets secrets init`), then:
```bash
clawdlets secrets sync
clawdlets server deploy --manifest deploy-manifest.<host>.json
```

## Add/enable a skill

1) If bundled: add id to `fleet/bundled-skills.json`
2) Allow per-bot (example):
```bash
clawdlets config set --path fleet.botOverrides.maren.skills.allowBundled --value-json '["github","brave-search"]'
```
3) If it needs secrets: add `secrets/hosts/<host>/<secret>.yaml` and reference in `fleet.botOverrides.<bot>.skills.entries."<skill>".*Secret/envSecrets`
4) Sync + deploy:
```bash
clawdlets secrets sync
clawdlets server deploy --manifest deploy-manifest.<host>.json
```

## Verify

```bash
clawdlets server status --target-host admin@<ipv4>
clawdlets server logs --target-host admin@<ipv4> --unit clawdbot-maren.service --follow
clawdlets server audit --target-host admin@<ipv4>
```

Justfile:
```bash
just server-units admin@<ipv4>
just server-logs admin@<ipv4> "--unit clawdbot-maren.service --follow"
```

## Health

```bash
clawdlets server logs --target-host admin@<ipv4> --since 15m
```

Justfile:
```bash
just server-health admin@<ipv4>
```

## Codex CLI (headless)

One-time device auth per bot:

```bash
sudo -u bot-maren env HOME=/srv/clawdbot/maren codex login --device-auth
sudo -u bot-gunnar env HOME=/srv/clawdbot/gunnar codex login --device-auth
```

## Orchestrator (`clf`)

Service health:

```bash
systemctl status clf-orchestrator.socket
systemctl status clf-orchestrator
journalctl -u clf-orchestrator --since 10m --no-pager
```

Bot/job inspection:

```bash
sudo -u bot-maren clf jobs list --json
sudo -u bot-maren clf jobs show --job-id <jobId> --json
```

## Tailscale

```bash
tailscale status
tailscale ip -4
```

## GitHub App token refresher (maren)

```bash
systemctl status clawdbot-gh-token-maren
systemctl status clawdbot-gh-token-maren.timer
```

## GitHub inventory sync (optional)

If enabled (`services.clawdbotFleet.githubSync.enable = true`), each bot writes:

- `/srv/clawdbot/<bot>/workspace/memory/github/prs.md`
- `/srv/clawdbot/<bot>/workspace/memory/github/issues.md`

Ops helpers:

```bash
clawdlets server github-sync status --target-host admin@<ipv4>
clawdlets server github-sync run --target-host admin@<ipv4> --bot maren
clawdlets server github-sync show --target-host admin@<ipv4> --bot maren --kind prs --lines 80
```

## Ops snapshots (optional)

If enabled (`services.clawdbotFleet.opsSnapshot.enable = true`), the host writes JSON snapshots to:

- `/var/lib/clawdlets/ops/snapshots/latest.json`
- `/var/lib/clawdlets/ops/snapshots/<timestamp>-<host>.json`

Retention:

- `services.clawdbotFleet.opsSnapshot.keepDays` (default: 30)
- `services.clawdbotFleet.opsSnapshot.keepLast` (default: 200)

Backup:

- When restic is enabled and `backups.restic.paths` is empty, ops snapshots are included automatically.

Run now:

```bash
sudo systemctl start clawdlets-ops-snapshot.service
```

## Backups (restic)

Enable via CLI:

```bash
clawdlets fleet set --restic-enable true --restic-repository "s3:s3.amazonaws.com/<bucket>/clawdbot"
```

Add secrets under `secrets/hosts/clawdbot-fleet-host/` (example: `restic_password.yaml`), sync, then deploy.

Restore (example, run as root on the host):

```bash
restic snapshots
restic restore latest --target / --include /srv/clawdbot
```
