export function assertNoLegacyHostKeys(parsed: unknown): void {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  const hostsRaw = (parsed as { hosts?: unknown }).hosts;
  if (!hostsRaw || typeof hostsRaw !== "object" || Array.isArray(hostsRaw)) return;
  for (const [host, hostCfg] of Object.entries(hostsRaw as Record<string, unknown>)) {
    if (!hostCfg || typeof hostCfg !== "object" || Array.isArray(hostCfg)) continue;
    if ("publicSsh" in hostCfg) {
      throw new Error(`legacy host config key publicSsh found for ${host}; use sshExposure.mode`);
    }
    if ("opentofu" in hostCfg) {
      throw new Error(`legacy host config key opentofu found for ${host}; use provisioning`);
    }
    if ("sshAuthorizedKeys" in hostCfg || "sshKnownHosts" in hostCfg) {
      throw new Error(
        `host SSH keys are now project-scoped; move hosts.${host}.sshAuthorizedKeys/sshKnownHosts to fleet.sshAuthorizedKeys/sshKnownHosts`,
      );
    }
  }
}

export function assertNoLegacyEnvSecrets(parsed: unknown): void {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  const fleet = (parsed as { fleet?: unknown }).fleet as any;
  if (fleet && typeof fleet === "object" && !Array.isArray(fleet)) {
    if ("envSecrets" in fleet) {
      throw new Error("fleet.envSecrets was removed; use fleet.secretEnv (ENV_VAR -> sops secret name)");
    }
    if ("modelSecrets" in fleet) {
      throw new Error("fleet.modelSecrets was removed; use fleet.secretEnv (e.g. OPENAI_API_KEY -> openai_api_key)");
    }
    if ("guildId" in fleet) {
      throw new Error("fleet.guildId was removed; configure Discord in clawdbot config (fleet.bots.<bot>.clawdbot)");
    }
    const bots = fleet.bots;
    if (bots && typeof bots === "object" && !Array.isArray(bots)) {
      for (const [bot, botCfg] of Object.entries(bots as Record<string, unknown>)) {
        if (!botCfg || typeof botCfg !== "object" || Array.isArray(botCfg)) continue;
        const profile = (botCfg as any).profile;
        if (profile && typeof profile === "object" && !Array.isArray(profile)) {
          if ("envSecrets" in profile) {
            throw new Error(
              `fleet.bots.${bot}.profile.envSecrets was removed; use profile.secretEnv (ENV_VAR -> sops secret name)`,
            );
          }
          if ("discordTokenSecret" in profile) {
            throw new Error(
              `fleet.bots.${bot}.profile.discordTokenSecret was removed; use profile.secretEnv.DISCORD_BOT_TOKEN`,
            );
          }
          if ("modelSecrets" in profile) {
            throw new Error(
              `fleet.bots.${bot}.profile.modelSecrets was removed; use profile.secretEnv (OPENAI_API_KEY/ANTHROPIC_API_KEY/etc)`,
            );
          }
          const skills = (profile as any).skills;
          const entries = skills?.entries;
          if (entries && typeof entries === "object" && !Array.isArray(entries)) {
            for (const [skill, entry] of Object.entries(entries as Record<string, unknown>)) {
              if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
              if ("envSecrets" in (entry as any)) {
                throw new Error(
                  `fleet.bots.${bot}.profile.skills.entries.${skill}.envSecrets was removed; use apiKeySecret or inline config`,
                );
              }
            }
          }
        }
      }
    }
  }
}
