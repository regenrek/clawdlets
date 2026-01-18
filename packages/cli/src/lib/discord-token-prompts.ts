import type { FleetEnvSecretsPlan } from "@clawdlets/core/lib/fleet-env-secrets";

export type DiscordTokenPrompt = {
  bot: string;
  secretName: string;
};

export function getDiscordTokenPromptBots(params: {
  bots: string[];
  envPlan: FleetEnvSecretsPlan;
  requiredExtraSecretNames: Set<string>;
}): DiscordTokenPrompt[] {
  const out: DiscordTokenPrompt[] = [];
  for (const bot of params.bots) {
    const envSecrets = params.envPlan.envSecretsByBot[bot] || {};
    const mapped = String((envSecrets as any).DISCORD_BOT_TOKEN || "").trim();
    const secretName = mapped || `discord_token_${bot}`;
    if (params.requiredExtraSecretNames.has(secretName)) continue;
    out.push({ bot, secretName });
  }
  return out;
}
