# Clawdbot config (passed through)

Clawdlets does not invent a second routing/channels schema. Use clawdbot’s config schema directly.

## Where to put config

- `fleet/clawdlets.json` → `fleet.bots.<bot>.clawdbot` (raw clawdbot config object)

Clawdlets invariants always win:

- `gateway.bind` / `gateway.port`
- `gateway.auth` (always enabled)
- `agents.defaults.workspace`

## Security audit + hardening

Clawdlets treats Clawdbot security as deploy-critical by default: insecure “open” policies should not ship accidentally.

- `clawdlets doctor` runs a static Clawdbot security lint per bot (config-only; no gateway needed).
- `clawdlets server audit` runs `clawdbot security audit --json` per bot over SSH (fails on critical findings).
- `clawdlets clawdbot harden` applies safe defaults to `fleet/clawdlets.json` (dry-run unless `--write`).
- Web UI: Bot Clawdbot editor includes a “Harden” button; applying a channel preset also applies hardening defaults.

Hardening defaults (opt-in):
- `logging.redactSensitive="tools"` (if unset or `"off"`)
- `session.dmScope="per-channel-peer"` (if unset or `"main"`)
- `dmPolicy`/`dm.policy`: `"pairing"` (if unset or `"open"`)
- `groupPolicy`: `"allowlist"` (if unset or `"open"`)

Notes:
- Hardening does **not** add allowlists (`allowFrom`, `groupAllowFrom`, `groups`) because it cannot know your intended users/groups.
- “Open” DM/group policies are treated as critical findings.

## Schema sources (pinned vs live)

- pinned schema is bundled with clawdlets and used by CLI validation + default UI editor
- live schema can be fetched from a running gateway in the web UI ("Use live schema")
  - requires `hosts.<host>.targetHost` (SSH) and an active bot gateway
  - uses the bot’s `/srv/clawdbot/<bot>/credentials/gateway.env` token via SSH
  - CLI: `clawdlets clawdbot schema fetch --host <host> --bot <bot>`
- UI shows schema drift:
  - pinned schema vs project’s pinned `nix-clawdbot` rev
  - pinned schema vs upstream `nix-clawdbot` main

## Web editor validation

- Monaco editor with JSON schema diagnostics (unknown keys + type errors highlighted inline).
- Security audit panel lists critical/warn/info findings + recommendations.
- “Save validation issues” are server-side (pinned/live schema) and block writes.

## Secrets

Never commit plaintext tokens into config.

Files under `documentsDir` are copied into the Nix store during deploy. Treat them as public:
do **not** place secrets in `fleet/workspaces/**`.

Use env var references in clawdbot config and wire them to sops secret names in `fleet/clawdlets.json`:

- Discord: set `channels.discord.token="${DISCORD_BOT_TOKEN}"` and wire `fleet.bots.<bot>.profile.secretEnv.DISCORD_BOT_TOKEN = "<secretName>"`
- Model providers: wire `fleet.secretEnv.<ENV_VAR> = "<secretName>"` (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ZAI_API_KEY`)

Notes:
- `${ENV_VAR}` is the only detected form (uppercase + underscores). Escape literal `${ENV_VAR}` as `$${ENV_VAR}`.
- Inline tokens/API keys emit warnings; strict mode fails them.

Example (Discord token):

```json
{
  "fleet": {
    "bots": {
      "maren": {
        "profile": { "secretEnv": { "DISCORD_BOT_TOKEN": "discord_token_maren" } },
        "clawdbot": {
          "channels": { "discord": { "enabled": true, "token": "${DISCORD_BOT_TOKEN}" } }
        }
      }
    }
  }
}
```
