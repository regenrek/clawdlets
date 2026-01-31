import { getProviderRequiredEnvVars } from "@clawdlets/shared/lib/llm-provider-env";
import { assertSafeRecordKey, createNullProtoRecord } from "./safe-record.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return createNullProtoRecord<string>();
  const out = createNullProtoRecord<string>();
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") continue;
    const key = String(k || "").trim();
    const vv = v.trim();
    if (!key || !vv) continue;
    assertSafeRecordKey({ key, context: "migrate string record" });
    out[key] = vv;
  }
  return out;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (isPlainObject(existing)) return existing;
  assertSafeRecordKey({ key, context: "migrate ensureObject" });
  const next = createNullProtoRecord<unknown>();
  parent[key] = next;
  return next;
}

function ensureStringRecord(parent: Record<string, unknown>, key: string): Record<string, string> {
  const existing = parent[key];
  assertSafeRecordKey({ key, context: "migrate ensureStringRecord" });
  if (isPlainObject(existing)) {
    const sanitized = toStringRecord(existing);
    parent[key] = sanitized;
    return sanitized;
  }
  const next = createNullProtoRecord<string>();
  parent[key] = next;
  return next;
}

function applyProviderSecretsToEnv(params: { env: Record<string, string>; providerSecrets: Record<string, string> }): boolean {
  let changed = false;
  for (const [provider, secretName] of Object.entries(params.providerSecrets)) {
    const envVars = getProviderRequiredEnvVars(provider);
    for (const envVar of envVars) {
      if (!params.env[envVar]) {
        params.env[envVar] = secretName;
        changed = true;
      }
    }
  }
  return changed;
}

function ensureDiscordTokenEnvRef(botCfg: Record<string, unknown>): boolean {
  const clawdbot = botCfg["clawdbot"];
  if (!isPlainObject(clawdbot)) return false;
  const channels = clawdbot["channels"];
  if (!isPlainObject(channels)) return false;
  const discord = channels["discord"];
  if (!isPlainObject(discord)) return false;

  const enabled = discord["enabled"];
  if (enabled === false) return false;

  const token = discord["token"];
  if (typeof token === "string" && token.trim()) return false;

  discord["token"] = "${DISCORD_BOT_TOKEN}";
  return true;
}

export type MigrateToV9Result = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: unknown;
};

export type MigrateToV10Result = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: unknown;
};

