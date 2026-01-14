# clawdlets-beta-test-2

This repo is your fleet config (public-safe).

- Config: `fleet/clawdlets.json`
- Secrets: `secrets/` (sops-encrypted; safe to commit)
- Runtime: `.clawdlets/` (gitignored; operator keys + nixos-anywhere extra-files)

Local hooks (recommended)
- install git hooks: `nix run nixpkgs#lefthook -- install -f`
- policy: `.forbidden-paths.regex` + `scripts/hooks/check-sops-encrypted-staged.mjs`

Quickstart
1) install `clawdlets` (global)
2) set host basics: `clawdlets host set --admin-cidr <your-ip>/32 --disk-device /dev/sda --add-ssh-key-file $HOME/.ssh/id_ed25519.pub --enable true`
3) `clawdlets secrets init`
4) `clawdlets doctor --scope deploy`
5) `clawdlets bootstrap`
6) join tailnet, then: `clawdlets host set --target-host admin@<tailscale-ip>` and `clawdlets lockdown`

Docs: `docs/README.md`
