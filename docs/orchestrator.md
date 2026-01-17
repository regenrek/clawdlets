# Orchestrator (`clf`)

Goal
- Bots enqueue work → orchestrator spawns cattle → job status/results queryable.

Separation of concerns
- `clawdlets` = operator/admin CLI (bootstrap, deploy, lockdown, server ops).
- `clf` = bot-facing control plane (queue/jobs today; more commands later).

Transport/auth
- Default: Unix socket on the Pet host: `/run/clf/orchestrator.sock`
- Access control: OS perms via group `clf-bots` (bot users are members).
- No public HTTP ingress by default.

CLI
```bash
clf jobs enqueue cattle.spawn --requester maren --identity rex --task-id issue-42 --message "fix it" --ttl 2h --json
clf jobs list --requester maren --json
clf jobs show <jobId> --json
clf jobs cancel <jobId>
```

Runtime
- DB: `/var/lib/clf/orchestrator/state.sqlite` (SQLite WAL)
- Workers: claim jobs, execute handlers, write results back to DB

Job kinds (v1)
- `cattle.spawn`: create Hetzner VM from cattle image, inject task/identity via cloud-init
- `cattle.reap`: delete expired cattle servers (TTL labels)

