# Clawdbot config (passed through)

Clawdlets does not invent a second routing/channels schema. Use clawdbot’s config schema directly.

## Where to put config

Small/inline:

- `fleet/clawdlets.json` → `fleet.bots.<bot>.clawdbot` (raw clawdbot config object)

Large/file-based (recommended when it grows):

- `fleet/workspaces/bots/<bot>/clawdbot.json5`

If the JSON5 file exists, clawdlets-template:

- installs `fleet/workspaces/bots/<bot>/` to `/etc/clawdlets/bots/<bot>/`
- injects `"$include": "/etc/clawdlets/bots/<bot>/clawdbot.json5"` into the rendered config

## Merge order

1. file-based config (`$include`)
2. inline config (`fleet.bots.<bot>.clawdbot`) overrides file
3. clawdlets invariants override both:
   - `gateway.bind` / `gateway.port`
   - `gateway.auth` (always enabled)
   - `agents.defaults.workspace`

## Secrets

Never commit plaintext tokens into clawdbot.json5.

Use env var substitution and map env vars → sops secrets:

- `fleet.envSecrets.<ENV_VAR> = "<secretName>"` (default for all bots)
- `fleet.bots.<bot>.profile.envSecrets.<ENV_VAR> = "<secretName>"` (per bot)

Example (Discord token):

```json
{
  "fleet": {
    "bots": {
      "maren": {
        "profile": { "envSecrets": { "DISCORD_BOT_TOKEN": "discord_token_maren" } },
        "clawdbot": {
          "channels": { "discord": { "token": "${DISCORD_BOT_TOKEN}" } }
        }
      }
    }
  }
}
```

Recommended channel env var names:

- Discord: `DISCORD_BOT_TOKEN`
- Telegram: `TELEGRAM_BOT_TOKEN`
- Slack: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`

## Migration

Old v6 configs:

```bash
clawdlets config migrate-v6-to-v7
```

This is one-shot and writes a `*.bak` backup next to your config.
