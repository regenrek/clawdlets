import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { expandPath } from "./lib/path-expand.js";
import { tryGetOriginFlake } from "./lib/git.js";
import { findRepoRoot } from "./lib/repo.js";
import { SafeHostNameSchema } from "./lib/clawdlets-config.js";
import { isValidTargetHost } from "./lib/ssh-remote.js";

export const STACK_SCHEMA_VERSION = 3 as const;

const HetznerSchema = z.object({
  serverType: z.string().trim().min(1),
});

const HostSchema = z.object({
  flakeHost: z.string().trim().min(1),
  targetHost: z
    .string()
    .trim()
    .min(1)
    .optional()
    .refine((v) => (v ? isValidTargetHost(v) : true), {
      message: "invalid targetHost (expected ssh alias or user@host)",
    }),
  hetzner: HetznerSchema,
  opentofu: z.object({
    adminCidr: z.string().trim().min(1),
    sshPubkeyFile: z.string().trim().min(1),
  }),
  secrets: z.object({
    localDir: z.string().trim().min(1),
    remoteDir: z.string().trim().min(1),
  }),
});

export const StackSchema = z.object({
  schemaVersion: z.literal(STACK_SCHEMA_VERSION),
  base: z
    .object({
      flake: z.string().trim().min(1).optional(),
    })
    .optional(),
  envFile: z.string().trim().min(1).optional(),
  hosts: z.record(SafeHostNameSchema, HostSchema).refine((v) => Object.keys(v).length > 0, {
    message: "hosts must not be empty",
  }),
});

export type Stack = z.infer<typeof StackSchema>;
export type StackHost = z.infer<typeof HostSchema>;

export async function resolveStackBaseFlake(params: {
  repoRoot: string;
  stack: Stack;
}): Promise<{ flake: string | null; source: "stack" | "origin" | "none" }> {
  const fromStack = String(params.stack.base?.flake ?? "").trim();
  if (fromStack) return { flake: fromStack, source: "stack" };
  const fromOrigin = (await tryGetOriginFlake(params.repoRoot)) ?? null;
  if (fromOrigin) return { flake: fromOrigin, source: "origin" };
  return { flake: null, source: "none" };
}

export type StackLayout = {
  repoRoot: string;
  stackDir: string;
  stackFile: string;
  envFile: string;
  distDir: string;
};

export function getStackLayout(params: { cwd: string; stackDir?: string }): StackLayout {
  const repoRoot = findRepoRoot(params.cwd);
  const stackDir = params.stackDir
    ? path.resolve(params.cwd, params.stackDir)
    : path.join(repoRoot, ".clawdlets");
  return {
    repoRoot,
    stackDir,
    stackFile: path.join(stackDir, "stack.json"),
    envFile: path.join(stackDir, ".env"),
    distDir: path.join(stackDir, "dist"),
  };
}

export function loadStack(params: { cwd: string; stackDir?: string }): { layout: StackLayout; stack: Stack } {
  const layout = getStackLayout(params);
  if (!fs.existsSync(layout.stackFile)) {
    throw new Error(`missing stack file: ${layout.stackFile}`);
  }
  const raw = fs.readFileSync(layout.stackFile, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON: ${layout.stackFile}`);
  }
  const stack = StackSchema.parse(parsed);
  return { layout, stack };
}

export type StackEnv = {
  HCLOUD_TOKEN?: string;
  GITHUB_TOKEN?: string;
  NIX_BIN?: string;
};

export function loadStackEnv(params: { cwd: string; stackDir?: string; envFile?: string }): { envFile?: string; env: StackEnv } {
  const layout = getStackLayout({ cwd: params.cwd, stackDir: params.stackDir });
  const envFile = params.envFile
    ? (path.isAbsolute(params.envFile)
        ? params.envFile
        : path.resolve(layout.stackDir, params.envFile))
    : fs.existsSync(layout.envFile)
      ? layout.envFile
      : undefined;

  const envFromFile = envFile && fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile, "utf8")) : {};
  const getEnv = (k: string): string | undefined => {
    const v = process.env[k] ?? envFromFile[k];
    const trimmed = String(v ?? "").trim();
    return trimmed ? trimmed : undefined;
  };

  return {
    envFile,
    env: {
      HCLOUD_TOKEN: getEnv("HCLOUD_TOKEN"),
      GITHUB_TOKEN: getEnv("GITHUB_TOKEN"),
      NIX_BIN: getEnv("NIX_BIN"),
    },
  };
}

export function resolveHostOpenTofuSshPubkeyFile(host: StackHost): string {
  const raw = host.opentofu.sshPubkeyFile.trim();
  const expanded = expandPath(raw);
  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
}
