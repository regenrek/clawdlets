import { applySecurityDefaults } from "./config-patch.js";

export type CapabilityPresetKind = "channel" | "model" | "security" | "plugin";

export type EnvVarRef = {
  path: string;
  envVar: string;
};

export type CapabilityPreset = {
  id: string;
  title: string;
  kind: CapabilityPresetKind;
  patch: Record<string, unknown>;
  requiredEnv?: string[];
  envVarRefs?: EnvVarRef[];
  warnings?: string[];
  docsUrl?: string;
};

export type CapabilityPresetApplyResult = {
  clawdbot: Record<string, unknown>;
  warnings: string[];
  requiredEnv: string[];
  envVarRefs: EnvVarRef[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function titleCase(value: string): string {
  return value
    .split(/[_-]/g)
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function applyMergePatch(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const baseObj = isPlainObject(base) ? base : {};
  const next: Record<string, unknown> = { ...baseObj };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
      continue;
    }
    if (isPlainObject(value)) {
      next[key] = applyMergePatch(baseObj[key], value);
      continue;
    }
    next[key] = value;
  }
  return next;
}

function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cursor: any = obj;
  for (const part of parts) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function ensureObjectAtPath(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  const parts = path.split(".").filter(Boolean);
  let cursor: Record<string, unknown> = obj;
  for (const part of parts) {
    const next = cursor[part];
    if (!isPlainObject(next)) {
      const fresh: Record<string, unknown> = {};
      cursor[part] = fresh;
      cursor = fresh;
      continue;
    }
    cursor = next;
  }
  return cursor;
}

function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  const key = parts.pop()!;
  const parent = ensureObjectAtPath(obj, parts.join("."));
  parent[key] = value;
}

function ensureEnvRef(obj: Record<string, unknown>, envRef: EnvVarRef): void {
  const refValue = `\${${envRef.envVar}}`;
  const current = getAtPath(obj, envRef.path);
  if (current === undefined || current === null || current === "") {
    setAtPath(obj, envRef.path, refValue);
    return;
  }
  if (typeof current !== "string") {
    throw new Error(`${envRef.path} must be a string env ref like ${refValue}`);
  }
  if (current !== refValue) {
    throw new Error(`${envRef.path} already set; remove inline value and use ${refValue}`);
  }
}

const CHANNEL_PRESETS: Record<string, CapabilityPreset> = {
  discord: {
    id: "channel.discord",
    title: "Discord",
    kind: "channel",
    patch: {
      channels: {
        discord: {
          enabled: true,
          token: "${DISCORD_BOT_TOKEN}",
        },
      },
    },
    requiredEnv: ["DISCORD_BOT_TOKEN"],
    envVarRefs: [{ path: "channels.discord.token", envVar: "DISCORD_BOT_TOKEN" }],
  },
  telegram: {
    id: "channel.telegram",
    title: "Telegram",
    kind: "channel",
    patch: {
      channels: {
        telegram: {
          enabled: true,
          botToken: "${TELEGRAM_BOT_TOKEN}",
        },
      },
    },
    requiredEnv: ["TELEGRAM_BOT_TOKEN"],
    envVarRefs: [{ path: "channels.telegram.botToken", envVar: "TELEGRAM_BOT_TOKEN" }],
  },
  slack: {
    id: "channel.slack",
    title: "Slack",
    kind: "channel",
    patch: {
      channels: {
        slack: {
          enabled: true,
          botToken: "${SLACK_BOT_TOKEN}",
          appToken: "${SLACK_APP_TOKEN}",
        },
      },
    },
    requiredEnv: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
    envVarRefs: [
      { path: "channels.slack.botToken", envVar: "SLACK_BOT_TOKEN" },
      { path: "channels.slack.appToken", envVar: "SLACK_APP_TOKEN" },
    ],
  },
  whatsapp: {
    id: "channel.whatsapp",
    title: "WhatsApp",
    kind: "channel",
    patch: {
      channels: {
        whatsapp: {
          enabled: true,
        },
      },
    },
    warnings: ["WhatsApp requires stateful login on the gateway host (clawdbot channels login)."],
  },
};

export function getChannelCapabilityPreset(channelId: string): CapabilityPreset {
  const normalized = channelId.trim().toLowerCase();
  if (!normalized) {
    throw new Error("invalid channel id");
  }
  const existing = CHANNEL_PRESETS[normalized];
  if (existing) return existing;
  return {
    id: `channel.${normalized}`,
    title: titleCase(normalized),
    kind: "channel",
    patch: {
      channels: {
        [normalized]: {
          enabled: true,
        },
      },
    },
  };
}

export function applyCapabilityPreset(params: {
  clawdbot: unknown;
  preset: CapabilityPreset;
}): CapabilityPresetApplyResult {
  const base = isPlainObject(params.clawdbot) ? params.clawdbot : {};
  const envVarRefs = params.preset.envVarRefs ?? [];
  for (const ref of envVarRefs) {
    const current = getAtPath(base, ref.path);
    const refValue = `\${${ref.envVar}}`;
    if (current === undefined || current === null || current === "") continue;
    if (typeof current !== "string") {
      throw new Error(`${ref.path} must be a string env ref like ${refValue}`);
    }
    if (current !== refValue) {
      throw new Error(`${ref.path} already set; remove inline value and use ${refValue}`);
    }
  }
  const patched = applyMergePatch(structuredClone(base), params.preset.patch) as Record<string, unknown>;
  for (const ref of envVarRefs) ensureEnvRef(patched, ref);
  const hardened = applySecurityDefaults({ clawdbot: patched });
  return {
    clawdbot: hardened.clawdbot,
    warnings: [...(params.preset.warnings ?? []), ...hardened.warnings],
    requiredEnv: params.preset.requiredEnv ?? [],
    envVarRefs,
  };
}