export function migrateClawdletsConfigToV9(raw: unknown): MigrateToV9Result {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  const next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 9) return { ok: true, changed: false, warnings, migrated: next };
  if (schemaVersion !== 8) throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected 8)`);

  let changed = false;
  next["schemaVersion"] = 9;
  changed = true;

  const fleet = ensureObject(next, "fleet");

  const fleetSecretEnv = ensureStringRecord(fleet, "secretEnv");
  const fleetSecretFiles = ensureObject(fleet, "secretFiles");
  void fleetSecretFiles;

  if ("guildId" in fleet) {
    delete (fleet as any).guildId;
    changed = true;
  }

  if ("envSecrets" in fleet) {
    const legacy = toStringRecord((fleet as any).envSecrets);
    for (const [envVar, secretName] of Object.entries(legacy)) {
      if (!fleetSecretEnv[envVar]) fleetSecretEnv[envVar] = secretName;
    }
    delete (fleet as any).envSecrets;
    changed = true;
  }

  if ("modelSecrets" in fleet) {
    const legacy = toStringRecord((fleet as any).modelSecrets);
    if (applyProviderSecretsToEnv({ env: fleetSecretEnv, providerSecrets: legacy })) changed = true;
    delete (fleet as any).modelSecrets;
    changed = true;
  }

  const bots = ensureObject(fleet, "bots");
  for (const [botId, botCfgRaw] of Object.entries(bots)) {
    if (!isPlainObject(botCfgRaw)) continue;
    const botCfg = botCfgRaw as Record<string, unknown>;
    const profile = ensureObject(botCfg, "profile");
    const profileSecretEnv = ensureStringRecord(profile, "secretEnv");
    const profileSecretFiles = ensureObject(profile, "secretFiles");
    void profileSecretFiles;

    if ("envSecrets" in profile) {
      const legacy = toStringRecord((profile as any).envSecrets);
      for (const [envVar, secretName] of Object.entries(legacy)) {
        if (!profileSecretEnv[envVar]) profileSecretEnv[envVar] = secretName;
      }
      delete (profile as any).envSecrets;
      changed = true;
    }

    const discordTokenSecret = typeof (profile as any).discordTokenSecret === "string" ? String((profile as any).discordTokenSecret).trim() : "";
    if (discordTokenSecret) {
      if (!profileSecretEnv["DISCORD_BOT_TOKEN"]) profileSecretEnv["DISCORD_BOT_TOKEN"] = discordTokenSecret;
      else if (profileSecretEnv["DISCORD_BOT_TOKEN"] !== discordTokenSecret) {
        warnings.push(`bot ${botId}: discordTokenSecret differs from profile.secretEnv.DISCORD_BOT_TOKEN; keeping secretEnv`);
      }
      delete (profile as any).discordTokenSecret;
      changed = true;

      if (ensureDiscordTokenEnvRef(botCfg)) changed = true;
    }

    if ("modelSecrets" in profile) {
      const legacy = toStringRecord((profile as any).modelSecrets);
      if (applyProviderSecretsToEnv({ env: profileSecretEnv, providerSecrets: legacy })) changed = true;
      delete (profile as any).modelSecrets;
      changed = true;
    }
  }

  return { ok: true, changed, warnings, migrated: next };
}

export function migrateClawdletsConfigToV10(raw: unknown): MigrateToV10Result {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  let next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 10) return { ok: true, changed: false, warnings, migrated: next };

  let changed = false;
  if (schemaVersion === 8) {
    const res = migrateClawdletsConfigToV9(next);
    warnings.push(...res.warnings);
    next = structuredClone(res.migrated) as Record<string, unknown>;
    changed = res.changed;
  } else if (schemaVersion !== 9) {
    throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected 8 or 9)`);
  }

  if (Number(next["schemaVersion"] ?? 0) === 10) {
    return { ok: true, changed, warnings, migrated: next };
  }

  next["schemaVersion"] = 10;
  changed = true;

  const fleet = ensureObject(next, "fleet");
  const fleetAuthorized = new Set(toStringArray((fleet as any).sshAuthorizedKeys));
  const fleetKnown = new Set(toStringArray((fleet as any).sshKnownHosts));
  (fleet as any).sshAuthorizedKeys = Array.from(fleetAuthorized);
  (fleet as any).sshKnownHosts = Array.from(fleetKnown);

  const hosts = (next as any).hosts;
  if (isPlainObject(hosts)) {
    for (const [host, hostCfg] of Object.entries(hosts)) {
      if (!isPlainObject(hostCfg)) continue;
      const hostKeys = toStringArray((hostCfg as any).sshAuthorizedKeys);
      const hostKnown = toStringArray((hostCfg as any).sshKnownHosts);
      if (hostKeys.length || hostKnown.length) {
        for (const key of hostKeys) fleetAuthorized.add(key);
        for (const entry of hostKnown) fleetKnown.add(entry);
        warnings.push(`host ${host}: moved sshAuthorizedKeys/sshKnownHosts to fleet scope`);
        delete (hostCfg as any).sshAuthorizedKeys;
        delete (hostCfg as any).sshKnownHosts;
        changed = true;
      }
    }
  }

  (fleet as any).sshAuthorizedKeys = Array.from(fleetAuthorized);
  (fleet as any).sshKnownHosts = Array.from(fleetKnown);

  return { ok: true, changed, warnings, migrated: next };
}
