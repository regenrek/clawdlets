# Clawdlets

Clawdlets is the hetzner infrastructure companion for [clawdbot](https://github.com/clawdbot/clawdbot) and [nix-clawdbot](https://github.com/clawdbot/nix-clawdbot). It provides the tooling to deploy and manage secure, reproducible bot fleets on Hetzner Cloud using NixOS. We simply handle the deployment plumbing for these core products.

🚧 Under construction: Don't use this as it is. Its currently WIP and only for advanced users.

Looking for official AWS Deploy? [clawdbot/clawdinators](https://github.com/clawdbot/clawdinators)

![Clawdlets Banner](public/clawdlets-banner.webp)

## Features

- **Discord bot fleet** – deploy multiple bots from one repo.
- **Secure by default** – WireGuard/Tailscale, lockdown, sops/age secrets.
- **Hetzner + NixOS** – immutable infra + reproducible deploys.
- **CLI-first** – bootstrap, deploy, ops, troubleshooting.
- **Atomic updates** – rollbacks via NixOS generations.

## Quickstart

Ready to ship? Check out the [Quickstart Guide](docs/quickstart.md) to get your fleet running in minutes.

## Ask an agent (copy/paste prompt)

```text
Goal: deploy a fresh Hetzner server with this repo (no leaked secrets).

Constraints:
- do not commit plaintext secrets; keep private operator keys in .clawdlets/ (gitignored) and commit encrypted secrets under /secrets
- do not run live actions unless I confirm (bootstrap/lockdown/opentofu apply)
- no shims/workarounds; fix root cause; single source of truth

What I want:
1) exact local commands (macOS) for: pnpm install, clawdlets project init, clawdlets host set, clawdlets secrets init, doctor
2) which commands are wizard/interactive (project init / secrets init) vs. non-interactive (config/fleet/host)
3) exact deploy steps: infra apply -> bootstrap -> connect via Tailscale -> lockdown
4) exact ops commands: server status/logs/restart; rebuild pinned by full git SHA
5) non-interactive agent-friendly commands:
   - host set: set admin cidr, ssh pubkey file, disk device without prompts
   - secrets init: use --from-json <path|-> (never pass secrets via argv flags)
6) if something fails: ask for the exact error output and propose the next command

Start by reading docs/README.md, then tell me the minimal command sequence for one host.
```

## Documentation

- Start here: `docs/README.md`
- [Overview](docs/overview.md) – Mental model + lifecycle.
- [CLI Cookbook](docs/cli.md) – Common commands and patterns.
- [Config Reference](docs/config.md) – `infra/configs/clawdlets.json` reference.
- [Installation Guide](docs/install.md) – Prerequisites and setup.
- [Deployment & Updates](docs/deploy.md) – How to ship changes.
- [Agent Configuration](docs/agent-config.md) – Routing, skills, and workspaces.
- [Secrets Management](docs/secrets.md) – Handling keys safely with sops/age.
- [Security Model](docs/security.md) – Threat model + boundaries.
- [Operations Manual](docs/operations.md) – Day-to-day maintenance.
- [Troubleshooting](docs/troubleshooting.md) – Common failures and fixes.
- [Going Public](docs/publicing.md) – Checklist for OSS-safe publishing.
- [Upstream & Tracking](docs/upstream.md) – Keeping your fork in sync.

## Powered By

Clawdlets is strictly an infrastructure wrapper. All credit for the AI assistant and Nix packaging goes to the core projects:

- [nix-clawdbot](https://github.com/clawdbot/nix-clawdbot) by [joshp123](https://github.com/joshp123)
- [clawdbot](https://github.com/clawdbot/clawdbot) by [steipete](https://x.com/steipete)

## License

MIT

## Find me

[@kevinkernx](https://x.com/kevinkern)
