import fs from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "./fs-safe.js";
import type { RepoLayout } from "../repo-layout.js";
import { getRepoLayout } from "../repo-layout.js";
import { BotIdSchema, HostNameSchema, assertSafeHostName } from "./identifiers.js";

export const CLAWDLETS_CONFIG_SCHEMA_VERSION = 2 as const;

const JsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.any());

const FleetSchema = z.object({
  guildId: z.string().trim().default(""),
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
  fleet: FleetSchema.default({}),
  hosts: z.record(HostNameSchema, HostSchema).refine((v) => Object.keys(v).length > 0, {
    message: "hosts must not be empty",
  }),
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
    fleet: {
      guildId: "",
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
        publicSsh: { enable: false },
        provisioning: { enable: false },
        tailnet: { mode: "tailscale" },
        agentModelPrimary: "zai/glm-4.7",
      },
    },
  });
}

export function loadClawdletsConfig(params: { repoRoot: string; stackDir?: string }): {
  layout: RepoLayout;
  configPath: string;
  config: ClawdletsConfig;
} {
  const layout = getRepoLayout(params.repoRoot, params.stackDir);
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
