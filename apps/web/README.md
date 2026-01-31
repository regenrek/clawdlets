# Clawdlets Web (TanStack Start + Convex)

Self-hosted web UI for bootstrapping + operating Clawdlets projects.

## Dev

1) Install deps (repo root):

```sh
pnpm install
```

2) Login to Convex (if needed):

```sh
cd apps/web
npx convex login
```

3) Create `apps/web/.env.local` from `apps/web/.env.local.example` and run Convex dev once:

```sh
cd apps/web
npx convex dev --once
```

4) Set Convex env vars for Better Auth (local dev deployment):

```sh
cd apps/web
npx convex env set SITE_URL http://localhost:3000
npx convex env set BETTER_AUTH_SECRET "<generate-a-random-secret>"
```

5) Run:

```sh
cd apps/web
pnpm dev
```

### Template source

Project scaffolding defaults to `config/template-source.json` (pinned commit). Override with `CLAWDLETS_TEMPLATE_SPEC`.

### Auth config

Auth is always enabled. Configure Better Auth env vars for both the web app and Convex:

```sh
SITE_URL=http://localhost:3000
BETTER_AUTH_SECRET=... # 32+ chars
VITE_CONVEX_URL=https://<deployment>.convex.cloud
VITE_CONVEX_SITE_URL=https://<deployment>.convex.site
```

## Build

```sh
cd apps/web
pnpm build
```

## Test

```sh
cd apps/web
pnpm test
```
