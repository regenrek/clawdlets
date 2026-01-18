# Agent config (clawdbot-first)

Single source of truth:

- `fleet/clawdlets.json` (canonical fleet + host config)
- `fleet/bundled-skills.json` (canonical allowlist for Nix assertions + doctor)
- `fleet/workspaces/**` (prompt policy + optional clawdbot.json5)

Rendered per-bot clawdbot config:

- Nix generates `/run/secrets/rendered/clawdbot-<bot>.json`

## Canonical bot config (clawdbot schema)

Two inputs:

- inline: `fleet.bots.<bot>.clawdbot` (JSON object)
- file: `fleet/workspaces/bots/<bot>/clawdbot.json5` (optional)

Merge order:

1. file config (via `$include`)
2. inline config overrides file
3. clawdlets invariants override both (gateway bind/port/auth; workspace path)

### Example: Discord token via env var

```json
{
  "fleet": {
    "bots": {
      "maren": {
        "profile": {
          "envSecrets": {
            "DISCORD_BOT_TOKEN": "discord_token_maren"
          }
        },
        "clawdbot": {
          "channels": {
            "discord": {
              "enabled": true,
              "token": "${DISCORD_BOT_TOKEN}"
            }
          }
        }
      }
    }
  }
}
```

## Gateway isolation (multi-gateway)

Design: 1 bot = 1 gateway = 1 unix user.

Per bot:

- system user: `bot-<bot>`
- state dir: `/srv/clawdbot/<bot>`
- workspace: `/srv/clawdbot/<bot>/workspace` (default)
- gateway config: `/run/secrets/rendered/clawdbot-<bot>.json`
- gateway auth token env: `/srv/clawdbot/<bot>/credentials/gateway.env` (generated; required)

Ports:

- base: `18789`
- stride: `20` (derived ports won’t collide)

## Secrets -> env vars

Map env vars to sops secret names:

- global defaults: `fleet.envSecrets.<ENV_VAR> = "<secretName>"`
- per bot: `fleet.bots.<bot>.profile.envSecrets.<ENV_VAR> = "<secretName>"`

Clawdbot config should reference env vars via `${ENV_VAR}` (never plaintext secrets in git).

## Documents (AGENTS / SOUL / TOOLS / IDENTITY)

Workspace docs (prompt/policy) live in:

- `fleet/workspaces/common/` (shared)
- `fleet/workspaces/bots/<bot>/` (overrides; overlay on top of common)

Fleet config points Nix at the workspace seed root:

```nix
documentsDir = ./workspaces;
```

On every bot service start:

- if workspace empty: seed common then bot overlay
- always: sync a managed allowlist (AGENTS/SOUL/IDENTITY/TOOLS/USER/HEARTBEAT) into the workspace
- always: sync `skills/` into the workspace (custom/local skills)

### Custom/local skills

Put skill definitions under:

- shared: `fleet/workspaces/common/skills/<skill>/SKILL.md`
- per-bot: `fleet/workspaces/bots/<bot>/skills/<skill>/SKILL.md`

The bot config always includes `skills.load.extraDirs = ["<workspace>/skills"]`, so skills in that folder are discoverable without extra per-bot config.

## Gateway ports

Gateway ports are auto-assigned from `fleet.botOrder`.

Per-bot override (example):

```bash
clawdlets config set --path fleet.bots.melinda.profile.gatewayPort --value 18819
```

## Model defaults (provider/model)

Set a default model for the host:

```bash
clawdlets host set --agent-model-primary zai/glm-4.7
```

Optional extra model entries (per-bot):

```bash
clawdlets config set --path fleet.bots.melinda.clawdbot.agents.defaults.models.fast --value-json '{"alias":"fast"}'
```

Per-bot override:

```bash
clawdlets config set --path fleet.bots.melinda.clawdbot.agents.defaults.model.primary --value zai/glm-4.7
```

Provider API keys (env var -> sops secret name):

```bash
clawdlets config set --path fleet.envSecrets.ZAI_API_KEY --value z_ai_api_key
clawdlets config set --path fleet.envSecrets.Z_AI_API_KEY --value z_ai_api_key

clawdlets config set --path fleet.envSecrets.ANTHROPIC_API_KEY --value anthropic_api_key

clawdlets config set --path fleet.envSecrets.OPENAI_API_KEY --value openai_api_key
clawdlets config set --path fleet.envSecrets.OPEN_AI_APIKEY --value openai_api_key
```

This renders into a per-bot env file and is loaded by systemd.

## Codex CLI (server)

