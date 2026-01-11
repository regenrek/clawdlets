# Security model

## Goals

- No tokens/keys committed to git.
- No secrets copied into `/nix/store`.
- SSH stays key-only; passwords for `sudo`/console only.
- Public SSH is temporary (bootstrap only).

## Boundaries

**Public-safe repo**
- Nix module + Terraform + docs + CLI
- No instance identifiers required

**Local stack dir (gitignored)**
- `.clawdlets/stack.json`: instance config
- `.clawdlets/.env`: provisioning tokens (Hetzner, optional GitHub)
- `.clawdlets/secrets/**`: sops/age keys + encrypted secrets

**On-server**
- `/var/lib/sops-nix/key.txt`: host age key
- `/var/lib/clawdlets/secrets/hosts/<host>/`: encrypted secrets files (sops)
- `/run/secrets/**`: decrypted materialized secrets at runtime (owned by service users)

## “Secrets out of store”

The Nix store is not a secrets vault. Design assumes store paths are widely readable on the host.

Therefore:
- secrets are read from `/var/lib/clawdlets/secrets/hosts/<host>/<secret>.yaml`
- `clawdlets secrets init` prepares those files for first install via `nixos-anywhere --extra-files`

## Recommended hardening checks

- Confirm Hetzner firewall no longer allows TCP/22 from the internet after lockdown.
- Confirm NixOS firewall only allows SSH via `tailscale0`/`wg0` when `bootstrapSsh=false`.
- Keep `.clawdlets/` gitignored (required).

## Supply chain (CI)

- GitHub Actions are pinned to commit SHAs (avoid tag drift).
- Dependabot opens weekly PRs for npm + GitHub Actions updates (`.github/dependabot.yml`).
- Updates are review-first (no auto-merge by default).
