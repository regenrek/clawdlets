# Agent config (routing + skills + workspaces)

Single source of truth:

- `fleet/clawdlets.json` (canonical fleet + host config)
- `fleet/bundled-skills.json` (canonical allowlist used by Nix assertions + doctor)

Rendered per-bot Clawdbot config:

- Nix generates `clawdbot-<bot>.json` and injects secrets at activation time.

## Routing (Discord)

Set values via CLI (no manual Nix edits):

- guild id: `clawdlets fleet set --guild-id <id>`
- routing overrides (example):
  - `clawdlets config set --path fleet.routingOverrides.maren --value-json '{"channels":["dev"],"requireMention":true}'`

If you change `bots`, update `secrets/hosts/<host>/discord_token_<name>.yaml`, sync, then deploy.

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


## Identity (optional)

Set a shared agent identity:

```nix
identity = {
  name = "Clawdbot Fleet";
  # emoji = ":robot:";
};
```

## Gateway ports

Gateway ports are auto-assigned from the `bots` list.

Per-bot override (example):

```bash
clawdlets config set --path fleet.botOverrides.melinda.gatewayPort --value 18819
```

## Model defaults (provider/model)

Set a default model for the host:

```bash
clawdlets host set --agent-model-primary zai/glm-4.7
```

Optional extra model entries (per-bot):

```bash
clawdlets config set --path fleet.botOverrides.melinda.passthrough.agents.models.fast --value zai/glm-4.2
```

Per-bot override:

```bash
clawdlets config set --path fleet.botOverrides.melinda.passthrough.agents.defaults.modelPrimary --value zai/glm-4.7
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
clawdlets config set --path fleet.botOverrides.gunnar.skills.allowBundled --value-json '["github","coding-agent"]'
clawdlets config set --path fleet.botOverrides.maren.skills.allowBundled --value-json '["github","brave-search","coding-agent"]'
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

Requires at least one bot with GitHub App config (`fleet.botOverrides.<bot>.github.*`).

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

- `fleet.botOverrides.<bot>.agent.workspace = "/some/path"`

Optional seed-once:

- `fleet.botOverrides.<bot>.workspace.seedDir = ./workspaces/<bot>`
- copied only when the workspace is empty.

### Skills

Allowlist bundled skills:

- `fleet.botOverrides.<bot>.skills.allowBundled = [ "github" "brave-search" ... ]`

Treat `allowBundled` as required on servers. Avoid `null` (typically means “allow all bundled skills”).

Per-skill secrets (recommended):

- `fleet.botOverrides.<bot>.skills.entries."<skill>".envSecrets.<ENV_VAR> = "<sops_secret_name>"`
- `fleet.botOverrides.<bot>.skills.entries."<skill>".apiKeySecret = "<sops_secret_name>"`

### Per-bot service env (provider API keys)

Use this for model provider API keys (e.g. ZAI, OpenAI, etc.).

- `fleet.botOverrides.<bot>.envSecrets.<ENV_VAR> = "<sops_secret_name>"`

Note: enabling `"coding-agent"` pulls large packages (Codex CLI + deps) into the NixOS closure and can
OOM small remote build machines during bootstrap. Prefer enabling it only after the host is up (swap
enabled) or use a bigger build machine.

### Hooks (Gmail/webhooks)

Secrets:

- `fleet.botOverrides.<bot>.hooks.tokenSecret = "<sops_secret_name>"`
- `fleet.botOverrides.<bot>.hooks.gmailPushTokenSecret = "<sops_secret_name>"`

Non-secret config:

- `fleet.botOverrides.<bot>.hooks.config = { ... }`

### GitHub App auth (maren)

Configure:

```bash
clawdlets config set --path fleet.botOverrides.maren.github --value-json '{"appId":123456,"installationId":12345678,"privateKeySecret":"gh_app_private_key_maren","refreshMinutes":45}'
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
