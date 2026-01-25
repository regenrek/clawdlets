import type { ClawdletsConfig } from "./clawdlets-config.js";
import { getAtPath } from "./object-path.js";

const DEFAULT_GATEWAY_PORT_BASE = 18789;
const DEFAULT_GATEWAY_PORT_STRIDE = 20;
const DEFAULT_STATE_DIR_BASE = "/srv/clawdbot";
const DEFAULT_COMMANDS = { native: "auto", nativeSkills: "auto" };

export type ClawdbotInvariantWarning = {
  bot: string;
  path: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toCleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toCleanNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toCleanBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value);
      continue;
    }
    out[key] = structuredClone(value);
  }
  return out;
}

function resolveBotIndex(config: ClawdletsConfig, bot: string): number {
  const bots = Array.isArray(config.fleet.botOrder) ? config.fleet.botOrder : [];
  const index = bots.indexOf(bot);
  if (index === -1) throw new Error(`bot not found in fleet.botOrder: ${bot}`);
  return index;
}

function resolveGatewayPort(params: { config: ClawdletsConfig; bot: string; profile: Record<string, unknown> }): number {
  const override = toCleanNumber(params.profile["gatewayPort"]);
  if (override != null) return Math.floor(override);
  const index = resolveBotIndex(params.config, params.bot);
  return DEFAULT_GATEWAY_PORT_BASE + index * DEFAULT_GATEWAY_PORT_STRIDE;
}

function resolveWorkspaceDir(params: { bot: string; profile: Record<string, unknown> }): string {
  const workspace = isPlainObject(params.profile["workspace"]) ? (params.profile["workspace"] as Record<string, unknown>) : {};
  const dir = toCleanString(workspace["dir"]);
  if (dir) return dir;
  return `${DEFAULT_STATE_DIR_BASE}/${params.bot}/workspace`;
}

function resolveSkipBootstrap(params: { profile: Record<string, unknown> }): boolean {
  const override = toCleanBoolean(params.profile["skipBootstrap"]);
  if (override != null) return override;
  const workspace = isPlainObject(params.profile["workspace"]) ? (params.profile["workspace"] as Record<string, unknown>) : {};
  const seedDir = workspace["seedDir"];
  return seedDir != null && String(seedDir).trim() !== "";
}

function warnOverrides(params: {
  bot: string;
  base: Record<string, unknown>;
  path: string[];
  expected: unknown;
}): ClawdbotInvariantWarning | null {
  const existing = getAtPath(params.base, params.path);
  if (existing === undefined) return null;
  const pathLabel = params.path.join(".");
  const message = `clawdbot.${pathLabel} is managed by clawdlets invariants and will be overwritten`;
  return {
    bot: params.bot,
    path: pathLabel,
    message,
    expected: params.expected,
    actual: existing,
  };
}

export function buildClawdbotBotConfig(params: {
  config: ClawdletsConfig;
  bot: string;
}): {
  bot: string;
  base: Record<string, unknown>;
  merged: Record<string, unknown>;
  invariants: Record<string, unknown>;
  warnings: ClawdbotInvariantWarning[];
} {
  const botCfg = (params.config.fleet.bots as Record<string, unknown> | undefined)?.[params.bot];
  const botCfgObj = isPlainObject(botCfg) ? botCfg : {};
  const profile = isPlainObject(botCfgObj["profile"]) ? (botCfgObj["profile"] as Record<string, unknown>) : {};
  const base = isPlainObject(botCfgObj["clawdbot"]) ? (botCfgObj["clawdbot"] as Record<string, unknown>) : {};
  const baseWithDefaults = deepMerge({ commands: DEFAULT_COMMANDS }, base);

  const gatewayPort = resolveGatewayPort({ config: params.config, bot: params.bot, profile });
  const workspaceDir = resolveWorkspaceDir({ bot: params.bot, profile });
  const skipBootstrap = resolveSkipBootstrap({ profile });

  const invariants: Record<string, unknown> = {
    gateway: {
      mode: "local",
      bind: "loopback",
      port: gatewayPort,
      auth: {
        mode: "token",
        token: "${CLAWDBOT_GATEWAY_TOKEN}",
      },
    },
    agents: {
      defaults: {
        workspace: workspaceDir,
        skipBootstrap,
      },
    },
  };

  const warnings: ClawdbotInvariantWarning[] = [];
  const warn = (path: string[], expected: unknown) => {
    const w = warnOverrides({ bot: params.bot, base, path, expected });
    if (w) warnings.push(w);
  };

  warn(["gateway", "mode"], "local");
  warn(["gateway", "bind"], "loopback");
  warn(["gateway", "port"], gatewayPort);
  warn(["gateway", "auth"], { mode: "token", token: "${CLAWDBOT_GATEWAY_TOKEN}" });
  warn(["agents", "defaults", "workspace"], workspaceDir);
  warn(["agents", "defaults", "skipBootstrap"], skipBootstrap);

  return {
    bot: params.bot,
    base,
    merged: deepMerge(baseWithDefaults, invariants),
    invariants,
    warnings,
  };
}
