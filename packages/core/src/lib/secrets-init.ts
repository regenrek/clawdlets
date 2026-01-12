export type SecretsInitJson = {
  adminPasswordHash: string;
  tailscaleAuthKey?: string;
  secrets?: Record<string, string>;
  discordTokens: Record<string, string>;
};

export function isPlaceholderSecretValue(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  if (s === "<OPTIONAL>") return false;
  return /^<[^>]+>$/.test(s);
}

export function listSecretsInitPlaceholders(params: {
  input: SecretsInitJson;
  bots: string[];
  requiresTailscaleAuthKey: boolean;
}): string[] {
  const out = new Set<string>();

  if (isPlaceholderSecretValue(params.input.adminPasswordHash)) out.add("adminPasswordHash");

  if (params.requiresTailscaleAuthKey && params.input.tailscaleAuthKey && isPlaceholderSecretValue(params.input.tailscaleAuthKey)) {
    out.add("tailscaleAuthKey");
  }

  if (params.input.secrets && typeof params.input.secrets === "object") {
    for (const [k, v] of Object.entries(params.input.secrets)) {
      if (typeof v !== "string") continue;
      if (v && isPlaceholderSecretValue(v)) out.add(`secrets.${k}`);
    }
  }

  const bots = Array.from(new Set(params.bots.map((b) => String(b).trim()).filter(Boolean)));
  for (const b of bots) {
    const v = params.input.discordTokens?.[b];
    if (v && isPlaceholderSecretValue(v)) out.add(`discordTokens.${b}`);
  }

  return Array.from(out).sort();
}

export function buildSecretsInitTemplate(params: {
  bots: string[];
  requiresTailscaleAuthKey: boolean;
  secrets?: Record<string, string>;
}): SecretsInitJson {
  const bots = Array.from(new Set(params.bots.map((b) => String(b).trim()).filter(Boolean)));
  const secrets = params.secrets && typeof params.secrets === "object" ? params.secrets : undefined;
  const hasSecrets = secrets && Object.keys(secrets).length > 0;
  return {
    adminPasswordHash: "<REPLACE_WITH_YESCRYPT_HASH>",
    ...(params.requiresTailscaleAuthKey ? { tailscaleAuthKey: "<REPLACE_WITH_TSKEY_AUTH>" } : {}),
    discordTokens: Object.fromEntries(bots.map((b) => [b, "<REPLACE_WITH_DISCORD_TOKEN>"])),
    ...(hasSecrets ? { secrets } : {}),
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

  const secrets: Record<string, string> = {};
  if (obj.secrets && typeof obj.secrets === "object" && !Array.isArray(obj.secrets)) {
    for (const [k, v] of Object.entries(obj.secrets)) {
      if (typeof v !== "string") continue;
      const token = v.trim();
      if (!token) continue;
      secrets[String(k)] = token;
    }
  }

  return { adminPasswordHash, tailscaleAuthKey, discordTokens, ...(Object.keys(secrets).length > 0 ? { secrets } : {}) };
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
