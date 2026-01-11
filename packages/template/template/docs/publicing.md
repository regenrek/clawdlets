# Going public (safe)

Goal: publish repo without leaking:
- SSH keys / WireGuard peers / IPs / guild IDs
- Tokens (Discord/Hetzner/GitHub/ZAI/etc)
- age keys / sops config

## Rules

- `.clawdlets/` must never be tracked.
- Don’t commit secrets/keys anywhere in git. Use `.clawdlets/` only.
- Keep host-specific values out of `infra/nix/hosts/*.nix` and `infra/configs/clawdlets.json` before publishing (ship placeholders).

## Recommended process (no history)

1) Create a clean export from this repo:

```bash
mkdir -p /tmp/clawdlets-public
git archive --format=tar HEAD | tar -x -C /tmp/clawdlets-public
cd /tmp/clawdlets-public
git init
git add -A
git commit -m "chore: initial public import"
```

2) Run secret scanners (before pushing):
- trivy (misconfig/secret checks)

3) Add CI guardrails:
- fail if `.clawdlets/**` is tracked
- fail if `infra/secrets/**` exists (legacy path; this repo should not use it)

## What users do in public repo

- run `CLAWDLETS_INTERACTIVE=1 clawdlets stack init` → creates `.clawdlets/`
- run `CLAWDLETS_INTERACTIVE=1 clawdlets secrets init` → generates local keys + encrypted secrets
