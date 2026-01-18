import { describe, expect, it } from "vitest";
import { buildFleetEnvSecretsPlan } from "@clawdlets/core/lib/fleet-env-secrets";
import { createDefaultClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config";
import { getDiscordTokenPromptBots } from "../src/lib/discord-token-prompts.js";

describe("getDiscordTokenPromptBots", () => {
  it("skips bots when discord token secret is already required", () => {
    const config = createDefaultClawdletsConfig({ host: "clawdbot-fleet-host", bots: ["gunnar"] });
    (config.fleet.bots as any).gunnar = {
      profile: { envSecrets: { DISCORD_BOT_TOKEN: "discord_token_gunnar" } },
      clawdbot: { channels: { discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" } } },
    };
    const envPlan = buildFleetEnvSecretsPlan({ config, hostName: "clawdbot-fleet-host" });
    const requiredExtraSecretNames = new Set(envPlan.secretNamesRequired);
    const prompts = getDiscordTokenPromptBots({ bots: envPlan.bots, envPlan, requiredExtraSecretNames });
    expect(prompts).toEqual([]);
  });

  it("keeps bots when discord token is optional", () => {
    const config = createDefaultClawdletsConfig({ host: "clawdbot-fleet-host", bots: ["gunnar"] });
    (config.fleet.bots as any).gunnar = {
      profile: { envSecrets: { DISCORD_BOT_TOKEN: "discord_token_gunnar" } },
      clawdbot: { channels: { discord: { enabled: false, token: "${DISCORD_BOT_TOKEN}" } } },
    };
    const envPlan = buildFleetEnvSecretsPlan({ config, hostName: "clawdbot-fleet-host" });
    const requiredExtraSecretNames = new Set(envPlan.secretNamesRequired);
    const prompts = getDiscordTokenPromptBots({ bots: envPlan.bots, envPlan, requiredExtraSecretNames });
    expect(prompts).toEqual([{ bot: "gunnar", secretName: "discord_token_gunnar" }]);
  });
});
