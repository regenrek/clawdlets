# How To Release clawdlets

This repo publishes `clawdlets` to npm via GitHub Actions using npm Trusted Publishing (OIDC).

## Preconditions

- Clean working tree on `main`
- `CHANGELOG.md` has a section for the exact version you will release: `## [X.Y.Z] - YYYY-MM-DD`
- GitHub Actions is configured as a **Trusted Publisher** for the npm package
  - Workflow: `npm-release.yml`
  - Environment: `npm`

## Update changelog

- Move items from `## Unreleased` into a new version section:
  - `## [X.Y.Z] - YYYY-MM-DD`

## Release (recommended)

Run:

```bash
pnpm dlx tsx scripts/release.ts patch
```

Or:

```bash
pnpm dlx tsx scripts/release.ts 0.1.0
```

The script:
- bumps versions (`cli/`, `packages/core/`)
- runs gates (`pnpm -r test`, `pnpm -r build`, `pnpm -C packages/core run coverage`, `scripts/secleak-check.sh`)
- commits `chore(release): vX.Y.Z`, tags `vX.Y.Z`, pushes

## What happens on GitHub

- Tag push triggers workflow `release`:
  - reruns gates
  - creates a GitHub Release using notes extracted from `CHANGELOG.md`
- Publishing the GitHub Release triggers workflow `npm Release`:
  - builds
  - stages a publishable package dir via `scripts/prepare-package.mjs`
  - publishes with OIDC: `npm publish --provenance`

## After publish

- Update the template repo pin so project CI/deploy uses the new CLI:
  - In `clawdlets-template`, set `templates/default/config/clawdlets-cli-version.txt` to `X.Y.Z`
  - Commit + push
- If template changes were made, bump `config/template-source.json` in this repo (or use the
  `bump-template-ref` workflow) so `clawdlets project init` stays pinned to the latest template.

## Troubleshooting

- npm publish fails (OIDC / E403):
  - verify npm package → **Trusted Publishers** includes this repo and `.github/workflows/npm-release.yml`
  - confirm workflow has `permissions: id-token: write`
  - rerun `npm Release` via `workflow_dispatch` with `tag=vX.Y.Z`
