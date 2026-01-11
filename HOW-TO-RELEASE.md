# How To Release clawdlets

This repo publishes `clawdlets` to npm via GitHub Actions using npm Trusted Publishing (OIDC).

## Preconditions

- Clean working tree on `main`
- `CHANGELOG.md` has a section for the exact version you will release: `## [X.Y.Z] - YYYY-MM-DD`
- GitHub Actions is configured as a **Trusted Publisher** for the npm package

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
- bumps versions (`cli/`, `packages/core/`, `packages/template/`)
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

## Troubleshooting

- npm publish fails (OIDC / E403):
  - verify npm package → **Trusted Publishers** includes this repo and `.github/workflows/npm-release.yml`
  - confirm workflow has `permissions: id-token: write`
  - rerun `npm Release` via `workflow_dispatch` with `tag=vX.Y.Z`

