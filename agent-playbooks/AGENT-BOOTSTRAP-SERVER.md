# AGENT-BOOTSTRAP-SERVER

Goal: non-interactive day-0 bringup for a clawdlets fleet repo (Hetzner + Tailscale + Discord), using the `clawdlets` CLI.

Start point
- Repo already created from `@clawdlets/template`
- CWD is repo root (has `fleet/clawdlets.json`)

Canonical inputs
- Config (committed): `fleet/clawdlets.json`
- Runtime secrets (committed, encrypted): `secrets/**` (sops+age)
- Deploy creds (local-only): `.clawdlets/env`
  - `HCLOUD_TOKEN` required (Hetzner API)
  - `GITHUB_TOKEN` optional (private base flake)
  - `NIX_BIN`, `SOPS_AGE_KEY_FILE` optional
- Non-interactive secrets input (local-only, plaintext): `.clawdlets/secrets.json` (0600; never commit)

## Fast path

1) Config + host
- edit `fleet/clawdlets.json`:
  - `fleet.guildId`
  - `fleet.bots`
  - `fleet.envSecrets`
  - `hosts.<host>` (diskDevice, serverType, adminCidr, sshPubkeyFile, etc.)
  - `hosts.<host>.sshExposure.mode = "bootstrap"`

2) Deploy creds
- `clawdlets env init`
- edit `.clawdlets/env` and set `HCLOUD_TOKEN=...`

3) Secrets (non-interactive)
- `clawdlets secrets init --host <host>`
- edit `.clawdlets/secrets.json`:
  - `adminPasswordHash` (YESCRYPT hash)
  - `tailscaleAuthKey` (if tailnet=tailscale)
  - `discordTokens.<bot>` for each bot
  - `secrets.<secretName>` for LLM API keys referenced by `fleet.envSecrets`
- `clawdlets secrets init --host <host> --from-json .clawdlets/secrets.json --yes`

4) Apply
- `clawdlets doctor --host <host> --scope bootstrap`
- `clawdlets bootstrap --host <host>`

5) After bootstrap
- join tailnet, then set:
  - `clawdlets host set --host <host> --target-host admin@<tailscale-ip>`
- then:
  - `clawdlets host set --host <host> --ssh-exposure tailnet`
  - `clawdlets server deploy --host <host> --manifest deploy-manifest.<host>.json`
  - `clawdlets lockdown --host <host>`

## Notes
- `.clawdlets/secrets.json` is plaintext. Keep it out of git.
