# AGENT-BOOTSTRAP-SERVER

Goal: non-interactive day-0 bringup for an existing clawdlets fleet repo (Hetzner + Tailscale + Discord), using the existing `clawdlets` CLI.

Start point
- Repo already created from `@clawdlets/template`
- CWD is repo root (has `infra/configs/clawdlets.json`)

Canonical inputs
- Deploy creds (local-only): `.clawdlets/env`
  - `HCLOUD_TOKEN` required (Hetzner API)
  - `GITHUB_TOKEN` optional (private base flake)
  - `NIX_BIN`, `SOPS_AGE_KEY_FILE` optional
- Config (committed): `infra/configs/clawdlets.json`
- Runtime secrets (committed, encrypted): `secrets/**` (sops+age)
- Day0 input (local-only, plaintext): `.clawdlets/day0.json` (0600; never commit)

## Fast path

1) Generate local-only inputs (no secrets in git)
- `clawdlets env init`
- `node scripts/agent-bootstrap-server.mjs init`

2) STOP: user fills secrets, then confirms
- edit `.clawdlets/env` and set `HCLOUD_TOKEN=...`
- edit `.clawdlets/day0.json` and fill:
  - `fleet.guildId`
  - `secretsInit.adminPasswordHash` (YESCRYPT hash)
  - `secretsInit.tailscaleAuthKey` (if tailnet=tailscale)
  - `secretsInit.discordTokens.<bot>` for each bot
  - `secretsInit.secrets.<secretName>` for LLM API keys referenced by `fleet.envSecrets`
- ask user: reply `done` when finished editing (do not proceed before `done`)

3) Apply (idempotent)
- `node scripts/agent-bootstrap-server.mjs apply`

4) After bootstrap
- join tailnet, then set:
  - `clawdlets host set --target-host admin@<tailscale-ip>`
- then:
  - `clawdlets lockdown --host <host>`

## Notes
- `day0.json` contains plaintext secrets. Keep it out of git (lives under `.clawdlets/`).
- The script pipes JSON to `clawdlets secrets init --from-json - --yes` (no heredocs / no `yes | ...`).
