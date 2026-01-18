# Orchestrator (`clf`)

Goal
- Bots request work via `clf jobs ...` without ever holding Hetzner creds or long-lived provider keys.

Split
- `clawdlets` = operator/admin CLI (bootstrap, deploy, lockdown, server ops).
- `clf` = bot-facing control plane (jobs queue today; more commands later).

## Components

- `packages/clf/queue`: SQLite queue + schemas (idempotency, leases, retry).
- `packages/clf/orchestrator`: daemon + worker loop + handlers.
- `packages/clf/cli`: `clf` CLI (bots call this).

## Transport + auth (default)

- Bot → orchestrator: Unix socket HTTP
  - socket: `/run/clf/orchestrator.sock`
  - auth: filesystem perms (systemd socket `0660`, group `clf-bots`)
- Cattle → orchestrator: tailnet-only HTTP (secrets env fetch)
  - endpoint: `GET /v1/cattle/env` (bearer token, one-time)
  - bind: tailnet (`tailscale0`) only (default `CLF_CATTLE_SECRETS_LISTEN_HOST=auto`)

No public ingress by default.

## Deployment (Pet host, NixOS)

Clawdlets framework provides:
- module: `nix/modules/clf-orchestrator.nix`

Enable in your host config (project repo):

```nix
services.clfOrchestrator.enable = true;
```

Required secrets (sops, per host)
- `hcloud_token` (Hetzner API)
- `tailscale_auth_key` (cattle tailnet join key; tag-scoped + ephemeral recommended)
- provider keys mapped via `fleet.envSecrets` (e.g. `ZAI_API_KEY`)

After deploy:

```bash
systemctl status clf-orchestrator.socket
systemctl status clf-orchestrator
ls -la /run/clf/orchestrator.sock
```

## CLI (bot-facing)

Enqueue a cattle spawn:

```bash
clf jobs enqueue cattle.spawn \
  --requester maren \
  --idempotency-key <discord-message-id> \
  --identity rex \
  --task-file ./task.json \
  --ttl 2h \
  --json
```

Inspect jobs:

```bash
clf jobs list --requester maren --json
clf jobs show --job-id <jobId> --json
clf jobs cancel --job-id <jobId> --json
```

Notes
- Bots use `clf`. Do not grant bots access to the `clawdlets` admin CLI.
- `withGithubToken` is operator-only today (via `clawdlets cattle spawn --with-github-token`).

## Runtime state

- DB: `/var/lib/clf/orchestrator/state.sqlite` (SQLite WAL; contains job payloads/results + token hashes)
- Logs: `journalctl -u clf-orchestrator --since 10m`

## Job kinds (v1)

- `cattle.spawn`: create Hetzner server from cattle image; inject identity + task; cattle fetches secrets env at runtime.
- `cattle.reap`: delete expired cattle servers (TTL label).

## Troubleshooting

- “connection refused” / “socket missing”
  - `systemctl status clf-orchestrator.socket`
  - verify caller is in `clf-bots` group
- `GET /v1/cattle/env` 401
  - token expired or already used (one-time + TTL)
  - cattle didn’t join tailnet (bad `tailscale_auth_key`)
