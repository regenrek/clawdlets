export type SecretsInitJson = {
  adminPasswordHash: string;
  tailscaleAuthKey?: string;
  zAiApiKey?: string;
  discordTokens: Record<string, string>;
};

export function buildSecretsInitTemplate(params: {
  bots: string[];
  requiresTailscaleAuthKey: boolean;
}): SecretsInitJson {
  const bots = Array.from(new Set(params.bots.map((b) => String(b).trim()).filter(Boolean)));
  return {
    adminPasswordHash: "<REPLACE_WITH_YESCRYPT_HASH>",
    ...(params.requiresTailscaleAuthKey ? { tailscaleAuthKey: "<REPLACE_WITH_TSKEY_AUTH>" } : {}),
    zAiApiKey: "<OPTIONAL>",
    discordTokens: Object.fromEntries(bots.map((b) => [b, "<REPLACE_WITH_DISCORD_TOKEN>"])),
  };
}

export function parseSecretsInitJson(raw: string): SecretsInitJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid --from-json (expected valid JSON)");
  }

  if (!parsed || typeof parsed !== "object") throw new Error("invalid --from-json (expected JSON object)");

  const obj = parsed as any;

  const adminPasswordHash = typeof obj.adminPasswordHash === "string" ? obj.adminPasswordHash.trim() : "";
  if (!adminPasswordHash) throw new Error("invalid --from-json (missing adminPasswordHash)");

  if (!obj.discordTokens || typeof obj.discordTokens !== "object") throw new Error("invalid --from-json (missing discordTokens object)");
  const discordTokens: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj.discordTokens)) {
    if (typeof v !== "string") continue;
    const token = v.trim();
    if (!token) continue;
    discordTokens[String(k)] = token;
  }

  const tailscaleAuthKey = typeof obj.tailscaleAuthKey === "string" ? obj.tailscaleAuthKey.trim() : undefined;
  const zAiApiKey = typeof obj.zAiApiKey === "string" ? obj.zAiApiKey.trim() : undefined;

  return { adminPasswordHash, tailscaleAuthKey, zAiApiKey, discordTokens };
}

export function validateSecretsInitNonInteractive(params: {
  interactive: boolean;
  fromJson: string | undefined;
  yes: boolean;
  dryRun: boolean;
  localSecretsDirExists: boolean;
}): void {
  if (params.interactive) return;

  if (!params.fromJson) throw new Error("non-interactive secrets init requires --from-json <path|->");

  if (params.localSecretsDirExists && !params.yes && !params.dryRun) {
    throw new Error("refusing to overwrite existing secrets without --yes (or pass --dry-run)");
  }
}
