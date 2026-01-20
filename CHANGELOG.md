# Changelog
All notable changes to this repository will be documented in this file.

The format is based on Keep a Changelog and this project follows SemVer for npm releases.

## Unreleased

## [0.3.1] - 2026-01-20
### Fixed
- Auto-repair stale operator age public keys during `clawdlets secrets init` to prevent recipient drift.
- Recover host age key from extra-files when encrypted host key cannot be decrypted.
- Add `secrets verify`/doctor preflight checks for operator recipient mismatch with a clear fix hint.

### Docs
- Add troubleshooting guidance for secrets init/verify when age keys drift.

## [0.3.0] - 2026-01-20
### Breaking
- Move cattle commands into the `@clawdlets/plugin-cattle` plugin. Install via `clawdlets plugin add cattle`.

### Added
- Plugin system with `clawdlets plugin add|list|rm` and runtime dispatch.

## [0.2.5] - 2026-01-19
### Fixed
- Allow npm CLI builds (bundled dist) to locate the template-source config.

## [0.2.4] - 2026-01-19
### Fixed
- Resolve CLI package root so `clawdlets --version` works after global installs.

## [0.2.3] - 2026-01-19
### Fixed
- Include bash in the gateway-token systemd unit path so the helper script runs on hosts.

## [0.2.2] - 2026-01-19
### Fixed
- Allow `clawdlets config set` to repair invalid configs by applying the change before validation.

## [0.2.1] - 2026-01-19
### Fixed
- Handle null `fleet.modelSecrets` in Nix runtime env wiring (prevents eval failure during bootstrap).

## [0.2.0] - 2026-01-18
### Breaking
- Remove `envSecrets` indirection. Secrets now live in `fleet.modelSecrets` (provider → secret) and `fleet.bots.<bot>.profile.discordTokenSecret`. Config schema bumped to v8.
- Drop `fleet/workspaces/bots/<bot>/clawdbot.json5` `$include` path; clawdbot config is inline only.

## [0.1.1] - 2026-01-18

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
- CI workflows: `deploy-manifest` (build + publish per-host manifests) and `deploy` (GitOps tailnet deploy).
- Manifest signing support in CI (minisign) + self-update signature verification.
- `clawdlets server manifest` command (pins rev + toplevel + secretsDigest).
- Self-update module: `clawdlets.selfUpdate.*` (manifest URL + timer).
- Image pipeline: `nixos-generators` outputs (`<host>-image`), `clawdlets image build|upload`, and `bootstrap --mode image`.
- Hetzner image/location config fields (`hosts.<host>.hetzner.image/location`).
- Separate template repo (`regenrek/clawdlets-template`) with CI checks for generated projects.
- Cattle mode (Hetzner): `clawdlets cattle spawn|list|destroy|reap|logs|ssh` (ephemeral single-task VMs).
- ClawdletFleet control plane (`clf`): sqlite-backed jobs queue + unix-socket orchestrator + CLI for bot-driven orchestration.
- Cattle secrets channel: one-time bootstrap token + tailnet-only HTTP endpoint to fetch runtime env (no long-lived LLM keys in Hetzner user_data).

### Changed
- Workflow automation: `nix-clawdbot` bump PRs are created using a GitHub App token (so normal PR checks run) and are compatible with strict branch protection.
- Repo layout: runtime state is `.clawdlets/` (gitignored); repo-canonical secrets are sops-encrypted in `secrets/`.
- Config schema bump: `fleet/clawdlets.json` schemaVersion `5` (replace `publicSsh/provisioning` with `sshExposure.mode` as the single SSH exposure policy).
- OpenTofu firewall rules now follow `sshExposure.mode` and separate baseline vs SSH exposure firewalls.
- CLI flag rename: `--stack-dir` → `--runtime-dir`.
- Secrets init JSON: replaces `zAiApiKey` with `secrets.<secretName>` map.
- Doctor UX: output grouped by scope/category with status coloring; add `clawdlets doctor --show-ok` to include ok checks.
- Server ops: `server logs|status|audit` now use sudoers-compatible `systemctl`/`journalctl` invocation order; `server logs` defaults to `-n 200` and adds `--lines`.
- Secrets sync now uses the allowlisted `install-secrets` host entrypoint (no `sudo sh -lc`).
- SSH capture: `sshCapture(..., { tty: true })` now actually allocates a TTY (fixes `ssh: Pseudo-terminal will not be allocated...` for capture use-cases).
- Deploy gate split into `bootstrap` vs `server-deploy`; `server deploy`/`lockdown` no longer require Hetzner creds or nixos-anywhere extra-files.
- Garnix config now explicitly builds `packages.x86_64-linux.*-system`.
- Secrets tar digest is now deterministic (canonical tar+gzip).
- Project init now pulls templates from `regenrek/clawdlets-template` (no embedded template dist in this repo).

### Fixed
- Nix build for `packages.x86_64-linux.clf` (layout + symlinks) so Garnix packaging succeeds.
- Orchestrator hardening: safer bearer parsing, no cleartext env logging, no stacktrace exposure in error responses.

### Removed
- Stack concept + `clawdlets stack` command.
- `clawdlets secrets migrate` and stack docs.
- `clawdlets server rebuild` and `/etc/clawdlets/bin/rebuild-host` (replaced by cache-only deploy flow).
- Embedded template package (`packages/template`) and base-repo `garnix.yaml`.

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
- Legacy `@clawdlets/core` setup export + tests (unused).

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
