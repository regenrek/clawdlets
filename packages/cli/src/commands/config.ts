import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { ensureDir } from "@clawdlets/core/lib/fs-safe";
import { splitDotPath } from "@clawdlets/core/lib/dot-path";
import { deleteAtPath, getAtPath, setAtPath } from "@clawdlets/core/lib/object-path";
import { findRepoRoot } from "@clawdlets/core/lib/repo";
import { getRepoLayout } from "@clawdlets/core/repo-layout";
import {
  createDefaultClawdletsConfig,
  ClawdletsConfigSchema,
  loadClawdletsConfig,
  loadClawdletsConfigRaw,
  writeClawdletsConfig,
} from "@clawdlets/core/lib/clawdlets-config";
import { migrateClawdletsConfigToV9 } from "@clawdlets/core/lib/clawdlets-config-migrate";

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
    const { configPath, config } = loadClawdletsConfigRaw({ repoRoot });
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

    try {
      const validated = ClawdletsConfigSchema.parse(next);
      await writeClawdletsConfig({ configPath, config: validated });
      console.log("ok");
    } catch (err: any) {
      let details = "";
      if (Array.isArray(err?.errors)) {
        details = err.errors
          .map((e: any) => (Array.isArray(e.path) ? e.path.join(".") : "") || e.message)
          .filter(Boolean)
          .join(", ");
      }
      const msg = details
        ? `config update failed; revert or fix validation errors: ${details}`
        : "config update failed; revert or fix validation errors";
      throw new Error(msg);
    }
  },
});

const migrate = defineCommand({
  meta: { name: "migrate", description: "Migrate fleet/clawdlets.json to a new schema version." },
  args: {
    to: { type: "string", description: "Target schema version (only v9 supported).", default: "v9" },
    "dry-run": { type: "boolean", description: "Print planned write without writing.", default: false },
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

    const to = String((args as any).to || "v9").trim().toLowerCase();
    if (to !== "v9" && to !== "9") throw new Error(`unsupported --to: ${to} (expected v9)`);

    const res = migrateClawdletsConfigToV9(parsed);
    if (!res.changed) {
      console.log("ok: already schemaVersion 9");
      return;
    }

    const validated = ClawdletsConfigSchema.parse(res.migrated);

    if ((args as any)["dry-run"]) {
      console.log(`planned: write ${path.relative(repoRoot, configPath)}`);
      for (const w of res.warnings) console.log(`warn: ${w}`);
      return;
    }

    await ensureDir(path.dirname(configPath));
    await writeClawdletsConfig({ configPath, config: validated });
    console.log(`ok: migrated to schemaVersion 9: ${path.relative(repoRoot, configPath)}`);
    for (const w of res.warnings) console.log(`warn: ${w}`);
  },
});

export const config = defineCommand({
  meta: { name: "config", description: "Canonical config (fleet/clawdlets.json)." },
  subCommands: { init, show, validate, get, set, migrate },
});
