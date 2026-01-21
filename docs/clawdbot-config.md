# Clawdbot config (passed through)

Clawdlets does not invent a second routing/channels schema. Use clawdbot’s config schema directly.

## Where to put config

- `fleet/clawdlets.json` → `fleet.bots.<bot>.clawdbot` (raw clawdbot config object)

Clawdlets invariants always win:

- `gateway.bind` / `gateway.port`
- `gateway.auth` (always enabled)
- `agents.defaults.workspace`

## Secrets

Never commit plaintext tokens into config.

Files under `documentsDir` are copied into the Nix store during deploy. Treat them as public:
do **not** place secrets in `fleet/workspaces/**`.

Use env var references in clawdbot config and wire them to sops secret names in `fleet/clawdlets.json`:

- Discord: set `channels.discord.token="${DISCORD_BOT_TOKEN}"` and wire `fleet.bots.<bot>.profile.secretEnv.DISCORD_BOT_TOKEN = "<secretName>"`
- Model providers: wire `fleet.secretEnv.<ENV_VAR> = "<secretName>"` (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ZAI_API_KEY`)

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
