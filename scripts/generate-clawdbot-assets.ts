import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type ProviderInfo = {
  auth: "apiKey" | "oauth" | "mixed";
  credentials: Array<{ id: string; anyOfEnv: string[] }>;
  aliases?: string[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const argValue = (flag: string): string | null => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1] ?? null;
};

const readText = (p: string): string => fs.readFileSync(p, "utf8");
const readJson = <T = unknown>(p: string): T => JSON.parse(readText(p)) as T;

const parseEnvMap = (text: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  const block = text.split("export function resolveEnvApiKey")[1]?.split("export function resolveModelAuthMode")[0] ?? "";
  const ifRegex = /if\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = ifRegex.exec(block))) {
    const condition = match[1] ?? "";
    const body = match[2] ?? "";
    const envs = Array.from(body.matchAll(/pick\("([^"]+)"\)/g)).map((m) => String(m[1] || "").trim()).filter(Boolean);
    const providers = Array.from(condition.matchAll(/(?:provider|normalized)\s*===\s*"([^"]+)"/g))
      .map((m) => String(m[1] || "").trim())
      .filter(Boolean);
    if (providers.length === 0 || envs.length === 0) continue;
    for (const provider of providers) {
      out[provider] = Array.from(new Set([...(out[provider] ?? []), ...envs]));
    }
  }

  const envMapMatch = block.match(/const\s+envMap:[^{]*\{([\s\S]*?)\};/);
  if (envMapMatch) {
    const envMapBody = envMapMatch[1] ?? "";
    const entryRegex = /["']?([A-Za-z0-9-_]+)["']?\s*:\s*"([^"]+)"/g;
    let entry: RegExpExecArray | null;
    while ((entry = entryRegex.exec(envMapBody))) {
      const provider = entry[1] ?? "";
      const envVar = entry[2] ?? "";
      if (!provider || !envVar) continue;
      out[provider] = Array.from(new Set([...(out[provider] ?? []), envVar]));
    }
  }
  return out;
};

const readOAuthProviders = async (src: string): Promise<string[]> => {
  try {
    const oauthModuleUrl = pathToFileURL(
      path.join(src, "node_modules", "@mariozechner", "pi-ai", "dist", "utils", "oauth", "index.js"),
    ).href;
    const mod = await import(oauthModuleUrl);
    const raw = typeof mod.getOAuthProviders === "function" ? mod.getOAuthProviders() : [];
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (entry && typeof entry === "object" && "id" in entry) {
          return String((entry as { id?: unknown }).id || "").trim();
        }
        return "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const parseProviderAliases = (text: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  const block = text.split("export function normalizeProviderId")[1] ?? "";
  const ifRegex = /if\s*\(([^)]*normalized[^)]*)\)\s*return\s+"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = ifRegex.exec(block))) {
    const condition = match[1] ?? "";
    const canonical = match[2] ?? "";
    if (!canonical) continue;
    const aliases = Array.from(condition.matchAll(/normalized\s*===\s*"([^"]+)"/g))
      .map((m) => String(m[1] || "").trim())
      .filter(Boolean);
    if (aliases.length === 0) continue;
    out[canonical] = Array.from(new Set([...(out[canonical] ?? []), ...aliases]));
  }
  return out;
};

const parseEnvAliases = (text: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  const assignRegex = /process\.env\.([A-Z0-9_]+)\s*=\s*process\.env\.([A-Z0-9_]+)/g;
  let match: RegExpExecArray | null;
  while ((match = assignRegex.exec(text))) {
    const canonical = match[1] ?? "";
    const alias = match[2] ?? "";
    if (!canonical || !alias || canonical === alias) continue;
    out[canonical] = Array.from(new Set([...(out[canonical] ?? []), alias]));
  }
  return out;
};

const buildProviderInfo = (params: {
  envMap: Record<string, string[]>;
  oauthProviders: string[];
  aliases: Record<string, string[]>;
}): Record<string, ProviderInfo> => {
  const providers = new Set<string>([
    ...Object.keys(params.envMap),
    ...params.oauthProviders,
    ...Object.keys(params.aliases),
  ]);
  const out: Record<string, ProviderInfo> = {};

  for (const provider of Array.from(providers).sort()) {
    const envVars = (params.envMap[provider] ?? []).slice().sort();
    const oauthVars = envVars.filter((v) => v.includes("OAUTH_TOKEN"));
    const apiVars = envVars.filter((v) => !v.includes("OAUTH_TOKEN"));

    let auth: ProviderInfo["auth"] = "apiKey";
    if (oauthVars.length > 0 && apiVars.length > 0) auth = "mixed";
    else if (oauthVars.length > 0 && apiVars.length === 0) auth = "oauth";
    else if (params.oauthProviders.includes(provider)) auth = envVars.length > 0 ? "mixed" : "oauth";

    const credentials: ProviderInfo["credentials"] = [];
    if (apiVars.length > 0) credentials.push({ id: "api_key", anyOfEnv: apiVars });
    if (oauthVars.length > 0) credentials.push({ id: "oauth_token", anyOfEnv: oauthVars });

    const info: ProviderInfo = { auth, credentials };
    const aliases = params.aliases[provider];
    if (aliases && aliases.length > 0) info.aliases = aliases;
    out[provider] = info;
  }

  return out;
};

