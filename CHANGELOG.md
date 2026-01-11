# Changelog
All notable changes to this repository will be documented in this file.

The format is based on Keep a Changelog and this project follows no public versioning scheme yet.

## Unreleased

### Added
- Canonical config: `infra/configs/clawdlets.json` (single source of truth) + CLI subcommands (`config`, `host`, `fleet`).
- CLI-first project scaffolding (`clawdlets project init`) using the embedded template package.
- Supply-chain hardening: Dependabot (npm + GitHub Actions), pinned GitHub Actions by SHA, TruffleHog secret scanning workflow.
- Local security gate: `scripts/secleak-check.sh` (gitleaks + trivy).

### Changed
- Nix flake now derives `nixosConfigurations` from `infra/configs/clawdlets.json` hosts list (multi-host ready).
- Default UX: non-interactive unless `--interactive` / `CLAWDLETS_INTERACTIVE=1`.
- Docs updated to be CLI-first (no manual Nix edits; `fleet.nix` treated as derived output).

### Removed
- Legacy Nix template generation from the codebase (no more “render/ensure templates” path).
- Legacy `@clawdbot/clawdlets-core` setup export + tests (unused).

## 2026-01-10
### Added
- ai-stack alignment: seeded `infra/documents/` (AGENTS/SOUL/TOOLS/IDENTITY) and documented usage.
- Codex CLI support on server with per-bot headless login docs (gunnar + maren).
- Upstream tracking doc for `nix-clawdbot` updates.

### Changed
- Fleet config refactor to base/override pattern.
- Fleet module options extended with `documentsDir`, `identity`, and `codex` controls.
- Documentation updated for monorepo paths and operational guidance.
- Tests expanded for doctor/setup; coverage now above 80% across core package metrics.
