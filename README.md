# Clawdlets

Clawdlets is an unofficial clawdbot server provisioner for made for hetzner.

## Official Templates
- Looking for official AWS Deploy? [clawdbot/clawdinators](https://github.com/clawdbot/clawdinators)
- Clawdbot [nix-clawdbot](https://github.com/clawdbot/nix-clawdbot)

> 🚨🚨
> **Use at your own risk!** This project is under active development and not production-ready. You absolutely need to know what you're doing before deploying this. Misconfiguration can expose credentials, open security holes, or cause data loss.
>

## Features

- **Discord bot fleet** – deploy multiple bots from one repo.
- **Options for Security** – Tailscale, lockdown, sops/age secrets.
- **Hetzner + NixOS** – immutable infra + reproducible deploys.
- **CLI-first** – bootstrap, deploy, ops, troubleshooting.
- **Atomic updates** – rollbacks via NixOS generations.


## Quickstart

Read [Quickstart Guide](docs/quickstart.md) to get started.

## Documentation

- Start here: `docs/README.md`
- [Overview](docs/overview.md) – Mental model + lifecycle.
- [CLI Cookbook](docs/cli.md) – Common commands and patterns.
- [Config Reference](docs/config.md) – `fleet/clawdlets.json` reference.
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
