import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { ensureDir } from "@clawdlets/core/lib/fs-safe";
import { splitDotPath } from "@clawdlets/core/lib/dot-path";
import { findRepoRoot } from "@clawdlets/core/lib/repo";
import { getRepoLayout } from "@clawdlets/core/repo-layout";
import {
  createDefaultClawdletsConfig,
  ClawdletsConfigSchema,
  loadClawdletsConfig,
  writeClawdletsConfig,
} from "@clawdlets/core/lib/clawdlets-config";
import { migrateClawdletsConfigV6ToV7 } from "@clawdlets/core/lib/clawdlets-config-migrate";

function getAtPath(obj: any, parts: string[]): unknown {
  let cur: any = obj;
  for (const k of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[k];
  }
  return cur;
}

function setAtPath(obj: any, parts: string[], value: unknown): void {
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (cur[k] == null || typeof cur[k] !== "object" || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]!] = value;
}

function deleteAtPath(obj: any, parts: string[]): boolean {
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (cur == null || typeof cur !== "object") return false;
    cur = cur[k];
  }
  const last = parts[parts.length - 1]!;
  if (cur && typeof cur === "object" && Object.prototype.hasOwnProperty.call(cur, last)) {
    delete cur[last];
    return true;
  }
  return false;
}

const init = defineCommand({
  meta: { name: "init", description: "Initialize fleet/clawdlets.json (canonical config)." },
  args: {
    host: { type: "string", description: "Initial host name.", default: "clawdbot-fleet-host" },
    force: { type: "boolean", description: "Overwrite existing clawdlets.json.", default: false },
    "dry-run": { type: "boolean", description: "Print planned writes without writing.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const host = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    const configPath = getRepoLayout(repoRoot).clawdletsConfigPath;

    if (fs.existsSync(configPath) && !args.force) {
      throw new Error(`config already exists (pass --force to overwrite): ${configPath}`);
    }

    const config = createDefaultClawdletsConfig({ host });

    if ((args as any)["dry-run"]) {
      console.log(`planned: write ${path.relative(repoRoot, configPath)}`);
      return;
    }

    await ensureDir(path.dirname(configPath));
    await writeClawdletsConfig({ configPath, config });
    console.log(`ok: wrote ${path.relative(repoRoot, configPath)}`);
  },
});

const migrateV6ToV7 = defineCommand({
  meta: { name: "migrate-v6-to-v7", description: "Migrate fleet/clawdlets.json schemaVersion 6 -> 7 (one-shot)." },
  args: {
    "dry-run": { type: "boolean", description: "Print migrated config without writing.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const configPath = getRepoLayout(repoRoot).clawdletsConfigPath;
    if (!fs.existsSync(configPath)) throw new Error(`missing config: ${configPath}`);
    const rawText = fs.readFileSync(configPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(`invalid JSON: ${configPath}`);
    }

    const schemaVersion = (parsed as any)?.schemaVersion;
    if (schemaVersion === 7) {
      console.log("ok: already schemaVersion=7");
      return;
    }
    if (schemaVersion !== 6) throw new Error(`expected schemaVersion=6, got: ${schemaVersion}`);

    const migrated = migrateClawdletsConfigV6ToV7(parsed);
    const validated = ClawdletsConfigSchema.parse(migrated);

    if ((args as any)["dry-run"]) {
      console.log(JSON.stringify(validated, null, 2));
      return;
    }

    const backupPath = `${configPath}.v6.${Date.now()}.bak`;
    fs.writeFileSync(backupPath, rawText, { mode: 0o600 });
    await writeClawdletsConfig({ configPath, config: validated });
    console.log(`ok: migrated to schemaVersion=7 (backup: ${path.relative(repoRoot, backupPath)})`);
  },
});

const show = defineCommand({
  meta: { name: "show", description: "Print fleet/clawdlets.json." },
  args: {
    pretty: { type: "boolean", description: "Pretty-print JSON.", default: true },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { config } = loadClawdletsConfig({ repoRoot });
    console.log(args.pretty ? JSON.stringify(config, null, 2) : JSON.stringify(config));
  },
});

const validate = defineCommand({
  meta: { name: "validate", description: "Validate fleet/clawdlets.json schema." },
  args: {},
  async run() {
    const repoRoot = findRepoRoot(process.cwd());
    loadClawdletsConfig({ repoRoot });
    console.log("ok");
  },
});

const get = defineCommand({
  meta: { name: "get", description: "Get a value from fleet/clawdlets.json (dot path)." },
  args: {
    path: { type: "string", description: "Dot path (e.g. fleet.botOrder)." },
    json: { type: "boolean", description: "JSON output.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { config } = loadClawdletsConfig({ repoRoot });
    const parts = splitDotPath(String(args.path || ""));
    const v = getAtPath(config as any, parts);
    if (args.json) console.log(JSON.stringify({ path: parts.join("."), value: v }, null, 2));
    else console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  },
});

const set = defineCommand({
  meta: { name: "set", description: "Set a value in fleet/clawdlets.json (dot path)." },
  args: {
    path: { type: "string", description: "Dot path (e.g. fleet.botOrder)." },
    value: { type: "string", description: "String value." },
    "value-json": { type: "string", description: "JSON value (parsed)." },
    delete: { type: "boolean", description: "Delete the key at path.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawdletsConfig({ repoRoot });
    const parts = splitDotPath(String(args.path || ""));

    const next = structuredClone(config) as any;

    if (args.delete) {
      const ok = deleteAtPath(next, parts);
      if (!ok) throw new Error(`path not found: ${parts.join(".")}`);
    } else if ((args as any)["value-json"] !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String((args as any)["value-json"]));
      } catch {
        throw new Error("invalid --value-json (must be valid JSON)");
      }
      setAtPath(next, parts, parsed);
    } else if (args.value !== undefined) {
      setAtPath(next, parts, String(args.value));
    } else {
      throw new Error("set requires --value or --value-json (or --delete)");
    }

    const validated = ClawdletsConfigSchema.parse(next);
    await writeClawdletsConfig({ configPath, config: validated });
    console.log("ok");
  },
});

export const config = defineCommand({
  meta: { name: "config", description: "Canonical config (fleet/clawdlets.json)." },
  subCommands: { init, show, validate, get, set, "migrate-v6-to-v7": migrateV6ToV7 },
});
