# Per-bot workspace overrides

Create `fleet/workspaces/bots/<bot>/` to override files from `fleet/workspaces/common/` for that bot.

Used in two phases:

1) Seed (workspace empty only)
- copies `common/.` then `bots/<bot>/.` into the workspace
- includes any extra files you add (notes, runbooks, etc)

2) Managed sync (every bot start)
- overwrites only this allowlist (bot override wins over common):
  - `AGENTS.md`
  - `SOUL.md`
  - `IDENTITY.md`
  - `TOOLS.md`
  - `USER.md`
  - `HEARTBEAT.md`

- also syncs `skills/` (custom/local skills) into the workspace:
  - `skills/<skill>/SKILL.md`

Example override dir (not used unless you actually have a bot named `_example`):
- `fleet/workspaces/bots/_example/`
