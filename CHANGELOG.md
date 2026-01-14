# Changelog
All notable changes to this repository will be documented in this file.

The format is based on Keep a Changelog and this project follows SemVer for npm releases.

## Unreleased

### Added
- Base flake resolution: `fleet/clawdlets.json.baseFlake` (fallback: `git remote origin`) used by deploy commands (`bootstrap`, `lockdown`).
- Non-interactive secrets provisioning: `clawdlets secrets init --from-json <path|->`.
- Fleet-level secret env wiring: `fleet/clawdlets.json.fleet.envSecrets` (env var → sops secret name), used for LLM API keys.
- New docs: `docs/config.md` (canonical config + host knobs).
- Doctor check: `discord routing` now verifies `fleet.guildId` and per-bot `fleet.routingOverrides.<bot>.channels` to prevent “silent” bots.
- `clawdlets bootstrap --force` skips doctor preflight gate (advanced usage).
- Destroy command: `clawdlets infra destroy` (with `--force` for non-interactive automation).
- Local deploy creds: `clawdlets env init` + `clawdlets env show` (default env file: `.clawdlets/env`).
- Cache-only deploy flow: `clawdlets server deploy` (switch by store path + secrets install) with optional deploy manifest.
- Host deploy entrypoints: `/etc/clawdlets/bin/install-secrets` + `/etc/clawdlets/bin/switch-system` (sudo allowlist via `clawdlets.operator.deploy`).
- Private Garnix cache support: `clawdlets.cache.garnix.private.*` (netrc + narinfo TTL).

### Changed
- Workflow automation: `nix-clawdbot` bump PRs are created using a GitHub App token (so normal PR checks run) and are compatible with strict branch protection.
- Repo layout: runtime state is `.clawdlets/` (gitignored); repo-canonical secrets are sops-encrypted in `secrets/`.
- Config schema bump: `fleet/clawdlets.json` schemaVersion `4` (adds `fleet.envSecrets` and removes baked-in provider keys).
- CLI flag rename: `--stack-dir` → `--runtime-dir`.
- Secrets init JSON: replaces `zAiApiKey` with `secrets.<secretName>` map.
- Doctor UX: output grouped by scope/category with status coloring; add `clawdlets doctor --show-ok` to include ok checks.
- Server ops: `server logs|status|audit` now use sudoers-compatible `systemctl`/`journalctl` invocation order; `server logs` defaults to `-n 200` and adds `--lines`.
- Secrets sync now uses the allowlisted `install-secrets` host entrypoint (no `sudo sh -lc`).
- SSH capture: `sshCapture(..., { tty: true })` now actually allocates a TTY (fixes `ssh: Pseudo-terminal will not be allocated...` for capture use-cases).

### Removed
- Stack concept + `clawdlets stack` command.
- `clawdlets secrets migrate` and stack docs.
- `clawdlets server rebuild` and `/etc/clawdlets/bin/rebuild-host` (replaced by cache-only deploy flow).

## [0.1.0] - 2026-01-11
### Added
- Canonical config: `fleet/clawdlets.json` (single source of truth) + CLI subcommands (`config`, `host`, `fleet`).
- CLI-first project scaffolding (`clawdlets project init`) using the embedded template package.
- Supply-chain hardening: Dependabot (npm + GitHub Actions), pinned GitHub Actions by SHA, TruffleHog secret scanning workflow.
- Local security gate: `scripts/secleak-check.sh` (gitleaks + trivy).
- npm publishing via GitHub Actions Trusted Publishing (OIDC) + release automation docs/scripts.

### Changed
- Nix flake now derives `nixosConfigurations` from `fleet/clawdlets.json` hosts list (multi-host ready).
- Default UX: non-interactive unless `--interactive` / `CLAWDLETS_INTERACTIVE=1`.
- Docs updated to be CLI-first (no manual Nix edits; `fleet.nix` treated as derived output).

### Removed
- Legacy Nix template generation from the codebase (no more “render/ensure templates” path).
- Legacy `@clawdbot/clawdlets-core` setup export + tests (unused).

## [0.0.0] - 2026-01-10
### Added
- ai-stack alignment: seeded `fleet/workspaces/common/` (AGENTS/SOUL/TOOLS/IDENTITY) and documented usage.
- Codex CLI support on server with per-bot headless login docs (gunnar + maren).
- Upstream tracking doc for `nix-clawdbot` updates.

### Changed
- Fleet config refactor to base/override pattern.
- Fleet module options extended with `documentsDir`, `identity`, and `codex` controls.
- Documentation updated for monorepo paths and operational guidance.
- Tests expanded for doctor/setup; coverage now above 80% across core package metrics.
