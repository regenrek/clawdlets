import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { assertSafePersonaName } from "@clawdlets/shared/lib/identifiers";

export const PERSONA_CONFIG_SCHEMA_VERSION = 1 as const;

export const PersonaConfigSchema = z
  .object({
    schemaVersion: z.literal(PERSONA_CONFIG_SCHEMA_VERSION).default(PERSONA_CONFIG_SCHEMA_VERSION),
    model: z
      .object({
        primary: z.string().trim().default(""),
        fallbacks: z.array(z.string().trim().min(1)).default([]),
      })
      .default({ primary: "", fallbacks: [] }),
  })
  .passthrough();

export type PersonaConfig = z.infer<typeof PersonaConfigSchema>;

export type LoadedPersona = {
  name: string;
  personaDir: string;
  soulPath: string;
  soulText: string;
  configPath: string;
  configRaw: string;
  config: PersonaConfig;
  cloudInitFiles: Array<{ path: string; permissions: string; owner: string; content: string }>;
};

function readTextFileLimited(filePath: string, maxBytes: number): string {
  const st = fs.statSync(filePath);
  if (!st.isFile()) throw new Error(`not a file: ${filePath}`);
  if (st.size > maxBytes) throw new Error(`file too large: ${filePath} (${st.size} bytes; max ${maxBytes})`);
  return fs.readFileSync(filePath, "utf8");
}

export function getPersonaDir(repoRoot: string, personaName: string): string {
  assertSafePersonaName(personaName);
  return path.join(repoRoot, "cattle", "personas", personaName);
}

export function loadPersona(params: {
  personaName: string;
  repoRoot?: string;
  personasRoot?: string;
  maxSoulBytes?: number;
  maxConfigBytes?: number;
}): LoadedPersona {
  const personaName = String(params.personaName || "").trim();
  assertSafePersonaName(personaName);

  const personasRoot = String(params.personasRoot || "").trim();
  const repoRoot = String(params.repoRoot || "").trim();
  if (!personasRoot && !repoRoot) {
    throw new Error("loadPersona requires either personasRoot or repoRoot");
  }
  const personaDir = personasRoot ? path.join(personasRoot, personaName) : getPersonaDir(repoRoot, personaName);
  const soulPath = path.join(personaDir, "SOUL.md");
  const configPath = path.join(personaDir, "config.json");

  if (!fs.existsSync(personaDir)) {
    throw new Error(`persona not found: ${personaName} (missing dir ${personaDir})`);
  }
  if (!fs.existsSync(soulPath)) throw new Error(`persona missing SOUL.md: ${soulPath}`);
  if (!fs.existsSync(configPath)) throw new Error(`persona missing config.json: ${configPath}`);

  const soulText = readTextFileLimited(soulPath, params.maxSoulBytes ?? 16 * 1024);
  const configRaw = readTextFileLimited(configPath, params.maxConfigBytes ?? 16 * 1024);

  let configJson: unknown;
  try {
    configJson = JSON.parse(configRaw);
  } catch (e) {
    throw new Error(`persona config.json invalid JSON: ${configPath} (${String((e as Error)?.message || e)})`);
  }

  const config = PersonaConfigSchema.parse(configJson);

  const cloudInitFiles: LoadedPersona["cloudInitFiles"] = [
    { path: "/var/lib/clawdlets/cattle/persona/SOUL.md", permissions: "0600", owner: "root:root", content: `${soulText}\n` },
    { path: "/var/lib/clawdlets/cattle/persona/config.json", permissions: "0600", owner: "root:root", content: `${JSON.stringify(configJson, null, 2)}\n` },
  ];

  return {
    name: personaName,
    personaDir,
    soulPath,
    soulText,
    configPath,
    configRaw,
    config,
    cloudInitFiles,
  };
}
