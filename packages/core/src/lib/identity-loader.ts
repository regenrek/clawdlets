import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { assertSafeIdentityName } from "./identifiers.js";

export const IDENTITY_CONFIG_SCHEMA_VERSION = 1 as const;

export const IdentityConfigSchema = z
  .object({
    schemaVersion: z.literal(IDENTITY_CONFIG_SCHEMA_VERSION).default(IDENTITY_CONFIG_SCHEMA_VERSION),
    model: z
      .object({
        primary: z.string().trim().default(""),
        fallbacks: z.array(z.string().trim().min(1)).default([]),
      })
      .default({ primary: "", fallbacks: [] }),
  })
  .passthrough();

export type IdentityConfig = z.infer<typeof IdentityConfigSchema>;

export type LoadedIdentity = {
  name: string;
  identityDir: string;
  soulPath: string;
  soulText: string;
  configPath: string;
  configRaw: string;
  config: IdentityConfig;
  cloudInitFiles: Array<{ path: string; permissions: string; owner: string; content: string }>;
};

function readTextFileLimited(filePath: string, maxBytes: number): string {
  const st = fs.statSync(filePath);
  if (!st.isFile()) throw new Error(`not a file: ${filePath}`);
  if (st.size > maxBytes) throw new Error(`file too large: ${filePath} (${st.size} bytes; max ${maxBytes})`);
  return fs.readFileSync(filePath, "utf8");
}

export function getIdentityDir(repoRoot: string, identityName: string): string {
  assertSafeIdentityName(identityName);
  return path.join(repoRoot, "identities", identityName);
}

export function loadIdentity(params: {
  repoRoot: string;
  identityName: string;
  identitiesRoot?: string;
  maxSoulBytes?: number;
  maxConfigBytes?: number;
}): LoadedIdentity {
  const repoRoot = params.repoRoot;
  const identityName = String(params.identityName || "").trim();
  assertSafeIdentityName(identityName);

  const identitiesRoot = String(params.identitiesRoot || "").trim();
  const identityDir = identitiesRoot ? path.join(identitiesRoot, identityName) : getIdentityDir(repoRoot, identityName);
  const soulPath = path.join(identityDir, "SOUL.md");
  const configPath = path.join(identityDir, "config.json");

  if (!fs.existsSync(identityDir)) {
    throw new Error(`identity not found: ${identityName} (missing dir ${identityDir})`);
  }
  if (!fs.existsSync(soulPath)) throw new Error(`identity missing SOUL.md: ${soulPath}`);
  if (!fs.existsSync(configPath)) throw new Error(`identity missing config.json: ${configPath}`);

  const soulText = readTextFileLimited(soulPath, params.maxSoulBytes ?? 16 * 1024);
  const configRaw = readTextFileLimited(configPath, params.maxConfigBytes ?? 16 * 1024);

  let configJson: unknown;
  try {
    configJson = JSON.parse(configRaw);
  } catch (e) {
    throw new Error(`identity config.json invalid JSON: ${configPath} (${String((e as Error)?.message || e)})`);
  }

  const config = IdentityConfigSchema.parse(configJson);

  const cloudInitFiles: LoadedIdentity["cloudInitFiles"] = [
    { path: "/var/lib/clawdlets/identity/SOUL.md", permissions: "0600", owner: "root:root", content: `${soulText}\n` },
    { path: "/var/lib/clawdlets/identity/config.json", permissions: "0600", owner: "root:root", content: `${JSON.stringify(configJson, null, 2)}\n` },
  ];

  return {
    name: identityName,
    identityDir,
    soulPath,
    soulText,
    configPath,
    configRaw,
    config,
    cloudInitFiles,
  };
}
