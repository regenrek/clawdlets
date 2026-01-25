# TOOLS.md

Workspace-local operator notes (no secrets). This file is seeded by Nix on first boot.

## Skills (bundled) allowlist

Bundled skills are an attack surface. Keep an explicit allowlist per bot:

- `fleet/clawdlets.json` → `fleet.bots.<bot>.profile.skills.allowBundled = [ ... ];`
- Avoid `null` on servers (typically means “allow all bundled skills”).

## Tool inventory (generated)

The host writes a generated tool inventory to:

- `/etc/clawdlets/tools.md`

This workspace may also include an appended copy of that inventory below on first seed.
