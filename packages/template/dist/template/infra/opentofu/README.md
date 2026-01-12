# OpenTofu (Hetzner) — infra state

Clawdlets uses OpenTofu for Hetzner provisioning (`infra/opentofu/**`).

Notes:
- State lives in `infra/opentofu/terraform.tfstate` by default (gitignored).
- Policy (recommended): single operator at a time; always `plan` before `apply`.
- Preferred workflow: use the CLI (`clawdlets bootstrap` / `clawdlets infra apply`) so vars/outputs match what the rest of the repo expects.

Manual runs (debugging):

```bash
nix run --impure nixpkgs#opentofu -- -chdir=infra/opentofu init
nix run --impure nixpkgs#opentofu -- -chdir=infra/opentofu plan
nix run --impure nixpkgs#opentofu -- -chdir=infra/opentofu apply
```

