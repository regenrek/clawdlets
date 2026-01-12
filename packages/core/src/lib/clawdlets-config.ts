import fs from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "./fs-safe.js";
import type { RepoLayout } from "../repo-layout.js";
import { getRepoLayout } from "../repo-layout.js";
import { BotIdSchema, EnvVarNameSchema, HostNameSchema, SecretNameSchema, assertSafeHostName } from "./identifiers.js";
import { isValidTargetHost } from "./ssh-remote.js";

export const CLAWDLETS_CONFIG_SCHEMA_VERSION = 4 as const;

const JsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.any());

function validateEnvSecretsAtPath(params: { value: unknown; ctx: z.RefinementCtx; path: (string | number)[] }): void {
  if (params.value == null) return;
  if (typeof params.value !== "object" || Array.isArray(params.value)) {
    params.ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: params.path,
      message: "envSecrets must be an object mapping ENV_VAR -> secretName",
    });
    return;
  }

  for (const [rawK, rawV] of Object.entries(params.value as Record<string, unknown>)) {
    const k = String(rawK ?? "").trim();
    const v = typeof rawV === "string" ? rawV.trim() : rawV == null ? "" : String(rawV).trim();

    const kOk = EnvVarNameSchema.safeParse(k);
    if (!kOk.success) {
      params.ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...params.path, rawK],
        message: kOk.error.issues[0]?.message || "invalid env var name",
      });
    }

    const vOk = SecretNameSchema.safeParse(v);
    if (!vOk.success) {
      params.ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...params.path, rawK],
        message: vOk.error.issues[0]?.message || "invalid secret name",
      });
    }
  }
}

