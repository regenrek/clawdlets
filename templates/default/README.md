# __PROJECT_NAME__

This repo is your fleet config (public-safe).

- Config: `fleet/clawdlets.json`
- Secrets: `secrets/` (sops-encrypted; safe to commit)
- Runtime: `.clawdlets/` (gitignored; operator keys + nixos-anywhere extra-files)

Quickstart
1) install `clawdlets` (global)
2) set host basics: `clawdlets host set --admin-cidr <your-ip>/32 --disk-device /dev/sda --add-ssh-key-file $HOME/.ssh/id_ed25519.pub --enable true`
3) `clawdlets env init` (set `HCLOUD_TOKEN` in `.clawdlets/env`)
4) `clawdlets secrets init --host <host>` (fills `.clawdlets/secrets.json`)
5) `clawdlets secrets init --host <host> --from-json .clawdlets/secrets.json --yes`
6) `clawdlets doctor --scope bootstrap`
7) `clawdlets bootstrap`
8) join tailnet, then: `clawdlets host set --target-host admin@<tailscale-ip>` then `clawdlets server deploy --manifest deploy-manifest.<host>.json` and `clawdlets lockdown`

Docs: see the clawdlets repo `docs/README.md`

Updates
- `flake.lock` pins `clawdlets` and `nix-clawdbot`; use the repo’s `bump-clawdlets` and `bump-nix-clawdbot` PRs to stay current.

Safety
- `clawdlets project init` installs git hooks to block plaintext secrets.
- Rules live in `.forbidden-paths.regex`; sops checks run on `secrets/*.yaml`.
