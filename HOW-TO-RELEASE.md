# How To Release clawdlets

This repo publishes `clawdlets` to npm via GitHub Actions using npm Trusted Publishing (OIDC).

## About internal workspace packages (important)

This repo uses workspace packages for code boundaries (`packages/core`, `packages/shared`, `packages/cattle-core`, `packages/clf/queue`), but we intentionally **do not publish them to npm**.

Instead:
- `clawdlets` and `@clawdlets/plugin-cattle` are bundled (tsdown bundles workspace deps into `dist/`)
- `scripts/prepare-package.mjs` drops all `workspace:*` deps and fails if any local protocol deps remain

This keeps npm surface area small (only 2 packages) and avoids broken installs across package managers.

The publish workflow uses `scripts/prepare-package.mjs` to:
- drop `workspace:*` deps (workspace code is bundled into `dist/`)
- strip `.map` + `.tsbuildinfo` from `dist/`
- copy `README.md` + `LICENSE`

## Preconditions

- Clean working tree on `main`
- `main` up to date with `origin/main`
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
pnpm dlx tsx scripts/release.ts 0.1.1
```

The script:
- bumps versions (`packages/cli/`, `packages/core/`)
- runs gates (`pnpm gate`, `scripts/secleak-check.sh`)
- commits `chore(release): vX.Y.Z`, tags `vX.Y.Z`, pushes

Dry-run (gates only):

```bash
pnpm dlx tsx scripts/release.ts patch --dry-run
```

## Packaging sanity check (do this for hotfixes like 0.4.1)

Before tagging/publishing (or when fixing a broken npm release), verify the prepared package has **no local protocol deps**:

```bash
pnpm -r build
node scripts/prepare-package.mjs --out dist/npm/clawdlets
cd dist/npm/clawdlets
node -e 'const pkg=require("./package.json");for(const s of ["dependencies","devDependencies","optionalDependencies","peerDependencies"]){for(const [k,v] of Object.entries(pkg[s]||{})){const spec=String(v||"");if(spec.startsWith("workspace:")||spec.startsWith("file:")||spec.startsWith("link:")){throw new Error(`bad dep: ${s}.${k}=${spec}`);}}}console.log("ok")'
node dist/main.mjs --version
```

If any of these checks fail, **do not publish** (you will ship a package that cannot be installed by `pnpm`/`yarn`).

## What happens on GitHub

- Tag push triggers workflow `release`:
  - reruns gates
  - creates a GitHub Release using notes extracted from `CHANGELOG.md`
- Publishing the GitHub Release triggers workflow `npm Release`:
  - builds
  - stages publishable package dirs via `scripts/prepare-package.mjs`
  - publishes with OIDC: `npm publish --provenance`

## After publish

- Update the template repo pin so project CI/deploy uses the new CLI:
  - In `clawdlets-template`, set `templates/default/config/clawdlets-cli-version.txt` to the clawdlets git ref you want projects to run (recommend: tag `vX.Y.Z`; for testing: full 40-hex SHA)
  - Commit + push
- If template changes were made, bump `config/template-source.json` in this repo (or use the
  `bump-template-ref` workflow) so `clawdlets project init` stays pinned to the latest template.
  - Note: bump-template-ref PRs require `BUMP_TEMPLATE_REF_TOKEN` secret (so required PR checks run under strict branch protection).

## Troubleshooting

- npm publish fails (OIDC / E403):
  - verify npm package → **Trusted Publishers** includes this repo and `.github/workflows/npm-release.yml`
  - confirm workflow has `permissions: id-token: write`
  - rerun `npm Release` via `workflow_dispatch` with `tag=vX.Y.Z`
