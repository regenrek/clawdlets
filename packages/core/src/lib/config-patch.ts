export const CHANNEL_PRESETS = ["discord", "telegram", "slack", "whatsapp"] as const;
export type ChannelPreset = (typeof CHANNEL_PRESETS)[number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (isPlainObject(existing)) return existing;
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function setEnvRef(params: {
  obj: Record<string, unknown>;
  key: string;
  envVar: string;
  pathLabel: string;
}) {
  const envRef = `\${${params.envVar}}`;
  const existing = params.obj[params.key];

  if (existing === undefined || existing === null || existing === "") {
    params.obj[params.key] = envRef;
    return;
  }

  if (typeof existing !== "string") {
    throw new Error(`${params.pathLabel} must be a string env ref like ${envRef}`);
  }

  if (existing !== envRef) {
    throw new Error(
      `${params.pathLabel} already set; remove the inline value and set it to ${envRef} (secrets must be env-wired)`,
    );
  }
}

export function applyChannelPreset(params: {
  clawdbot: unknown;
  preset: ChannelPreset;
}): { clawdbot: Record<string, unknown>; warnings: string[] } {
  const base = isPlainObject(params.clawdbot) ? params.clawdbot : {};
  const clawdbot = structuredClone(base) as Record<string, unknown>;
  const warnings: string[] = [];

  const channels = ensureObject(clawdbot, "channels");

  if (params.preset === "discord") {
    const discord = ensureObject(channels, "discord");
    discord["enabled"] = true;
    setEnvRef({ obj: discord, key: "token", envVar: "DISCORD_BOT_TOKEN", pathLabel: "channels.discord.token" });
  }

  if (params.preset === "telegram") {
    const telegram = ensureObject(channels, "telegram");
    telegram["enabled"] = true;
    setEnvRef({ obj: telegram, key: "botToken", envVar: "TELEGRAM_BOT_TOKEN", pathLabel: "channels.telegram.botToken" });
  }

  if (params.preset === "slack") {
    const slack = ensureObject(channels, "slack");
    slack["enabled"] = true;
    setEnvRef({ obj: slack, key: "botToken", envVar: "SLACK_BOT_TOKEN", pathLabel: "channels.slack.botToken" });
    setEnvRef({ obj: slack, key: "appToken", envVar: "SLACK_APP_TOKEN", pathLabel: "channels.slack.appToken" });
  }

  if (params.preset === "whatsapp") {
    const whatsapp = ensureObject(channels, "whatsapp");
    whatsapp["enabled"] = true;
    warnings.push("WhatsApp requires stateful login on the gateway host (clawdbot channels login).");
  }

  return { clawdbot, warnings };
}

