# Clawdlets Web (TanStack Start + Convex)

Self-hosted web UI for bootstrapping + operating Clawdlets projects.

## Dev

1) Install deps (repo root):

```sh
pnpm install
```

2) Create `apps/web/.env.local` from `apps/web/.env.local.example` and run Convex dev once:

```sh
cd apps/web
npx convex dev --once
```

3) Set Convex env vars for Better Auth (local dev deployment):

```sh
cd apps/web
npx convex env set SITE_URL http://localhost:3000
npx convex env set BETTER_AUTH_SECRET "<generate-a-random-secret>"
```

4) Run:

```sh
cd apps/web
pnpm dev
```

### Template source

Project scaffolding defaults to `config/template-source.json` (pinned commit). Override with `CLAWDLETS_TEMPLATE_SPEC`.

### Dev mode (no auth)

Set `VITE_CLAWDLETS_AUTH_DISABLED=true` and `CLAWDLETS_AUTH_DISABLED=true` in `apps/web/.env.local`, and also set the Convex env var:

```sh
cd apps/web
npx convex env set CLAWDLETS_AUTH_DISABLED true
```

## Build

```sh
cd apps/web
pnpm build
```
