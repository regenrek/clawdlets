# Queue (clf jobs)

Goal: bots request work (“spawn a cattle VM and run task X”) without ever holding Hetzner credentials or long-lived provider secrets.

## Components

- `packages/clf/queue`: SQLite queue semantics (enqueue/claim/ack/fail/cancel).
- `packages/clf/orchestrator`: daemon + worker loops + handlers (`cattle.spawn`, `cattle.reap`).
- `packages/clf/cli`: `clf` binary used by bots (`clf jobs ...`).

## Storage + semantics

- Store: SQLite WAL (single file).
- Statuses: `queued` → `running` → `done|failed|canceled`.
- Claims: lease-based (`lease_until`); expired leases are reclaimable.
- Retries: exponential backoff until `maxAttempts`, then terminal `failed`.
- Idempotency: uniqueness on `(requester, idempotencyKey)` for “same intent”.

## Security boundary

- `clf-orchestrator` owns:
  - `HCLOUD_TOKEN` (Hetzner API) and fleet env secrets (LLM keys, optional `GITHUB_TOKEN`).
- Bots talk only to:
  - Unix socket `/run/clf/orchestrator.sock` (OS perms via group `clf-bots`).
- Cattle VMs fetch secrets at runtime:
  - one-time bootstrap token (stored hashed in SQLite)
  - tailnet-only HTTP endpoint `/v1/cattle/env` on the Pet host

See `docs/orchestrator.md` and `docs/security.md`.

