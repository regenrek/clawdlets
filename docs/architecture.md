# Clawdlets Architecture

This document describes the end-to-end lifecycle of a Clawdlets project, from initialization through ongoing maintenance.

## Repo layers + secret boundaries

- **clawdlets (CLI repo):** `clawdlets` + `clf` + docs (no project secrets).
- **clawdlets-template:** scaffold + workflows used by `project init`.
- **Project repo:** `flake.nix`, `fleet/`, `secrets/`, identities (public-safe).
- **Runtime (`.clawdlets/`):** gitignored state + keys + provisioning artifacts.

Rules of thumb:
- `fleet/clawdlets.json` and `fleet/workspaces/**` (documentsDir/includes) must not contain secrets.
- Secrets live only in `secrets/` (sops-encrypted) and `.clawdlets/` (runtime).

## Defaults worth knowing

- Template defaults `sshExposure.mode=bootstrap` (public SSH only for day-0).
- `cache.garnix.private.enable` defaults to `false` (opt-in).
- `provisioning.adminCidr` must be a CIDR; world-open requires `adminCidrAllowWorldOpen=true`.

## E2E Lifecycle Diagram

```
╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                           CLAWDLETS E2E LIFECYCLE DIAGRAM                                            ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝

┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: PROJECT INITIALIZATION (clawdlets project init)                                            │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│   Developer                                                                                          │
│      │                                                                                               │
│      │  clawdlets project init --dir ./my-fleet                                                      │
│      ▼                                                                                               │
│  ┌────────────────┐       ┌──────────────────────────┐       ┌─────────────────────────────┐         │
│  │  clawdlets     │──────▶│  clawdlets-template      │──────▶│  New Project Created        │         │
│  │  CLI           │ giget │  (templates/default/)    │       │                             │         │
│  └────────────────┘       └──────────────────────────┘       │  my-fleet/                  │         │
│                                                              │  ├── flake.nix              │         │
│   Inputs:                                                    │  ├── fleet/clawdlets.json   │         │
│   - template repo (regenrek/clawdlets-template)              │  ├── secrets/               │         │
│   - host name                                                │  ├── .clawdlets/            │         │
│                                                              │  ├── identities/            │         │
│                                                              │  └── .github/workflows/     │         │
│                                                              └─────────────────────────────┘         │
│                                                                                                      │
│   + Installs git hooks (block plaintext secrets, verify sops encryption)                             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                    │
                                                    │ Project scaffolded
                                                    ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: DAY0 BOOTSTRAP (First-Time Provisioning)                                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 1: ENVIRONMENT SETUP                                                                     │   │
│  │ ─────────────────────────                                                                     │   │
│  │   clawdlets env init  ──▶  .clawdlets/env (HCLOUD_TOKEN)                                      │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                              │                                                       │
│                                              ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 2: FLEET & HOST CONFIGURATION                                                            │   │
│  │ ─────────────────────────────────────                                                         │   │
│  │   clawdlets fleet set --guild-id <id>                                                         │   │
│  │   clawdlets bot add --bot <id>                              ┌─────────────────────────┐       │   │
│  │   clawdlets host add --host myhost           ──────────────▶│ fleet/clawdlets.json    │       │   │
│  │   clawdlets host set --host myhost \                        │ (canonical config)      │       │   │
│  │       --enable true --ssh-exposure bootstrap \              └─────────────────────────┘       │   │
│  │       --admin-cidr <ip>/32 --ssh-pubkey-file ~/.ssh/id.pub                                    │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                              │                                                       │
│                                              ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 3: SECRETS INITIALIZATION                                                                │   │
│  │ ─────────────────────────────────                                                             │   │
│  │   clawdlets secrets init --interactive                                                        │   │
│  │                   │                                                                           │   │
│  │                   ├──▶ secrets/.sops.yaml (encryption rules)                                  │   │
│  │                   ├──▶ secrets/hosts/<host>/age_key.yaml                                      │   │
│  │                   ├──▶ secrets/hosts/<host>/discord_token_*.yaml                              │   │
│  │                   ├──▶ secrets/hosts/<host>/tailscale_authkey.yaml                            │   │
│  │                   └──▶ .clawdlets/extra-files/<host>/ (injection payload)                     │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                              │                                                       │
│                                              ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 4: PRE-FLIGHT CHECK                                                                      │   │
│  │ ────────────────────────                                                                      │   │
│  │   clawdlets doctor --scope bootstrap --strict                                                 │   │
│  │                   │                                                                           │   │
│  │                   └──▶ Validates: secrets, config, Nix flake, SSH keys                        │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                              │                                                       │
│                                              ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 5: BOOTSTRAP (Provision + Install)                                                       │   │
│  │ ───────────────────────────────────────                                                       │   │
│  │   clawdlets bootstrap --host myhost                                                           │   │
│  │                   │                                                                           │   │
│  │                   ├──▶ OpenTofu Apply ──▶ Hetzner VM Created ──▶ Public IP                    │   │
│  │                   │                                                                           │   │
│  │                   └──▶ nixos-anywhere ──▶ NixOS Installed ──▶ Secrets Injected                │   │
│  │                                                        │                                      │   │
│  │                                                        ▼                                      │   │
│  │                                              ┌─────────────────────┐                          │   │
│  │                                              │  HETZNER CLOUD      │                          │   │
│  │                                              │  ┌───────────────┐  │                          │   │
│  │                                              │  │  NixOS VM     │  │                          │   │
│  │                                              │  │  + clawdbot   │  │                          │   │
│  │                                              │  │  + Tailscale  │  │                          │   │
│  │                                              │  └───────────────┘  │                          │   │
│  │                                              └─────────────────────┘                          │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                              │                                                       │
│                                              ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 6: LOCKDOWN (Secure to Tailnet)                                                          │   │
│  │ ───────────────────────────────────                                                           │   │
│  │   clawdlets host set --target-host admin@<tailscale-ip>                                       │   │
│  │   clawdlets host set --ssh-exposure tailnet                                                   │   │
│  │   clawdlets lockdown --host myhost                                                            │   │
│  │                   │                                                                           │   │
│  │                   └──▶ Closes public SSH, Tailnet-only access                                 │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│   OUTPUT: Running NixOS VM on Hetzner, reachable only via Tailnet                                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                    │
                                                    │ Server provisioned & secured
                                                    ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: DAY MAINTENANCE (Ongoing Operations)                                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              GITOPS CI/CD PIPELINE                                              │ │
│  │  ─────────────────────────────────────────────────────────────────────────────────────────────  │ │
│  │                                                                                                 │ │
│  │  Developer pushes to main                                                                       │ │
│  │         │                                                                                       │ │
│  │         ▼                                                                                       │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────────────────────┐   │ │
│  │  │ deploy-manifest.yml (GitHub Actions)                                                      │   │ │
│  │  │ ──────────────────────────────────────                                                    │   │ │
│  │  │   1. nix build .#hosts.<host>.toplevel  (Build NixOS system)                              │   │ │
│  │  │   2. clawdlets server manifest --host <host>  (Generate manifest)                         │   │ │
│  │  │   3. minisign -S  (Sign with MINISIGN_PRIVATE_KEY)                                        │   │ │
│  │  │   4. Upload to GitHub Pages:                                                              │   │ │
│  │  │        deploy/<host>/latest.json                                                          │   │ │
│  │  │        deploy/<host>/<rev>.json                                                           │   │ │
│  │  └────────────────────────────────────────────────────────────────────────────────────────┬─┘   │ │
│  │                                                                                           │     │ │
│  │                                                                                           ▼     │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────────────────────┐   │ │
│  │  │ deploy.yml (GitHub Actions)                                                               │   │ │
│  │  │ ───────────────────────────                                                               │   │ │
│  │  │   1. Join Tailnet (TAILSCALE_AUTHKEY)                                                     │   │ │
│  │  │   2. Download signed manifest from GitHub Pages                                           │   │ │
│  │  │   3. Verify signature (config/manifest.minisign.pub)                                      │   │ │
│  │  │   4. clawdlets server deploy --manifest ... ─────────────────▶ NixOS Host                 │   │ │
│  │  └──────────────────────────────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              SCHEDULED AUTO-UPDATES                                             │ │
│  │  ─────────────────────────────────────────────────────────────────────────────────────────────  │ │
│  │                                                                                                 │ │
│  │  ┌────────────────────────────────┐         ┌────────────────────────────────────────────────┐  │ │
│  │  │ bump-nix-clawdbot.yml          │         │                                                │  │ │
│  │  │ (Cron: every 6 hours)          │ ──────▶ │  Creates PR to update flake.lock               │  │ │
│  │  │                                │         │  (pulls latest nix-clawdbot)                   │  │ │
│  │  └────────────────────────────────┘         └────────────────────────────────────────────────┘  │ │
│  │                                                          │                                      │ │
│  │                                                          ▼                                      │ │
│  │                                              PR merged ──▶ triggers deploy-manifest.yml         │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              CATTLE (EPHEMERAL VMs)                                             │ │
│  │  ─────────────────────────────────────────────────────────────────────────────────────────────  │ │
│  │                                                                                                 │ │
│  │   ┌─────────────────────────────────────────────────────────────────────────────────────────┐   │ │
│  │   │ cattle-image.yml (Build once)                                                            │   │ │
│  │   │ ─────────────────────────────                                                            │   │ │
│  │   │   1. nix build .#cattle-x86_64-linux-hcloud-image                                        │   │ │
│  │   │   2. hcloud-upload-image (Upload to Hetzner)                                             │   │ │
│  │   │   3. Output: cattle-image.json (image ID)                                                │   │ │
│  │   └──────────────────────────────────────────────────────────────────────────────────────┬──┘   │ │
│  │                                                                                          │      │ │
│  │                                                                                          ▼      │ │
│  │   ┌─────────────────────────────────────────────────────────────────────────────────────────┐   │ │
│  │   │ Runtime Cattle Operations (via clf-orchestrator on host)                                 │   │ │
│  │   │ ─────────────────────────────────────────────────────────                                │   │ │
│  │   │                                                                                          │   │ │
│  │   │   clawdlets cattle spawn --identity rex --task-file ./task.json --ttl 2h                 │   │ │
│  │   │         │                                                                                │   │ │
│  │   │         ▼                                                                                │   │ │
│  │   │   ┌─────────────┐        ┌─────────────┐        ┌─────────────┐                          │   │ │
│  │   │   │ Orchestrator│──────▶ │ Hetzner API │──────▶ │ Cattle VM   │ (ephemeral NixOS)        │   │ │
│  │   │   │ (on host)   │        │ (spawn VM)  │        │ runs task   │                          │   │ │
│  │   │   └─────────────┘        └─────────────┘        └──────┬──────┘                          │   │ │
│  │   │                                                        │                                 │   │ │
│  │   │                                                        ▼                                 │   │ │
│  │   │   clawdlets cattle list           (list active VMs)                                      │   │ │
│  │   │   clawdlets cattle logs <id>      (stream logs)                                          │   │ │
│  │   │   clawdlets cattle reap           (cleanup expired VMs)  ◀─── TTL reached               │   │ │
│  │   └─────────────────────────────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              OPERATOR TASKS                                                     │ │
│  │  ─────────────────────────────────────────────────────────────────────────────────────────────  │ │
│  │                                                                                                 │ │
│  │  ┌──────────────────────────────┐      ┌──────────────────────────────┐                         │ │
│  │  │ Health Checks                │      │ Secrets Management           │                         │ │
│  │  │ ─────────────                │      │ ──────────────────           │                         │ │
│  │  │ clawdlets doctor --scope repo│      │ sops edit secrets/...yaml    │                         │ │
│  │  │ clawdlets doctor --scope     │      │ clawdlets secrets sync       │                         │ │
│  │  │   server-deploy --strict     │      │ clawdlets server deploy      │                         │ │
│  │  │ clawdlets server audit       │      └──────────────────────────────┘                         │ │
│  │  │ clawdlets server logs --unit │                                                               │ │
│  │  │   clawdbot-*.service --follow│      ┌──────────────────────────────┐                         │ │
│  │  └──────────────────────────────┘      │ Add Bots/Features            │                         │ │
│  │                                        │ ─────────────────            │                         │ │
│  │                                        │ clawdlets bot add --bot <id> │                         │ │
│  │                                        │ clawdlets secrets init       │                         │ │
│  │                                        │ clawdlets server deploy      │                         │ │
│  │                                        └──────────────────────────────┘                         │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Component Relationships

```
╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                                   COMPONENT RELATIONSHIPS                                            ║
╠══════════════════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                                      ║
║    ┌────────────────────┐              ┌─────────────────────┐              ┌──────────────────────┐ ║
║    │  clawdlets CLI     │              │  clawdlets-template │              │  User Project        │ ║
║    │  (packages/cli/)   │─────────────▶│  (templates/default)│─────────────▶│  (my-fleet/)         │ ║
║    │                    │   init       │                     │   scaffold   │                      │ ║
║    └────────────────────┘              └─────────────────────┘              └──────────────────────┘ ║
║             │                                                                         │              ║
║             │ bootstrap/deploy                                                        │ push         ║
║             ▼                                                                         ▼              ║
║    ┌────────────────────┐              ┌─────────────────────┐              ┌──────────────────────┐ ║
║    │  Hetzner Cloud     │◀─────────────│  GitHub Actions     │◀─────────────│  GitHub Repo         │ ║
║    │  (VMs)             │   deploy     │  (CI/CD)            │   trigger    │  (GitOps)            │ ║
║    └────────────────────┘              └─────────────────────┘              └──────────────────────┘ ║
║             ▲                                    │                                                   ║
║             │                                    │ publish                                           ║
║             │ nix copy                           ▼                                                   ║
║    ┌────────────────────┐              ┌─────────────────────┐                                       ║
║    │  Garnix Cache      │◀─────────────│  GitHub Pages       │                                       ║
║    │  (nix store)       │   build      │  (manifests)        │                                       ║
║    └────────────────────┘              └─────────────────────┘                                       ║
║                                                                                                      ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝
```

## Key Files Reference

| Category | File | Purpose |
|----------|------|---------|
| **Configuration** | `fleet/clawdlets.json` | Central fleet configuration (hosts, bots, secrets mapping) |
| | `flake.nix` / `flake.lock` | NixOS configurations for hosts and cattle images |
| | `.clawdlets/env` | Local deploy credentials (gitignored) |
| | `identities/registry.json` | Cattle identity registry |
| **Secrets** | `secrets/.sops.yaml` | SOPS encryption rules |
| | `secrets/hosts/<host>/*.yaml` | Encrypted secrets per host |
| | `.clawdlets/extra-files/` | nixos-anywhere injection payload |
| **Workflows** | `deploy-manifest.yml` | Builds and signs deploy manifests |
| | `deploy.yml` | Deploys manifests to hosts via Tailnet |
| | `bump-nix-clawdbot.yml` | Auto-updates nix-clawdbot dependency |
| | `cattle-image.yml` | Builds and uploads cattle VM image |
| **Manifests** | `deploy-manifest.<host>.json` | Pinned deployment manifest |
| | `deploy/<host>/latest.json` | Latest manifest on GitHub Pages |
| | `cattle-image.json` | Cattle image ID artifact |
| **Playbooks** | `AGENT-BOOTSTRAP-SERVER.md` | Interactive day0 bootstrap guide |
| | `AGENT-BOOTSTRAP-SERVER-AUTO.md` | Non-interactive day0 bootstrap |
| | `AGENT-CATTLE-SPAWN.md` | Ephemeral cattle VM spawning guide |
| | `HEARTBEAT.md` | Operator health check cadence |

## Phase Summary

| Phase | Purpose | Key Commands | Output |
|-------|---------|--------------|--------|
| **1. Init** | Scaffold project from template | `clawdlets project init` | Project repo with flake, config, secrets structure |
| **2. Day0** | First-time provisioning | `env init` → `host set` → `secrets init` → `bootstrap` → `lockdown` | Running NixOS VM on Hetzner, secured via Tailnet |
| **3. Day** | Ongoing operations | GitOps (push → build → deploy), cattle spawn/reap, secrets rotation | Continuous deployment, ephemeral task VMs |

## Flow Summary

The lifecycle follows this pattern:

```
Template → Init → Day0 Bootstrap → Lockdown → GitOps CI/CD loop
                                                    ↓
                                            Cattle VMs (on demand)
```

1. **Template** (`clawdlets-template`) provides the project scaffold
2. **Init** creates a new project with all necessary files and git hooks
3. **Day0 Bootstrap** provisions infrastructure on Hetzner and installs NixOS
4. **Lockdown** secures the server to Tailnet-only access
5. **GitOps CI/CD** handles continuous deployment on push to main
6. **Cattle VMs** spawn ephemeral task runners as needed