const FleetSchema = z.object({
  guildId: z.string().trim().default(""),
  envSecrets: z.record(EnvVarNameSchema, SecretNameSchema).default({}),
  bots: z
    .array(BotIdSchema)
    .default([])
    .superRefine((bots, ctx) => {
      const seen = new Set<string>();
      for (const b of bots) {
        if (seen.has(b)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate bot id: ${b}` });
        seen.add(b);
      }
    }),
  botOverrides: z.record(BotIdSchema, JsonObjectSchema).default({}),
  routingOverrides: z.record(BotIdSchema, JsonObjectSchema).default({}),
  codex: z
    .object({
      enable: z.boolean().default(false),
      bots: z.array(BotIdSchema).default([]),
    })
    .default({ enable: false, bots: [] }),
  backups: z
    .object({
      restic: z
        .object({
          enable: z.boolean().default(false),
          repository: z.string().trim().default(""),
        })
        .default({ enable: false, repository: "" }),
    })
    .default({ restic: { enable: false, repository: "" } }),
});

const HostSchema = z.object({
  enable: z.boolean().default(false),
  diskDevice: z.string().trim().default("/dev/disk/by-id/CHANGE_ME"),
  sshAuthorizedKeys: z.array(z.string().trim().min(1)).default([]),
  flakeHost: z.string().trim().default(""),
  targetHost: z
    .string()
    .trim()
    .min(1)
    .optional()
    .refine((v) => (v ? isValidTargetHost(v) : true), {
      message: "invalid targetHost (expected ssh alias or user@host)",
    }),
  hetzner: z
    .object({
      serverType: z.string().trim().min(1).default("cx43"),
    })
    .default({ serverType: "cx43" }),
  opentofu: z
    .object({
      adminCidr: z.string().trim().default(""),
      sshPubkeyFile: z.string().trim().default("~/.ssh/id_ed25519.pub"),
    })
    .default({ adminCidr: "", sshPubkeyFile: "~/.ssh/id_ed25519.pub" }),
  publicSsh: z
    .object({
      enable: z.boolean().default(false),
    })
    .default({ enable: false }),
  provisioning: z
    .object({
      enable: z.boolean().default(false),
    })
    .default({ enable: false }),
  tailnet: z
    .object({
      mode: z.enum(["none", "tailscale"]).default("tailscale"),
    })
    .default({ mode: "tailscale" }),
  agentModelPrimary: z.string().trim().default("zai/glm-4.7"),
});

export const ClawdletsConfigSchema = z.object({
  schemaVersion: z.literal(CLAWDLETS_CONFIG_SCHEMA_VERSION),
  defaultHost: HostNameSchema.optional(),
  baseFlake: z.string().trim().default(""),
  fleet: FleetSchema.default({}),
  hosts: z.record(HostNameSchema, HostSchema).refine((v) => Object.keys(v).length > 0, {
    message: "hosts must not be empty",
  }),
}).superRefine((cfg, ctx) => {
  if (cfg.defaultHost && !cfg.hosts[cfg.defaultHost]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultHost"],
      message: `defaultHost not found in hosts: ${cfg.defaultHost}`,
    });
  }

  validateEnvSecretsAtPath({
    value: (cfg as any).fleet?.envSecrets,
    ctx,
    path: ["fleet", "envSecrets"],
  });

  const botOverrides = (cfg as any).fleet?.botOverrides;
  if (botOverrides && typeof botOverrides === "object" && !Array.isArray(botOverrides)) {
    for (const [botId, overrides] of Object.entries(botOverrides as Record<string, unknown>)) {
      validateEnvSecretsAtPath({
        value: (overrides as any)?.envSecrets,
        ctx,
        path: ["fleet", "botOverrides", botId, "envSecrets"],
      });
    }
  }
});

export type ClawdletsConfig = z.infer<typeof ClawdletsConfigSchema>;
export type ClawdletsHostConfig = z.infer<typeof HostSchema>;

export const SafeHostNameSchema = HostNameSchema;
export { assertSafeHostName };

export function createDefaultClawdletsConfig(params: { host: string; bots?: string[] }): ClawdletsConfig {
  const host = params.host.trim() || "clawdbot-fleet-host";
  const bots = (params.bots || ["maren", "sonja", "gunnar", "melinda"]).map((b) => b.trim()).filter(Boolean);
  return ClawdletsConfigSchema.parse({
    schemaVersion: CLAWDLETS_CONFIG_SCHEMA_VERSION,
    defaultHost: host,
    baseFlake: "",
    fleet: {
      guildId: "",
      envSecrets: {
        ZAI_API_KEY: "z_ai_api_key",
        Z_AI_API_KEY: "z_ai_api_key",
      },
      bots,
      botOverrides: {},
      routingOverrides: {},
      codex: { enable: false, bots: [] },
      backups: { restic: { enable: false, repository: "" } },
    },
    hosts: {
      [host]: {
        enable: false,
        diskDevice: "/dev/disk/by-id/CHANGE_ME",
        sshAuthorizedKeys: [],
        flakeHost: "",
        hetzner: { serverType: "cx43" },
        opentofu: { adminCidr: "", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
        publicSsh: { enable: false },
        provisioning: { enable: false },
        tailnet: { mode: "tailscale" },
        agentModelPrimary: "zai/glm-4.7",
      },
    },
  });
}

export type ResolveHostNameResult =
  | { ok: true; host: string; source: "flag" | "defaultHost" | "soleHost" }
  | { ok: false; message: string; tips: string[]; availableHosts: string[] };

export function resolveHostName(params: { config: ClawdletsConfig; host?: unknown }): ResolveHostNameResult {
  const availableHosts = Object.keys(params.config.hosts || {});
  const provided = String(params.host ?? "").trim();

  if (provided) {
    try {
      assertSafeHostName(provided);
    } catch (e) {
      return {
        ok: false,
        message: String((e as Error)?.message || e),
        availableHosts,
        tips: [
          "host names must be safe identifiers (no spaces or shell metacharacters)",
          availableHosts.length > 0 ? `available hosts: ${availableHosts.join(", ")}` : "available hosts: (none)",
          `use --host <name> to select a host`,
        ],
      };
    }
    if (params.config.hosts[provided]) {
      return { ok: true, host: provided, source: "flag" };
    }
    return {
      ok: false,
      message: `unknown host: ${provided}`,
      availableHosts,
      tips: [
        availableHosts.length > 0 ? `available hosts: ${availableHosts.join(", ")}` : "available hosts: (none)",
        `use --host <name> to select a host`,
        `set defaultHost via: clawdlets host set-default --host <name>`,
      ],
    };
  }

  if (params.config.defaultHost) {
    return { ok: true, host: params.config.defaultHost, source: "defaultHost" };
  }

  if (availableHosts.length === 1) {
    return { ok: true, host: availableHosts[0]!, source: "soleHost" };
  }

  return {
    ok: false,
    message: "missing host (multiple hosts configured)",
    availableHosts,
    tips: [
      `pass --host <name>`,
      `set defaultHost via: clawdlets host set-default --host <name>`,
      availableHosts.length > 0 ? `available hosts: ${availableHosts.join(", ")}` : "available hosts: (none)",
    ],
  };
}

export function loadClawdletsConfig(params: { repoRoot: string; runtimeDir?: string }): {
  layout: RepoLayout;
  configPath: string;
  config: ClawdletsConfig;
} {
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  const configPath = layout.clawdletsConfigPath;
  if (!fs.existsSync(configPath)) throw new Error(`missing clawdlets config: ${configPath}`);
  const raw = fs.readFileSync(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON: ${configPath}`);
  }
  const config = ClawdletsConfigSchema.parse(parsed);
  return { layout, configPath, config };
}

export async function writeClawdletsConfig(params: { configPath: string; config: ClawdletsConfig }): Promise<void> {
  await writeFileAtomic(params.configPath, `${JSON.stringify(params.config, null, 2)}\n`);
}