const writeJson = (outPath: string, payload: unknown) => {
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const ensureDir = (p: string) => fs.mkdirSync(p, { recursive: true });

const ensureOpenclawConfigPath = () => {
  if (process.env.OPENCLAW_CONFIG_PATH) return;
  const tmpDir = path.join(os.tmpdir(), "clawdlets-openclaw");
  const configPath = path.join(tmpDir, "openclaw.json");
  ensureDir(tmpDir);
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, "{}\n", "utf8");
  }
  process.env.OPENCLAW_CONFIG_PATH = configPath;
};

const getGitRev = (repo: string): string => {
  try {
    return execSync(`git -C ${JSON.stringify(repo)} rev-parse HEAD`, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

const getGitCommitTimeIso = (repo: string, commit: string): string | null => {
  try {
    const out = execSync(
      `git -C ${JSON.stringify(repo)} show -s --format=%cI ${JSON.stringify(commit)}`,
      { encoding: "utf8" },
    ).trim();
    return out ? out : null;
  } catch {
    return null;
  }
};

const getPinnedRevFromFlake = (): string | null => {
  try {
    const flakeLockPath = path.join(repoRoot, "flake.lock");
    if (!fs.existsSync(flakeLockPath)) return null;
    const lock = readJson<{ nodes?: Record<string, { locked?: { rev?: string } }> }>(flakeLockPath);
    const rev = lock?.nodes?.["clawdbot-src"]?.locked?.rev;
    return typeof rev === "string" && rev.trim() ? rev.trim() : null;
  } catch {
    return null;
  }
};

const ensureClawdbotDeps = (src: string) => {
  const zodPkg = path.join(src, "node_modules", "zod", "package.json");
  if (!fs.existsSync(zodPkg)) {
    console.error(`error: missing clawdbot dependencies in ${src}`);
    console.error("hint: run `pnpm install --frozen-lockfile --ignore-scripts` in the clawdbot source first");
    process.exit(1);
  }
};

const main = async () => {
  const src = argValue("--src") ?? process.env.CLAWDBOT_SRC;
  if (!src) {
    console.error("error: missing --src <clawdbot repo path> (or set CLAWDBOT_SRC)");
    process.exit(1);
  }

  const pinnedRev = getPinnedRevFromFlake();
  const allowMismatch = process.argv.includes("--allow-mismatch") || process.env.CLAWDBOT_ALLOW_MISMATCH === "1";
  const rev = argValue("--rev") ?? process.env.CLAWDBOT_REV ?? pinnedRev ?? getGitRev(src);
  if (pinnedRev && rev !== pinnedRev && !allowMismatch) {
    console.error(`error: clawdbot rev mismatch (flake.lock=${pinnedRev} provided=${rev})`);
    console.error("hint: pass --rev to match flake.lock or use --allow-mismatch for local debugging");
    process.exit(1);
  }
  if (fs.existsSync(path.join(src, ".git"))) {
    const actualRev = getGitRev(src);
    if (actualRev !== "unknown" && rev !== actualRev && !allowMismatch) {
      console.error(`error: clawdbot source rev mismatch (src=${actualRev} expected=${rev})`);
      console.error("hint: checkout the pinned revision or pass --allow-mismatch for local debugging");
      process.exit(1);
    }
  }
  const schemaOut =
    argValue("--schema-out") ??
    path.join(repoRoot, "packages", "core", "src", "assets", "clawdbot-config.schema.json");
  const providersOut =
    argValue("--providers-out") ??
    path.join(repoRoot, "packages", "core", "src", "assets", "llm-providers.json");

  ensureDir(path.dirname(schemaOut));
  ensureDir(path.dirname(providersOut));
  ensureOpenclawConfigPath();

  ensureClawdbotDeps(src);

  const schemaModuleUrl = pathToFileURL(path.join(src, "src", "config", "schema.ts")).href;
  const schemaMod = await import(schemaModuleUrl);
  if (typeof schemaMod.buildConfigSchema !== "function") {
    console.error(`error: buildConfigSchema not found in ${schemaModuleUrl}`);
    process.exit(1);
  }
  const channelsModuleUrl = pathToFileURL(path.join(src, "src", "channels", "plugins", "index.ts")).href;
  const channelsMod = await import(channelsModuleUrl);
  if (typeof channelsMod.listChannelPlugins !== "function") {
    console.error(`error: listChannelPlugins not found in ${channelsModuleUrl}`);
    process.exit(1);
  }
  const pluginsModuleUrl = pathToFileURL(path.join(src, "src", "plugins", "loader.ts")).href;
  const pluginsMod = await import(pluginsModuleUrl);
  const loadPlugins =
    typeof pluginsMod.loadOpenClawPlugins === "function"
      ? pluginsMod.loadOpenClawPlugins
      : typeof pluginsMod.loadMoltbotPlugins === "function"
        ? pluginsMod.loadMoltbotPlugins
        : null;
  if (!loadPlugins) {
    console.error(`error: loadOpenClawPlugins/loadMoltbotPlugins not found in ${pluginsModuleUrl}`);
    process.exit(1);
  }
  const manifestsModuleUrl = pathToFileURL(
    path.join(src, "src", "plugins", "manifest-registry.ts"),
  ).href;
  const manifestsMod = await import(manifestsModuleUrl);
  if (typeof manifestsMod.loadPluginManifestRegistry !== "function") {
    console.error(`error: loadPluginManifestRegistry not found in ${manifestsModuleUrl}`);
    process.exit(1);
  }
  const manifestRegistry = manifestsMod.loadPluginManifestRegistry({
    config: {},
    workspaceDir: src,
    cache: false,
  }) as { plugins: Array<{ id?: string | null }> };
  const pluginIds = Array.from(
    new Set(
      manifestRegistry.plugins
        .map((plugin) => String(plugin.id ?? "").trim())
        .filter(Boolean),
    ),
  );
  const entries = Object.fromEntries(pluginIds.map((id) => [id, { enabled: true }]));
  let pluginRegistry: { plugins: Array<any> };
  try {
    pluginRegistry = loadPlugins({
      config: pluginIds.length > 0 ? { plugins: { entries } } : {},
      workspaceDir: src,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    });
  } catch (err) {
    console.error(`error: failed to load clawdbot plugins for schema: ${String((err as Error)?.message || err)}`);
    process.exit(1);
  }
  const schemaRes = schemaMod.buildConfigSchema({
    plugins: pluginRegistry.plugins.map((plugin: any) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      configUiHints: plugin.configUiHints,
      configSchema: plugin.configJsonSchema,
    })),
    channels: channelsMod.listChannelPlugins().map((entry: any) => ({
      id: entry.id,
      label: entry.meta?.label,
      description: entry.meta?.blurb,
      configSchema: entry.configSchema?.schema,
      configUiHints: entry.configSchema?.uiHints,
    })),
  });
  const generatedAt = getGitCommitTimeIso(src, rev) || new Date(0).toISOString();
  const schemaPayload = {
    schema: schemaRes.schema ?? {},
    uiHints: schemaRes.uiHints ?? {},
    version: String(schemaRes.version || ""),
    generatedAt,
    clawdbotRev: rev,
  };
  writeJson(schemaOut, schemaPayload);

  const modelAuthText = readText(path.join(src, "src", "agents", "model-auth.ts"));
  const modelSelectionText = readText(path.join(src, "src", "agents", "model-selection.ts"));
  const envText = readText(path.join(src, "src", "infra", "env.ts"));
  const envMap = parseEnvMap(modelAuthText);
  const aliases = parseProviderAliases(modelSelectionText);
  const envAliases = parseEnvAliases(envText);
  for (const [provider, envs] of Object.entries(envMap)) {
    const expanded = new Set(envs);
    for (const envVar of envs) {
      const more = envAliases[envVar];
      if (!more) continue;
      for (const alias of more) expanded.add(alias);
    }
    envMap[provider] = Array.from(expanded);
  }
  const oauthProviders = await readOAuthProviders(src);
  if (oauthProviders.length === 0) {
    console.error("error: failed to resolve OAuth providers (pi-ai utils/oauth)");
    process.exit(1);
  }
  const providerInfo = buildProviderInfo({ envMap, aliases, oauthProviders });
  writeJson(providersOut, providerInfo);

  console.log(`ok: wrote ${path.relative(repoRoot, schemaOut)}`);
  console.log(`ok: wrote ${path.relative(repoRoot, providersOut)}`);
};

main().catch((err) => {
  console.error(`error: ${String((err as Error)?.message || err)}`);
  process.exit(1);
});
