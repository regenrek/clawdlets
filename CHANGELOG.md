# Changelog
All notable changes to this repository will be documented in this file.

The format is based on Keep a Changelog and this project follows SemVer for npm releases.

## Unreleased

### Added
- Base flake resolution: `infra/configs/clawdlets.json.baseFlake` (fallback: `git remote origin`) used by deploy commands (`bootstrap`, `lockdown`, `server rebuild`).
- Non-interactive secrets provisioning: `clawdlets secrets init --from-json <path|->`.
- New docs: `docs/config.md` (canonical config + host knobs).

### Changed
- Workflow automation: `nix-clawdbot` bump PRs are created using a GitHub App token (so normal PR checks run) and are compatible with strict branch protection.
- Repo layout: runtime state is `.clawdlets/` (gitignored); repo-canonical secrets are sops-encrypted in `secrets/`.
- Config schema bump: `infra/configs/clawdlets.json` schemaVersion `3` (host deploy knobs moved into canonical config).
- CLI flag rename: `--stack-dir` → `--runtime-dir`.

### Removed
- Stack concept + `clawdlets stack` command.
- `clawdlets secrets migrate` and stack docs.

## [0.1.0] - 2026-01-11
### Added
- Canonical config: `infra/configs/clawdlets.json` (single source of truth) + CLI subcommands (`config`, `host`, `fleet`).
- CLI-first project scaffolding (`clawdlets project init`) using the embedded template package.
- Supply-chain hardening: Dependabot (npm + GitHub Actions), pinned GitHub Actions by SHA, TruffleHog secret scanning workflow.
- Local security gate: `scripts/secleak-check.sh` (gitleaks + trivy).
- npm publishing via GitHub Actions Trusted Publishing (OIDC) + release automation docs/scripts.

### Changed
- Nix flake now derives `nixosConfigurations` from `infra/configs/clawdlets.json` hosts list (multi-host ready).
- Default UX: non-interactive unless `--interactive` / `CLAWDLETS_INTERACTIVE=1`.
- Docs updated to be CLI-first (no manual Nix edits; `fleet.nix` treated as derived output).

### Removed
- Legacy Nix template generation from the codebase (no more “render/ensure templates” path).
- Legacy `@clawdbot/clawdlets-core` setup export + tests (unused).

## [0.0.0] - 2026-01-10
### Added
- ai-stack alignment: seeded `infra/documents/` (AGENTS/SOUL/TOOLS/IDENTITY) and documented usage.
- Codex CLI support on server with per-bot headless login docs (gunnar + maren).
- Upstream tracking doc for `nix-clawdbot` updates.

### Changed
- Fleet config refactor to base/override pattern.
- Fleet module options extended with `documentsDir`, `identity`, and `codex` controls.
- Documentation updated for monorepo paths and operational guidance.
- Tests expanded for doctor/setup; coverage now above 80% across core package metrics.
