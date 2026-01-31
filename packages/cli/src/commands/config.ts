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
  resolveHostName,
  writeClawdletsConfig,
} from "@clawdlets/core/lib/clawdlets-config";
import { validateClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config-validate";
import { buildFleetSecretsPlan } from "@clawdlets/core/lib/fleet-secrets-plan";
import { applySecretsAutowire, planSecretsAutowire, type SecretsAutowireScope } from "@clawdlets/core/lib/secrets-autowire";

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
  meta: { name: "validate", description: "Validate fleet/clawdlets.json + rendered Clawdbot config." },
  args: {
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    strict: { type: "boolean", description: "Fail on warnings (inline secrets, invariant overrides).", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { config } = loadClawdletsConfig({ repoRoot });
    const resolved = resolveHostName({ config, host: args.host });
    if (!resolved.ok) {
      const tips = resolved.tips.length > 0 ? `; ${resolved.tips.join("; ")}` : "";
      throw new Error(`${resolved.message}${tips}`);
    }
    const res = validateClawdletsConfig({ config, hostName: resolved.host, strict: Boolean(args.strict) });
    for (const w of res.warnings) console.error(`warn: ${w}`);
    if (!res.ok) {
      for (const e of res.errors) console.error(`error: ${e}`);
      throw new Error("config validation failed");
    }
    console.log("ok");
  },
});

const wireSecrets = defineCommand({
  meta: { name: "wire-secrets", description: "Autowire missing secretEnv mappings." },
  args: {
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    bot: { type: "string", description: "Only wire secrets for this bot id." },
    scope: { type: "string", description: "Override scope (bot|fleet)." },
    only: { type: "string", description: "Only wire a specific ENV_VAR (comma-separated)." },
    write: { type: "boolean", description: "Apply changes to fleet/clawdlets.json.", default: false },
    json: { type: "boolean", description: "Output JSON summary.", default: false },
    yes: { type: "boolean", description: "Skip confirmation (non-interactive).", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawdletsConfigRaw({ repoRoot });
    const validated = ClawdletsConfigSchema.parse(config);
    const resolved = resolveHostName({ config: validated, host: args.host });
    if (!resolved.ok) {
      const tips = resolved.tips.length > 0 ? `; ${resolved.tips.join("; ")}` : "";
      throw new Error(`${resolved.message}${tips}`);
    }

    const scopeRaw = String(args.scope || "").trim();
    const scope = scopeRaw ? (scopeRaw === "bot" || scopeRaw === "fleet" ? (scopeRaw as SecretsAutowireScope) : null) : null;
    if (scopeRaw && !scope) throw new Error(`invalid --scope: ${scopeRaw} (expected bot|fleet)`);

    const onlyEnvVars = String(args.only || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const plan = planSecretsAutowire({
      config: validated,
      hostName: resolved.host,
      scope: scope ?? undefined,
      bot: args.bot ? String(args.bot).trim() : undefined,
      onlyEnvVars,
    });

    if (plan.updates.length === 0) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, updates: [] }, null, 2));
      } else {
        console.log("ok: no missing secretEnv mappings");
      }
      return;
    }

    const summary = plan.updates.map((u) => ({
      bot: u.bot,
      envVar: u.envVar,
      scope: u.scope,
      secretName: u.secretName,
    }));

    if (!args.write) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, write: false, updates: summary }, null, 2));
        return;
      }
      console.log(`planned: update ${path.relative(repoRoot, configPath)}`);
      for (const entry of summary) {
        const target =
          entry.scope === "fleet"
            ? `fleet.secretEnv.${entry.envVar}`
            : `fleet.bots.${entry.bot}.profile.secretEnv.${entry.envVar}`;
        console.log(`- ${target} = ${entry.secretName}`);
      }
      console.log("run with --write to apply changes");
      return;
    }

    const next = applySecretsAutowire({ config: validated, plan });
    const validation = validateClawdletsConfig({ config: next, hostName: resolved.host });
    if (!validation.ok) {
      for (const e of validation.errors) console.error(`error: ${e}`);
      throw new Error("autowire failed: validation errors");
    }

    await writeClawdletsConfig({ configPath, config: next });
    if (args.json) {
      console.log(JSON.stringify({ ok: true, write: true, updates: summary }, null, 2));
      return;
    }
    console.log(`ok: updated ${path.relative(repoRoot, configPath)}`);
    for (const entry of summary) {
      const target =
        entry.scope === "fleet"
          ? `fleet.secretEnv.${entry.envVar}`
          : `fleet.bots.${entry.bot}.profile.secretEnv.${entry.envVar}`;
      console.log(`- ${target} = ${entry.secretName}`);
    }
  },
});

