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
