skills: ~/.codex/skills

rules
- no destructive ops unless asked (rm/reset/clean/force-push)
- no live infra unless asked (bootstrap/lockdown/provisioning apply)
- no shims/workarounds; single source of truth

never commit
- .clawdlets/
- *.tfstate*
- any keys/tokens/ids
