# Runtime layout (invariants)

Canonical base:

- `/srv/clawdbot/<bot>/` (default; see `services.clawdbotFleet.stateDirBase`)

Per-bot:

- `/srv/clawdbot/<bot>/workspace/`: agent workspace (seeded once if `documentsDir`/`workspace.seedDir` set)
- `/srv/clawdbot/<bot>/credentials/`: generated runtime creds (e.g. GitHub App token env, git-credentials)
- `/srv/clawdbot/<bot>/.codex/`: Codex CLI OAuth state (if Codex is enabled and you run device auth)

Host-wide:

- `/var/lib/sops-nix/key.txt`: host age key (installed via `nixos-anywhere --extra-files`)
- `/var/lib/clawdlets/secrets/hosts/<host>/<secret>.yaml`: encrypted secrets (sops, out-of-store)
- `/run/secrets/**`: decrypted/rendered secrets (activation-time, tmpfs)
- `/etc/clawdlets/tools.md`: generated inventory of installed tools (read-only)

Invariant: bot processes should not write outside their `/srv/clawdbot/<bot>/` state dir (except Nix-managed paths like `/run/secrets/**`).
