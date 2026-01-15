# Docs index

- `docs/overview.md`: mental model + lifecycle
- `docs/golden-path.md`: first-class workflow (bootstrap → CI manifests → deploy)
- `docs/quickstart.md`: “do these commands” walkthrough
- `docs/poc.md`: acceptance criteria (“done”)
- `docs/cli.md`: command cookbook
- `docs/config.md`: `fleet/clawdlets.json` reference
- `docs/agent-config.md`: routing + skills + workspaces
- `docs/runtime-layout.md`: canonical on-host paths
- `docs/install.md`: prerequisites + install details
- `docs/secrets.md`: sops/age + extra-files
- `docs/security.md`: threat model + boundaries
- `docs/ops-invariants.md`: deploy-only ops rules
- `docs/deploy.md`: deploy/update options + tradeoffs
- `docs/image-based-provisioning.md`: image pipeline plan + POC steps
- `docs/operations.md`: day-2 ops
- `docs/runbook.md`: day 0 / day 2 checklist
- `docs/troubleshooting.md`: common failure modes
- `docs/publicing.md`: OSS-safe publishing checklist
- `docs/upstream.md`: nix-clawdbot tracking notes

## Template docs sync

Template docs live in `regenrek/clawdlets-template` under `templates/default/docs`.
Infra + template docs live in the template repo. If you change docs here, mirror the updates into the template repo.