const deriveAllowlist = defineCommand({
  meta: { name: "derive-allowlist", description: "Derive per-bot secretEnvAllowlist from current config." },
  args: {
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    bot: { type: "string", description: "Only derive allowlist for this bot id." },
    write: { type: "boolean", description: "Apply changes to fleet/clawdlets.json.", default: false },
    json: { type: "boolean", description: "Output JSON summary.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawdletsConfigRaw({ repoRoot });
    const validated = ClawdletsConfigSchema.parse(config);
    const resolved = resolveHostName({ config: validated, host: args.host });
    if (!resolved.ok) {
      const tips = resolved.tips.length > 0 ? `; ${resolved.tips.join("; ")}` : "";
      throw new Error(`${resolved.message}${tips}`);
    }

    const plan = buildFleetSecretsPlan({ config: validated, hostName: resolved.host });
    const botArg = args.bot ? String(args.bot).trim() : "";
    const bots = botArg ? [botArg] : validated.fleet.botOrder || [];
    if (bots.length === 0) throw new Error("fleet.botOrder is empty (set bots in fleet/clawdlets.json)");

    const updates = bots.map((bot) => {
      const envVars = plan.byBot?.[bot]?.envVarsRequired;
      if (!envVars) throw new Error(`unknown bot id: ${bot}`);
      return { bot, allowlist: envVars };
    });

    if (!args.write) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, write: false, updates }, null, 2));
        return;
      }
      console.log(`planned: update ${path.relative(repoRoot, configPath)}`);
      for (const entry of updates) {
        console.log(`- fleet.bots.${entry.bot}.profile.secretEnvAllowlist = ${JSON.stringify(entry.allowlist)}`);
      }
      console.log("run with --write to apply changes");
      return;
    }

    const next = structuredClone(validated) as any;
    for (const entry of updates) {
      if (!next.fleet.bots[entry.bot]) next.fleet.bots[entry.bot] = {};
      if (!next.fleet.bots[entry.bot].profile) next.fleet.bots[entry.bot].profile = {};
      next.fleet.bots[entry.bot].profile.secretEnvAllowlist = entry.allowlist;
    }

    const validation = validateClawdletsConfig({ config: next, hostName: resolved.host });
    if (!validation.ok) {
      for (const e of validation.errors) console.error(`error: ${e}`);
      throw new Error("allowlist derive failed: validation errors");
    }

    await writeClawdletsConfig({ configPath, config: next });
    if (args.json) {
      console.log(JSON.stringify({ ok: true, write: true, updates }, null, 2));
      return;
    }
    console.log(`ok: updated ${path.relative(repoRoot, configPath)}`);
    for (const entry of updates) {
      console.log(`- fleet.bots.${entry.bot}.profile.secretEnvAllowlist = ${JSON.stringify(entry.allowlist)}`);
    }
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

export const config = defineCommand({
  meta: { name: "config", description: "Canonical config (fleet/clawdlets.json)." },
  subCommands: { init, show, validate, get, set, "wire-secrets": wireSecrets, "derive-allowlist": deriveAllowlist },
});
