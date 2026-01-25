# HEARTBEAT

Operator cadence (suggested):

1) `clawdlets doctor --scope repo`
2) `clawdlets doctor --scope server-deploy --strict` (before live ops)
3) For each host: `clawdlets server audit --target-host <host>`
3a) If `services.clawdbotFleet.githubSync.enable = true`: check `<workspace>/memory/github/{prs,issues}.md`
3b) If `services.clawdbotFleet.opsSnapshot.enable = true`: check `/var/lib/clawdlets/ops/snapshots/latest.json`
4) If degraded: capture logs (`clawdlets server logs ...`), then codify + rebuild pinned (`--rev <sha|HEAD>`)

Rule: if a fix can’t be expressed as repo + `.clawdlets/` change, treat it as breakglass and follow clawdlets repo `docs/ops-invariants.md`.
