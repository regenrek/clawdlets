import type { SecretSource, SecretSpec } from "./secrets-plan.js";

export type SecretSpecAccumulator = {
  name: string;
  kind: SecretSpec["kind"];
  scope: SecretSpec["scope"];
  sources: Set<SecretSource>;
  envVars: Set<string>;
  bots: Set<string>;
  help?: string;
  optional: boolean;
  fileId?: string;
};

const SOURCE_PRIORITY: SecretSource[] = ["channel", "model", "provider", "custom"];
const ENV_REF_RE = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

export const ENV_VAR_HELP: Record<string, string> = {
  DISCORD_BOT_TOKEN: "Discord bot token",
  TELEGRAM_BOT_TOKEN: "Telegram bot token",
  SLACK_BOT_TOKEN: "Slack bot token",
  SLACK_APP_TOKEN: "Slack app token",
  OPENAI_API_KEY: "OpenAI API key",
  ANTHROPIC_API_KEY: "Anthropic API key",
  ZAI_API_KEY: "Z.ai API key",
  OPENROUTER_API_KEY: "OpenRouter API key",
  XAI_API_KEY: "xAI API key",
  GROQ_API_KEY: "Groq API key",
  GEMINI_API_KEY: "Gemini API key",
  MISTRAL_API_KEY: "Mistral API key",
  CEREBRAS_API_KEY: "Cerebras API key",
  MOONSHOT_API_KEY: "Moonshot API key",
  KIMICODE_API_KEY: "Kimi Code API key",
  MINIMAX_API_KEY: "MiniMax API key",
  AI_GATEWAY_API_KEY: "Vercel AI Gateway API key",
  OPENCODE_API_KEY: "OpenCode API key",
  OPENCODE_ZEN_API_KEY: "OpenCode Zen API key",
};

const ENV_VAR_SECRET_NAME_SUGGESTIONS: Record<string, (bot?: string) => string> = {
  DISCORD_BOT_TOKEN: (bot) => `discord_token_${bot || "bot"}`,
  TELEGRAM_BOT_TOKEN: (bot) => `telegram_bot_token_${bot || "bot"}`,
  SLACK_BOT_TOKEN: (bot) => `slack_bot_token_${bot || "bot"}`,
  SLACK_APP_TOKEN: (bot) => `slack_app_token_${bot || "bot"}`,
};

export function suggestSecretNameForEnvVar(envVar: string, bot?: string): string {
  const key = String(envVar || "").trim();
  if (!key) return "";
  const direct = ENV_VAR_SECRET_NAME_SUGGESTIONS[key];
  if (direct) return direct(bot);
  return key.toLowerCase();
}

export function extractEnvVarRef(value: string): string | null {
  const match = value.trim().match(ENV_REF_RE);
  return match ? match[1] || null : null;
}

export function pickPrimarySource(sources: Set<SecretSource>): SecretSource {
  for (const source of SOURCE_PRIORITY) {
    if (sources.has(source)) return source;
  }
  return "custom";
}

export function recordSecretSpec(
  map: Map<string, SecretSpecAccumulator>,
  params: {
    name: string;
    kind: SecretSpec["kind"];
    scope: SecretSpec["scope"];
    source: SecretSource;
    optional: boolean;
    envVar?: string;
    bot?: string;
    help?: string;
    fileId?: string;
  },
): void {
  const key = params.name;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      name: params.name,
      kind: params.kind,
      scope: params.scope,
      sources: new Set([params.source]),
      envVars: new Set(params.envVar ? [params.envVar] : []),
      bots: new Set(params.bot ? [params.bot] : []),
      help: params.help,
      optional: params.optional,
      fileId: params.fileId,
    });
    return;
  }

  existing.sources.add(params.source);
  if (params.envVar) existing.envVars.add(params.envVar);
  if (params.bot) existing.bots.add(params.bot);
  if (params.help && !existing.help) existing.help = params.help;
  if (!params.optional) existing.optional = false;
  if (existing.scope !== params.scope) {
    existing.scope = existing.scope === "host" || params.scope === "host" ? "host" : "bot";
  }
  if (!existing.fileId && params.fileId) existing.fileId = params.fileId;
}

export function normalizeEnvVarPaths(pathsByVar: Record<string, string[]>): void {
  for (const [envVar, paths] of Object.entries(pathsByVar)) {
    if (!paths || paths.length === 0) continue;
    pathsByVar[envVar] = Array.from(new Set(paths)).sort();
  }
}
