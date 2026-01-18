# Gateway (multi-gateway per host)

Clawdlets runs **one Clawdbot Gateway per bot** (security + isolation).

## Why

- compromised bot user can’t write other bots’ state/workspaces
- smaller blast radius for credentials, sessions, tools, and config

## Per-bot invariants (required)

For each bot `maren`:

- system user: `bot-maren`
- state dir: `/srv/clawdbot/maren` (`CLAWDBOT_STATE_DIR`)
- config path: `/run/secrets/rendered/clawdbot-maren.json` (`CLAWDBOT_CONFIG_PATH`)
- workspace: `/srv/clawdbot/maren/workspace` (`agents.defaults.workspace`)
- base port: `gateway.port` (derived ports must not collide)
- auth: `gateway.auth` is always enabled (even on loopback)

## Ports

Default port base is `18789`, stride `20`.

Reason: clawdbot uses derived ports (bridge/browser/canvas). Spacing avoids collisions across gateways.

Override per bot:

```bash
clawdlets config set --path fleet.bots.maren.profile.gatewayPort --value 18809
```

## Gateway auth token

Loopback gateways are **not** safe unauthenticated: any local process can call `config.apply`.

Clawdlets-template enforces:

- `gateway.auth.mode = "token"`
- `gateway.auth.token = "${CLAWDBOT_GATEWAY_TOKEN}"`

Token source (per bot):

- `/srv/clawdbot/<bot>/credentials/gateway.env`

Generated automatically by:

- `clawdbot-gateway-token-<bot>.service` (oneshot)

