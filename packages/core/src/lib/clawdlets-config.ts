import fs from "node:fs";
import net from "node:net";
import { z } from "zod";
import { writeFileAtomic } from "./fs-safe.js";
import type { RepoLayout } from "../repo-layout.js";
import { getRepoLayout } from "../repo-layout.js";
import { BotIdSchema, EnvVarNameSchema, HostNameSchema, SecretNameSchema, assertSafeHostName } from "./identifiers.js";
import { isValidTargetHost } from "./ssh-remote.js";
import { TtlStringSchema } from "./ttl.js";
import { HcloudLabelsSchema, validateHcloudLabelsAtPath } from "./hcloud-labels.js";

export const SSH_EXPOSURE_MODES = ["tailnet", "bootstrap", "public"] as const;
export const SshExposureModeSchema = z.enum(SSH_EXPOSURE_MODES);
export type SshExposureMode = z.infer<typeof SshExposureModeSchema>;

export const TAILNET_MODES = ["none", "tailscale"] as const;
export const TailnetModeSchema = z.enum(TAILNET_MODES);
export type TailnetMode = z.infer<typeof TailnetModeSchema>;

export const CLAWDLETS_CONFIG_SCHEMA_VERSION = 7 as const;

const JsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.any());

function parseCidr(value: string): { ip: string; prefix: number; family: 4 | 6 } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [ip, prefixRaw] = trimmed.split("/");
  if (!ip || !prefixRaw) return null;
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix)) return null;
  const family = net.isIP(ip);
  if (family === 4 && prefix >= 0 && prefix <= 32) return { ip, prefix, family: 4 };
  if (family === 6 && prefix >= 0 && prefix <= 128) return { ip, prefix, family: 6 };
  return null;
}

function isWorldOpenCidr(parsed: { ip: string; prefix: number; family: 4 | 6 }): boolean {
  if (parsed.family === 4) return parsed.ip === "0.0.0.0" && parsed.prefix === 0;
  return (parsed.ip === "::" || parsed.ip === "0:0:0:0:0:0:0:0") && parsed.prefix === 0;
}

const FleetBotProfileSchema = z
  .object({
    envSecrets: z.record(EnvVarNameSchema, SecretNameSchema).default(() => ({})),
  })
  .passthrough()
  .default(() => ({}));

const FleetBotSchema = z
  .object({
    profile: FleetBotProfileSchema,
    clawdbot: JsonObjectSchema.default(() => ({})),
    clf: JsonObjectSchema.default(() => ({})),
  })
  .passthrough()
  .default(() => ({}));

const FleetSchema = z
  .object({
    envSecrets: z.record(EnvVarNameSchema, SecretNameSchema).default(() => ({})),
    botOrder: z.array(BotIdSchema).default(() => []),
    bots: z.record(BotIdSchema, FleetBotSchema).default(() => ({})),
    codex: z
      .object({
        enable: z.boolean().default(false),
        bots: z.array(BotIdSchema).default(() => []),
      })
      .default(() => ({ enable: false, bots: [] })),
    backups: z
      .object({
        restic: z
          .object({
            enable: z.boolean().default(false),
            repository: z.string().trim().default(""),
          })
          .default(() => ({ enable: false, repository: "" })),
      })
      .default(() => ({ restic: { enable: false, repository: "" } })),
  })
  .superRefine((fleet, ctx) => {
    const botIds = Object.keys(fleet.bots || {});
    const botOrder = fleet.botOrder || [];

    const seen = new Set<string>();
    for (let i = 0; i < botOrder.length; i++) {
      const b = botOrder[i]!;
      if (seen.has(b)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["botOrder", i], message: `duplicate bot id: ${b}` });
        continue;
      }
      seen.add(b);
      if (!fleet.bots[b]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["botOrder", i], message: `unknown bot id: ${b}` });
      }
    }

    if (botIds.length > 0 && botOrder.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["botOrder"],
        message: "botOrder must be set (deterministic order for ports/services)",
      });
      return;
    }

    const missing = botIds.filter((b) => !seen.has(b));
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["botOrder"],
        message: `botOrder missing bots: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` (+${missing.length - 6})` : ""}`,
      });
    }
  });

