function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

function readBotRoutingV6(v: unknown): { channels: string[]; requireMention: boolean } {
  const o = asRecord(v);
  const channels = asStringArray(o.channels);
  const requireMention = o.requireMention === false ? false : true;
  return { channels: Array.from(new Set(channels)), requireMention };
}

function recursiveMerge(base: any, override: any): any {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const bv = (out as any)[k];
    if (isPlainObject(bv) && isPlainObject(v)) out[k] = recursiveMerge(bv, v);
    else out[k] = v;
  }
  return out;
}

export function migrateClawdletsConfigV6ToV7(raw: unknown): unknown {
  const root = asRecord(raw);
  const schemaVersion = (root as any).schemaVersion;
  if (schemaVersion !== 6) throw new Error(`expected schemaVersion=6, got: ${schemaVersion}`);

  const fleet6 = asRecord((root as any).fleet);
  const botOverrides6 = asRecord(fleet6.botOverrides);
  const routingOverrides6 = asRecord(fleet6.routingOverrides);
  const guildId = String(fleet6.guildId ?? "").trim();

  const botsFromList = asStringArray(fleet6.bots);
  const botsFromOverrides = Object.keys(botOverrides6).map((b) => String(b ?? "").trim()).filter(Boolean);
  const botOrder: string[] = [];
  const seen = new Set<string>();
  for (const b of botsFromList) {
    if (seen.has(b)) continue;
    botOrder.push(b);
    seen.add(b);
  }
  for (const b of botsFromOverrides.sort()) {
    if (seen.has(b)) continue;
    botOrder.push(b);
    seen.add(b);
  }

  const bots7: Record<string, unknown> = {};
  for (const bot of botOrder) {
    const override = asRecord((botOverrides6 as any)[bot]);

    const passthrough = asRecord((override as any).passthrough);
    const profile: Record<string, unknown> = { ...override };
    delete (profile as any).passthrough;

    const routing = readBotRoutingV6((routingOverrides6 as any)[bot]);
    const derivedDiscord =
      guildId && routing.channels.length > 0
        ? {
            channels: {
              discord: {
                enabled: true,
                token: "${DISCORD_BOT_TOKEN}",
                guilds: {
                  [guildId]: {
                    requireMention: routing.requireMention,
                    channels: Object.fromEntries(
                      routing.channels.map((ch) => [ch, { allow: true, requireMention: routing.requireMention }]),
                    ),
                  },
                },
              },
            },
          }
        : {};

    const clawdbot = recursiveMerge(derivedDiscord, passthrough);

    bots7[bot] = {
      ...(Object.keys(profile).length > 0 ? { profile } : {}),
      ...(Object.keys(clawdbot).length > 0 ? { clawdbot } : {}),
    };
  }

  const fleet7 = {
    envSecrets: asRecord(fleet6.envSecrets),
    botOrder,
    bots: bots7,
    codex: asRecord(fleet6.codex),
    backups: asRecord(fleet6.backups),
  };

  return {
    ...root,
    schemaVersion: 7,
    fleet: fleet7,
  };
}

