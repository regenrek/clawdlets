# Clawdlets docs

Clawdlets = Hetzner + NixOS fleet tooling for Clawdbot.

Repo model
- **CLI repo** (this repo): `clawdlets` + `clf` + docs.
- **Project repo** (from `clawdlets project init`): `flake.nix` + `fleet/` + `secrets/` + identities.

Start here
- `docs/overview.md`: mental model (pet vs cattle, where things live).
- `docs/quickstart.md`: first deploy from zero.
- `docs/runbook.md`: day-0/day-2 checklist.

Operator vs bot
- Operator/admin: `clawdlets` (bootstrap/deploy/lockdown/server ops).
- Bot-facing control plane: `clf` (`clf jobs ...`).

Where to run what
- Workstation: `clawdlets` (project init, bootstrap, deploy).
- Pet host: `clf` + `clf-orchestrator`, and `clawdlets cattle *` (talks to local Unix socket).

Key split
- `clawdlets` = operator/admin CLI (bootstrap, deploy, lockdown, infra).
- `clf` = bot-facing control plane (jobs queue; cattle spawn/reap handlers).

Threat model (cattle)
- Assume Hetzner **cloud-init user_data is readable** by anyone with Hetzner project/API access.
  - Cattle user_data contains `TAILSCALE_AUTH_KEY` + one-time bootstrap token (short-lived).
  - Use tag-scoped + ephemeral Tailscale auth keys, rotate regularly.

Next reads
- `docs/cattle.md`: ephemeral VM lifecycle + commands
- `docs/orchestrator.md`: `clf` queue + deployment + job contract
