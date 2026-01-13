# __PROJECT_NAME__

This repo is your fleet config (public-safe).

- Config: `infra/configs/clawdlets.json`
- Secrets: `secrets/` (sops-encrypted; safe to commit)
- Runtime: `.clawdlets/` (gitignored; operator keys + nixos-anywhere extra-files)

Quickstart
1) install `clawdlets` (global)
0) (optional, non-interactive) use the day0 helper:
   - `node scripts/agent-bootstrap-server.mjs init`
   - edit `.clawdlets/day0.json`
   - `node scripts/agent-bootstrap-server.mjs apply`
2) set host basics: `clawdlets host set --admin-cidr <your-ip>/32 --disk-device /dev/sda --add-ssh-key-file $HOME/.ssh/id_ed25519.pub --enable true`
3) `clawdlets env init` (set `HCLOUD_TOKEN` in `.clawdlets/env`)
4) `clawdlets secrets init`
5) `clawdlets doctor --scope deploy`
6) `clawdlets bootstrap`
7) join tailnet, then: `clawdlets host set --target-host admin@<tailscale-ip>` and `clawdlets lockdown`

Docs: `docs/README.md`