Enable Codex CLI for selected bots:

```bash
clawdlets fleet set --codex-enable true
clawdlets config set --path fleet.codex.bots --value-json '["gunnar","maren"]'
```

Then allow bundled `coding-agent` for those bots:

```bash
clawdlets config set --path fleet.bots.gunnar.profile.skills.allowBundled --value-json '["github","coding-agent"]'
clawdlets config set --path fleet.bots.maren.profile.skills.allowBundled --value-json '["github","brave-search","coding-agent"]'
```

One-time login (headless):

```bash
sudo -u bot-maren env HOME=/srv/clawdbot/maren codex login --device-auth
sudo -u bot-gunnar env HOME=/srv/clawdbot/gunnar codex login --device-auth
```

## Bonjour / mDNS (optional)

If mDNS errors appear, Bonjour is disabled by default in the template host config.

## GitHub inventory sync (optional)

Run GitHub inventory sync (on-demand):

```bash
clawdlets server github-sync --target-host admin@<host>
```

Requires at least one bot with GitHub App config (`fleet.bots.<bot>.profile.github.*`).

## Ops snapshots (recommended)

Host ops snapshots (no secrets) are enabled by default in the template host config.

## Per-bot profiles (canonical config)

Each bot can have different:

- bundled skill allowlist
- per-skill env + secrets
- webhook/hook config + secrets
- GitHub App auth config (for non-interactive `gh` + git pushes)
- workspace seed repo
- per-bot service env (provider API keys, etc.)

### Long-term memory / knowledge base (workspace)

Each bot gets an isolated workspace at:

- `/srv/clawdbot/<bot>/workspace` (default)

Override:

- `fleet.bots.<bot>.profile.workspace.dir = "/some/path"`

Optional seed-once:

- set `documentsDir = ./workspaces` and use `fleet/workspaces/bots/<bot>/` overlays (recommended)

### Skills

Allowlist bundled skills:

- `fleet.bots.<bot>.profile.skills.allowBundled = [ "github" "brave-search" ... ]`

Treat `allowBundled` as required on servers. Avoid `null` (typically means “allow all bundled skills”).

Per-skill secrets (recommended):

- `fleet.bots.<bot>.profile.skills.entries."<skill>".envSecrets.<ENV_VAR> = "<sops_secret_name>"`
- `fleet.bots.<bot>.profile.skills.entries."<skill>".apiKeySecret = "<sops_secret_name>"`

### Per-bot service env (provider API keys)

Use this for model provider API keys (e.g. ZAI, OpenAI, etc.).

- `fleet.bots.<bot>.profile.envSecrets.<ENV_VAR> = "<sops_secret_name>"`

Note: enabling `"coding-agent"` pulls large packages (Codex CLI + deps) into the NixOS closure and can
OOM small remote build machines during bootstrap. Prefer enabling it only after the host is up (swap
enabled) or use a bigger build machine.

### Hooks (Gmail/webhooks)

Secrets:

- `fleet.bots.<bot>.profile.hooks.tokenSecret = "<sops_secret_name>"`
- `fleet.bots.<bot>.profile.hooks.gmailPushTokenSecret = "<sops_secret_name>"`

Non-secret config:

- set non-secret hook config in raw clawdbot config: `fleet.bots.<bot>.clawdbot.hooks.*`

### GitHub App auth (maren)

Configure:

```bash
clawdlets config set --path fleet.bots.maren.profile.github --value-json '{"appId":123456,"installationId":12345678,"privateKeySecret":"gh_app_private_key_maren","refreshMinutes":45}'
```

Effect on host:

- refreshes `GH_TOKEN` into `/srv/clawdbot/maren/credentials/gh.env`
- writes git HTTPS creds to `/srv/clawdbot/maren/credentials/git-credentials`
- writes `/srv/clawdbot/maren/.gitconfig` pointing git at that creds file

### Codex CLI OAuth (ChatGPT subscription)

Bot services run with `HOME=/srv/clawdbot/<bot>`, so Codex stores OAuth state at:

- `/srv/clawdbot/<bot>/.codex/auth.json`

One-time login on the host:

```bash
sudo -u bot-maren env HOME=/srv/clawdbot/maren codex login --device-auth
```

## Admin access (Tailscale)

Tailscale is used for admin SSH:

- set tailnet mode: `clawdlets host set --tailnet tailscale`
- store a Tailscale auth key in secrets (`tailscale_auth_key.yaml`)
- first boot auto-joins via NixOS `services.tailscale.authKeyFile` (no manual `tailscale up`)
