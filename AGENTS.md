skills: ~/.codex/skills

must
- prod-grade, maintainable, scalable
- fix root cause (no band-aids)
- no shims/wrappers/adapters/workarounds
- one canonical impl; ask always to delete dead/legacy paths in same change
- single source of truth for rules/config/validation/enums

rules
- no destructive ops unless asked (rm/reset/clean/force-push)
- no live infra unless asked (bootstrap/lockdown/opentofu apply)

never commit (secrets/instance)
- .clawdlets/
- .env files (local tokens)
- age keys (operator or host)
- sops config/keys
- opentofu state
- ssh private keys
- any discord tokens/guild ids/api keys

docs
- entry: docs/README.md
- index: docs/docs.yaml

source of truth
- cli/src and packages/core/src (not dist)
- infra/nix and infra/opentofu
- docs/*.md and docs/docs.yaml

generated (do not edit)
- cli/dist
- packages/*/dist

checks
- pnpm -r test
- cd packages/core && pnpm run coverage

commits
- Conventional Commits
