# OpenTofu (Hetzner) — infra state

Clawdlets uses OpenTofu for Hetzner provisioning (runtime state dir: `.clawdlets/infra/opentofu/<host>/**`).

Notes:
- State lives in `.clawdlets/infra/opentofu/<host>/terraform.tfstate` (gitignored).
- Policy (recommended): single operator at a time; always `plan` before `apply`.
- Preferred workflow: use the CLI (`clawdlets bootstrap` / `clawdlets infra apply`) so vars/outputs match what the rest of the repo expects.

Manual runs (debugging):

```bash
nix run --impure nixpkgs#opentofu -- -chdir=.clawdlets/infra/opentofu/<host> init
nix run --impure nixpkgs#opentofu -- -chdir=.clawdlets/infra/opentofu/<host> plan
nix run --impure nixpkgs#opentofu -- -chdir=.clawdlets/infra/opentofu/<host> apply
```