const HostSchema = z.object({
  enable: z.boolean().default(false),
  diskDevice: z.string().trim().default("/dev/sda"),
  sshAuthorizedKeys: z.array(z.string().trim().min(1)).default(() => []),
  sshKnownHosts: z.array(z.string().trim().min(1)).default(() => []),
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
      image: z.string().trim().default(""),
      location: z.string().trim().default("nbg1"),
    })
    .default(() => ({ serverType: "cx43", image: "", location: "nbg1" })),
  provisioning: z
    .object({
      adminCidr: z.string().trim().default(""),
      adminCidrAllowWorldOpen: z.boolean().default(false),
      sshPubkeyFile: z.string().trim().default("~/.ssh/id_ed25519.pub"),
    })
    .superRefine((value, ctx) => {
      const adminCidr = value.adminCidr.trim();
      if (!adminCidr) return;
      const parsed = parseCidr(adminCidr);
      if (!parsed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "provisioning.adminCidr must be a valid CIDR (e.g. 203.0.113.10/32)",
          path: ["adminCidr"],
        });
        return;
      }
      if (isWorldOpenCidr(parsed) && !value.adminCidrAllowWorldOpen) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "provisioning.adminCidr cannot be world-open unless adminCidrAllowWorldOpen is true",
          path: ["adminCidr"],
        });
      }
    })
    .default(() => ({ adminCidr: "", adminCidrAllowWorldOpen: false, sshPubkeyFile: "~/.ssh/id_ed25519.pub" })),
  sshExposure: z
    .object({
      mode: SshExposureModeSchema.default("bootstrap"),
    })
    .default(() => ({ mode: "bootstrap" as const })),
  tailnet: z
    .object({
      mode: TailnetModeSchema.default("tailscale"),
    })
    .default(() => ({ mode: "tailscale" as const })),
  cache: z
    .object({
      garnix: z
        .object({
          private: z
            .object({
              enable: z.boolean().default(false),
              netrcSecret: SecretNameSchema.default("garnix_netrc"),
              netrcPath: z.string().trim().default("/etc/nix/netrc"),
              narinfoCachePositiveTtl: z.number().int().positive().default(3600),
            })
            .default(() => ({
              enable: false,
              netrcSecret: "garnix_netrc",
              netrcPath: "/etc/nix/netrc",
              narinfoCachePositiveTtl: 3600,
            })),
        })
        .default(() => ({
          private: {
            enable: false,
            netrcSecret: "garnix_netrc",
            netrcPath: "/etc/nix/netrc",
            narinfoCachePositiveTtl: 3600,
          },
        })),
    })
    .default(() => ({
      garnix: {
        private: {
          enable: false,
          netrcSecret: "garnix_netrc",
          netrcPath: "/etc/nix/netrc",
          narinfoCachePositiveTtl: 3600,
        },
      },
    })),
  operator: z
    .object({
      deploy: z
        .object({
          enable: z.boolean().default(false),
        })
        .default(() => ({ enable: false })),
    })
    .default(() => ({ deploy: { enable: false } })),
  selfUpdate: z
    .object({
      enable: z.boolean().default(false),
      manifestUrl: z.string().trim().default(""),
      interval: z.string().trim().default("30min"),
      publicKey: z.string().trim().default(""),
      signatureUrl: z.string().trim().default(""),
    })
    .default(() => ({ enable: false, manifestUrl: "", interval: "30min", publicKey: "", signatureUrl: "" })),
  agentModelPrimary: z.string().trim().default("zai/glm-4.7"),
});

const CattleSchema = z
  .object({
    enabled: z.boolean().default(false),
    hetzner: z
      .object({
        image: z.string().trim().default(""),
        serverType: z.string().trim().min(1).default("cx22"),
        location: z.string().trim().min(1).default("nbg1"),
        maxInstances: z.number().int().positive().default(10),
        defaultTtl: TtlStringSchema.default("2h"),
        labels: HcloudLabelsSchema.default(() => ({ "managed-by": "clawdlets" })),
      })
      .default(() => ({
        image: "",
        serverType: "cx22",
        location: "nbg1",
        maxInstances: 10,
        defaultTtl: "2h",
        labels: { "managed-by": "clawdlets" },
      })),
    defaults: z
      .object({
        autoShutdown: z.boolean().default(true),
        callbackUrl: z.string().trim().default(""),
      })
      .default(() => ({ autoShutdown: true, callbackUrl: "" })),
  })
  .default(() => ({
    enabled: false,
    hetzner: {
      image: "",
      serverType: "cx22",
      location: "nbg1",
      maxInstances: 10,
      defaultTtl: "2h",
      labels: { "managed-by": "clawdlets" },
    },
    defaults: { autoShutdown: true, callbackUrl: "" },
  }));

export const ClawdletsConfigSchema = z.object({
  schemaVersion: z.literal(CLAWDLETS_CONFIG_SCHEMA_VERSION),
  defaultHost: HostNameSchema.optional(),
  baseFlake: z.string().trim().default(""),
  fleet: FleetSchema.default(() => ({})),
  cattle: CattleSchema,
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

  validateHcloudLabelsAtPath({
    value: (cfg as any).cattle?.hetzner?.labels,
    ctx,
    path: ["cattle", "hetzner", "labels"],
  });

  const cattleEnabled = Boolean((cfg as any).cattle?.enabled);
  const cattleImage = String((cfg as any).cattle?.hetzner?.image || "").trim();
  if (cattleEnabled && !cattleImage) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cattle", "hetzner", "image"],
      message: "cattle.hetzner.image must be set when cattle.enabled is true",
    });
  }
});

export type ClawdletsConfig = z.infer<typeof ClawdletsConfigSchema>;
export type ClawdletsHostConfig = z.infer<typeof HostSchema>;

export const SafeHostNameSchema = HostNameSchema;
export { assertSafeHostName };

export function getSshExposureMode(hostCfg: ClawdletsHostConfig | null | undefined): SshExposureMode {
  const mode = hostCfg?.sshExposure?.mode;
  if (mode === "bootstrap" || mode === "public" || mode === "tailnet") return mode;
  return "tailnet";
}

export function isPublicSshExposure(mode: SshExposureMode): boolean {
  return mode === "bootstrap" || mode === "public";
}

export function getTailnetMode(hostCfg: ClawdletsHostConfig | null | undefined): TailnetMode {
  const mode = hostCfg?.tailnet?.mode;
  if (mode === "tailscale" || mode === "none") return mode;
  return "none";
}

export function createDefaultClawdletsConfig(params: { host: string; bots?: string[] }): ClawdletsConfig {
  const host = params.host.trim() || "clawdbot-fleet-host";
  const bots = (params.bots || ["maren", "sonja", "gunnar", "melinda"]).map((b) => b.trim()).filter(Boolean);
  const botsRecord = Object.fromEntries(bots.map((b) => [b, {}]));
  return ClawdletsConfigSchema.parse({
    schemaVersion: CLAWDLETS_CONFIG_SCHEMA_VERSION,
    defaultHost: host,
    baseFlake: "",
    fleet: {
      envSecrets: {
        ZAI_API_KEY: "z_ai_api_key",
        Z_AI_API_KEY: "z_ai_api_key",
      },
      botOrder: bots,
      bots: botsRecord,
      codex: { enable: false, bots: [] },
      backups: { restic: { enable: false, repository: "" } },
    },
    cattle: {
      enabled: false,
      hetzner: {
        image: "",
        serverType: "cx22",
        location: "nbg1",
        maxInstances: 10,
        defaultTtl: "2h",
        labels: { "managed-by": "clawdlets" },
      },
      defaults: { autoShutdown: true, callbackUrl: "" },
    },
    hosts: {
      [host]: {
        enable: false,
        diskDevice: "/dev/sda",
        sshAuthorizedKeys: [],
        sshKnownHosts: [],
        flakeHost: "",
        hetzner: { serverType: "cx43", image: "", location: "nbg1" },
        provisioning: { adminCidr: "", adminCidrAllowWorldOpen: false, sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
        sshExposure: { mode: "bootstrap" },
        tailnet: { mode: "tailscale" },
        cache: {
          garnix: {
            private: {
              enable: false,
              netrcSecret: "garnix_netrc",
              netrcPath: "/etc/nix/netrc",
              narinfoCachePositiveTtl: 3600,
            },
          },
        },
        operator: { deploy: { enable: false } },
        selfUpdate: { enable: false, manifestUrl: "", interval: "30min", publicKey: "", signatureUrl: "" },
        agentModelPrimary: "zai/glm-4.7",
      },
    },
  });
}

function assertNoLegacyHostKeys(parsed: unknown): void {
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
  }
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
  assertNoLegacyHostKeys(parsed);
  const config = ClawdletsConfigSchema.parse(parsed);
  return { layout, configPath, config };
}

export async function writeClawdletsConfig(params: { configPath: string; config: ClawdletsConfig }): Promise<void> {
  await writeFileAtomic(params.configPath, `${JSON.stringify(params.config, null, 2)}\n`);
}
