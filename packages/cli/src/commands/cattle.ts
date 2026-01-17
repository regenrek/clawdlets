import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { sanitizeOperatorId } from "@clawdlets/core/lib/identifiers";
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds";
import { parseTtlToSeconds } from "@clawdlets/core/lib/ttl";
import { CattleTaskSchema, CATTLE_TASK_SCHEMA_VERSION, type CattleTask } from "@clawdlets/core/lib/cattle-task";
import { buildCattleCloudInitUserData } from "@clawdlets/core/lib/cattle-cloudinit";
import {
  CATTLE_LABEL_CATTLE,
  CATTLE_LABEL_CATTLE_VALUE,
  CATTLE_LABEL_CREATED_AT,
  CATTLE_LABEL_EXPIRES_AT,
  CATTLE_LABEL_IDENTITY,
  CATTLE_LABEL_MANAGED_BY,
  CATTLE_LABEL_MANAGED_BY_VALUE,
  CATTLE_LABEL_TASK_ID,
  buildCattleLabelSelector,
  createCattleServer,
  destroyCattleServer,
  listCattleServers,
  reapExpiredCattle,
  type CattleServer,
} from "@clawdlets/core/lib/hcloud-cattle";
import { buildCattleServerName, safeCattleLabelValue } from "@clawdlets/core/lib/cattle-planner";
import { openCattleState } from "@clawdlets/core/lib/cattle-state";
import { getModelRequiredEnvVars } from "@clawdlets/core/lib/llm-provider-env";
import { run, capture } from "@clawdlets/core/lib/run";
import { shellQuote, sshRun } from "@clawdlets/core/lib/ssh-remote";
import { sopsDecryptYamlFile } from "@clawdlets/core/lib/sops";
import { readYamlScalarFromMapping } from "@clawdlets/core/lib/yaml-scalar";
import { getHostSecretsDir, getLocalOperatorAgeKeyPath } from "@clawdlets/core/repo-layout";
import { loadIdentity } from "@clawdlets/core/lib/identity-loader";
import { loadHostContextOrExit } from "../lib/context.js";

function requireEnabled(params: { enabled: boolean; hint: string }): void {
  if (params.enabled) return;
  throw new Error(params.hint);
}

function requireFile(pathname: string, label: string): void {
  if (fs.existsSync(pathname)) return;
  throw new Error(`${label} missing: ${pathname}`);
}

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid JSON: ${filePath} (${String((e as Error)?.message || e)})`);
  }
}

function requireTtlSeconds(ttlRaw: string): { seconds: number; normalized: string } {
  const parsed = parseTtlToSeconds(ttlRaw);
  if (!parsed) throw new Error(`invalid --ttl: ${ttlRaw} (expected e.g. 30m, 2h, 1d)`);
  return { seconds: parsed.seconds, normalized: parsed.raw };
}

function unixSecondsNow(): number {
  return Math.floor(Date.now() / 1000);
}

function formatAgeSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${ss}s`;
  return `${ss}s`;
}

function formatTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const widths: number[] = [];
  for (const r of rows) {
    for (let i = 0; i < r.length; i++) {
      widths[i] = Math.max(widths[i] || 0, String(r[i] ?? "").length);
    }
  }
  return rows
    .map((r) => r.map((c, i) => String(c ?? "").padEnd(widths[i] || 0)).join("  ").trimEnd())
    .join("\n");
}

function resolveAgeKeyFile(params: {
  operatorArg?: unknown;
  ageKeyFileArg?: unknown;
  deployCredsAgeKeyFile?: string;
  layout: Parameters<typeof getLocalOperatorAgeKeyPath>[0];
}): string {
  const operatorId = sanitizeOperatorId(String(params.operatorArg || process.env.USER || "operator"));
  const explicit = String(params.ageKeyFileArg || "").trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  if (params.deployCredsAgeKeyFile) return String(params.deployCredsAgeKeyFile).trim();
  return getLocalOperatorAgeKeyPath(params.layout, operatorId);
}

async function decryptHostSecretScalar(params: {
  repoRoot: string;
  hostSecretsDir: string;
  secretName: string;
  ageKeyFile: string;
  nixBin: string;
}): Promise<string> {
  const filePath = path.join(params.hostSecretsDir, `${params.secretName}.yaml`);
  requireFile(filePath, `secret ${params.secretName}`);

  const nix = { nixBin: params.nixBin, cwd: params.repoRoot, dryRun: false } as const;
  const decrypted = await sopsDecryptYamlFile({ filePath, ageKeyFile: params.ageKeyFile, nix });
  const value = readYamlScalarFromMapping({ yamlText: decrypted, key: params.secretName });
  if (value == null) throw new Error(`invalid secret yaml (expected scalar key ${params.secretName}): ${filePath}`);
  const v = String(value ?? "");
  if (!v.trim()) throw new Error(`secret is empty: ${params.secretName}`);
  return v;
}

async function resolveTailscaleIpv4(hostname: string): Promise<string> {
  const name = String(hostname || "").trim();
  if (!name) throw new Error("hostname missing for tailscale ip resolution");
  const out = await capture("tailscale", ["ip", "--1", "--4", name], { maxOutputBytes: 4096 });
  const ip = out.trim();
  if (!ip) throw new Error(`tailscale ip returned empty output for ${name}`);
  return ip;
}

function loadTaskFromFile(taskFile: string): CattleTask {
  const raw = readJsonFile(taskFile);
  const parsed = CattleTaskSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid task file (expected schemaVersion ${CATTLE_TASK_SCHEMA_VERSION}): ${taskFile}`);
  return parsed.data;
}

function buildEnvForModel(params: {
  configEnvSecrets: Record<string, string>;
  model: string;
}): { requiredEnvVars: string[]; secretNamesByEnvVar: Record<string, string> } {
  const requiredEnvVars = getModelRequiredEnvVars(params.model);
  if (requiredEnvVars.length === 0) {
    throw new Error(`unknown model provider (cannot determine required env vars): ${params.model}`);
  }
  const secretNamesByEnvVar: Record<string, string> = {};
  for (const envVar of requiredEnvVars) {
    const secretName = String(params.configEnvSecrets?.[envVar] || "").trim();
    if (!secretName) {
      throw new Error(
        [
          `missing envSecrets mapping for ${envVar} (model=${params.model})`,
          `set fleet.envSecrets.${envVar} in fleet/clawdlets.json to a secret name`,
        ].join("; "),
      );
    }
    secretNamesByEnvVar[envVar] = secretName;
  }
  return { requiredEnvVars, secretNamesByEnvVar };
}

const cattleSpawn = defineCommand({
  meta: { name: "spawn", description: "Spawn an ephemeral cattle agent VM on Hetzner Cloud." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    operator: { type: "string", description: "Operator id for age key name (default: $USER)." },
    ageKeyFile: { type: "string", description: "Override SOPS_AGE_KEY_FILE path." },
    identity: { type: "string", description: "Identity name (labels + injected identity files).", required: true },
    taskFile: { type: "string", description: "Task JSON file (schemaVersion 1).", required: true },
    ttl: { type: "string", description: "TTL override (default: cattle.hetzner.defaultTtl)." },
    image: { type: "string", description: "Hetzner image id/name override (default: cattle.hetzner.image)." },
    serverType: { type: "string", description: "Hetzner server type override (default: cattle.hetzner.serverType)." },
    location: { type: "string", description: "Hetzner location override (default: cattle.hetzner.location)." },
    model: { type: "string", description: "Model id override (default: hosts.<host>.agentModelPrimary)." },
    callbackUrl: { type: "string", description: "Callback URL override (default: cattle.defaults.callbackUrl)." },
    autoShutdown: { type: "boolean", description: "Auto poweroff after task (default: cattle.defaults.autoShutdown)." },
    dryRun: { type: "boolean", description: "Print plan without creating a server.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { repoRoot, layout, config, hostName, hostCfg } = ctx;

    requireEnabled({
      enabled: Boolean(config.cattle?.enabled),
      hint: "cattle is disabled (set cattle.enabled=true in fleet/clawdlets.json)",
    });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.origin === "explicit" && deployCreds.envFile.status !== "ok") {
      throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || deployCreds.envFile.status})`);
    }

    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");

    const nixBin = String(deployCreds.values.NIX_BIN || "nix").trim() || "nix";
    const ageKeyFile = resolveAgeKeyFile({
      operatorArg: (args as any).operator,
      ageKeyFileArg: (args as any).ageKeyFile,
      deployCredsAgeKeyFile: deployCreds.values.SOPS_AGE_KEY_FILE,
      layout,
    });
    requireFile(ageKeyFile, "SOPS_AGE_KEY_FILE");

    const identityRaw = String(args.identity || "").trim();
    if (!identityRaw) throw new Error("missing --identity");
    const identity = loadIdentity({ repoRoot, identityName: identityRaw });

    const taskFileRaw = String((args as any).taskFile || "").trim();
    if (!taskFileRaw) throw new Error("missing --task-file");
    const taskFile = path.isAbsolute(taskFileRaw) ? taskFileRaw : path.resolve(cwd, taskFileRaw);
    requireFile(taskFile, "task file");

    const taskFromFile = loadTaskFromFile(taskFile);
    const task: CattleTask = {
      ...taskFromFile,
      callbackUrl: String(args.callbackUrl || taskFromFile.callbackUrl || config.cattle?.defaults?.callbackUrl || "").trim(),
    };

    const ttlRaw = String(args.ttl || config.cattle?.hetzner?.defaultTtl || "").trim();
    const ttl = requireTtlSeconds(ttlRaw);
    const createdAt = unixSecondsNow();
    const expiresAt = createdAt + ttl.seconds;

    const image = String(args.image || config.cattle?.hetzner?.image || "").trim();
    if (!image) throw new Error("missing cattle.hetzner.image (set in fleet/clawdlets.json)");
    const serverType = String(args.serverType || config.cattle?.hetzner?.serverType || "cx22").trim() || "cx22";
    const location = String(args.location || config.cattle?.hetzner?.location || "nbg1").trim() || "nbg1";

    const existing = await listCattleServers({ token: hcloudToken });
    const maxInstances = Number(config.cattle?.hetzner?.maxInstances || 0);
    if (Number.isFinite(maxInstances) && maxInstances > 0 && existing.length >= maxInstances) {
      throw new Error(`maxInstances reached (${existing.length}/${maxInstances}); destroy/reap before spawning more`);
    }

    const adminAuthorizedKeys = hostCfg.sshAuthorizedKeys || [];
    if (!Array.isArray(adminAuthorizedKeys) || adminAuthorizedKeys.length === 0) {
      throw new Error(`sshAuthorizedKeys is empty for host ${hostName} (needed for cattle ssh/logs)`);
    }

    const hostSecretsDir = getHostSecretsDir(layout, hostName);
    const tailscaleAuthKey = await decryptHostSecretScalar({
      repoRoot,
      hostSecretsDir,
      secretName: "tailscale_auth_key",
      ageKeyFile,
      nixBin,
    });

    const env: Record<string, string> = {};
    if (deployCreds.values.GITHUB_TOKEN) env.GITHUB_TOKEN = String(deployCreds.values.GITHUB_TOKEN);

    const model = String(args.model || identity.config.model.primary || hostCfg.agentModelPrimary || "").trim();
    if (!model) throw new Error("missing model (set identities/<name>/config.json model.primary or hosts.<host>.agentModelPrimary)");
    const envSecrets = (config.fleet?.envSecrets || {}) as Record<string, string>;
    const envPlan = buildEnvForModel({ configEnvSecrets: envSecrets, model });
    for (const envVar of envPlan.requiredEnvVars) {
      const secretName = envPlan.secretNamesByEnvVar[envVar]!;
      env[envVar] = await decryptHostSecretScalar({
        repoRoot,
        hostSecretsDir,
        secretName,
        ageKeyFile,
        nixBin,
      });
    }

    const autoShutdown = args.autoShutdown ?? Boolean(config.cattle?.defaults?.autoShutdown ?? true);
    if (!autoShutdown) env["CLAWDLETS_CATTLE_AUTO_SHUTDOWN"] = "0";

    const name = buildCattleServerName(identity.name, createdAt);

    const userData = buildCattleCloudInitUserData({
      hostname: name,
      adminAuthorizedKeys,
      tailscaleAuthKey,
      task,
      env,
      extraWriteFiles: identity.cloudInitFiles,
    });

    const labels: Record<string, string> = {
      ...(config.cattle?.hetzner?.labels || {}),
      [CATTLE_LABEL_MANAGED_BY]: CATTLE_LABEL_MANAGED_BY_VALUE,
      [CATTLE_LABEL_CATTLE]: CATTLE_LABEL_CATTLE_VALUE,
      [CATTLE_LABEL_IDENTITY]: safeCattleLabelValue(identity.name, "id"),
      [CATTLE_LABEL_TASK_ID]: safeCattleLabelValue(task.taskId, "task"),
      [CATTLE_LABEL_CREATED_AT]: String(createdAt),
      [CATTLE_LABEL_EXPIRES_AT]: String(expiresAt),
    };

    if (args.dryRun) {
      console.log(
        JSON.stringify(
          {
            action: "hcloud.server.create",
            name,
            image,
            serverType,
            location,
            labels,
            userDataBytes: Buffer.byteLength(userData, "utf8"),
            ttl: ttl.normalized,
            createdAt,
            expiresAt,
          },
          null,
          2,
        ),
      );
      return;
    }

    const server = await createCattleServer({
      token: hcloudToken,
      name,
      image,
      serverType,
      location,
      userData,
      labels,
    });

    const st = openCattleState(layout.cattleDbPath);
    try {
      st.upsertServer({
        id: server.id,
        name: server.name,
        identity: identity.name,
        task: task.message.split("\n")[0]?.slice(0, 200) || task.taskId,
        taskId: task.taskId,
        ttlSeconds: ttl.seconds,
        createdAt,
        expiresAt,
        labels,
        lastStatus: server.status,
        lastIpv4: server.ipv4,
      });
    } finally {
      st.close();
    }

    console.log(`ok: spawned ${server.name} (id=${server.id} ipv4=${server.ipv4 || "?"} ttl=${ttl.normalized})`);
  },
});

const cattleList = defineCommand({
  meta: { name: "list", description: "List active cattle servers (Hetzner + local state reconciliation)." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { layout, config } = ctx;

    requireEnabled({
      enabled: Boolean(config.cattle?.enabled),
      hint: "cattle is disabled (set cattle.enabled=true in fleet/clawdlets.json)",
    });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");

    const servers = await listCattleServers({ token: hcloudToken, labelSelector: buildCattleLabelSelector() });

    const now = unixSecondsNow();
    const byId = new Map<string, CattleServer>();
    for (const s of servers) byId.set(s.id, s);

    const st = openCattleState(layout.cattleDbPath);
    try {
      const activeLocal = st.listActive();
      const remoteIds = new Set<string>(servers.map((s) => s.id));
      for (const local of activeLocal) {
        if (!remoteIds.has(local.id)) st.markDeletedById(local.id, now);
      }

      for (const s of servers) {
        const existing = st.findActiveByIdOrName(s.id);
        st.upsertServer({
          id: s.id,
          name: s.name,
          identity: s.identity || existing?.identity || "",
          task: existing?.task || s.taskId || "",
          taskId: s.taskId || existing?.taskId || "",
          ttlSeconds: s.ttlSeconds,
          createdAt: Math.floor(s.createdAt.getTime() / 1000),
          expiresAt: Math.floor(s.expiresAt.getTime() / 1000),
          labels: s.labels || existing?.labels || {},
          lastStatus: s.status,
          lastIpv4: s.ipv4,
        });
      }
    } finally {
      st.close();
    }

    const sorted = [...servers].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));

    if (args.json) {
      console.log(JSON.stringify({ servers: sorted }, null, 2));
      return;
    }

    const rows: string[][] = [
      ["ID", "NAME", "IDENTITY", "TASK", "STATUS", "TTL"],
      ...sorted.map((s) => {
        const ttlLeft = Math.max(0, Math.floor(s.expiresAt.getTime() / 1000) - now);
        return [s.id, s.name, s.identity || "-", s.taskId || "-", s.status, formatAgeSeconds(ttlLeft)];
      }),
    ];

    console.log(formatTable(rows));
  },
});

function resolveOne(servers: CattleServer[], idOrName: string): CattleServer {
  const v = String(idOrName || "").trim();
  if (!v) throw new Error("missing id/name");
  const byId = servers.find((s) => s.id === v);
  if (byId) return byId;
  const byName = servers.find((s) => s.name === v);
  if (byName) return byName;
  throw new Error(`cattle server not found: ${v}`);
}

const cattleDestroy = defineCommand({
  meta: { name: "destroy", description: "Destroy cattle servers (Hetzner delete)." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    idOrName: { type: "string", description: "Cattle server id or name." },
    all: { type: "boolean", description: "Destroy all cattle servers.", default: false },
    identity: { type: "string", description: "Filter by identity (with --all)." },
    dryRun: { type: "boolean", description: "Print plan without deleting.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { layout, config } = ctx;

    requireEnabled({
      enabled: Boolean(config.cattle?.enabled),
      hint: "cattle is disabled (set cattle.enabled=true in fleet/clawdlets.json)",
    });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");

    const identityFilterRaw = String(args.identity || "").trim();
    const identityFilter = identityFilterRaw ? safeCattleLabelValue(identityFilterRaw, "id") : "";

    const servers = await listCattleServers({
      token: hcloudToken,
      labelSelector: buildCattleLabelSelector(identityFilter ? { [CATTLE_LABEL_IDENTITY]: identityFilter } : {}),
    });

    const targets: CattleServer[] = [];
    if (args.all) {
      targets.push(...servers);
    } else {
      const idOrName = String(args.idOrName || "").trim();
      if (!idOrName) throw new Error("missing <idOrName> (or pass --all)");
      targets.push(resolveOne(servers, idOrName));
    }

    if (targets.length === 0) {
      console.log("ok: no matching cattle servers");
      return;
    }

    const st = openCattleState(layout.cattleDbPath);
    try {
      if (args.dryRun) {
        console.log(formatTable([["ID", "NAME", "IDENTITY", "TASK", "STATUS"], ...targets.map((s) => [s.id, s.name, s.identity || "-", s.taskId || "-", s.status])]));
        return;
      }

      const now = unixSecondsNow();
      for (const t of targets) {
        await destroyCattleServer({ token: hcloudToken, id: t.id });
        st.markDeletedById(t.id, now);
      }
    } finally {
      st.close();
    }

    console.log(`ok: destroyed ${targets.length} cattle server(s)`);
  },
});

const cattleReap = defineCommand({
  meta: { name: "reap", description: "Destroy expired cattle servers (TTL enforcement)." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    dryRun: { type: "boolean", description: "Print plan without deleting.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { layout, config } = ctx;

    requireEnabled({
      enabled: Boolean(config.cattle?.enabled),
      hint: "cattle is disabled (set cattle.enabled=true in fleet/clawdlets.json)",
    });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");

    const now = unixSecondsNow();
    const res = await reapExpiredCattle({
      token: hcloudToken,
      labelSelector: buildCattleLabelSelector(),
      now: new Date(now * 1000),
      dryRun: args.dryRun,
    });
    const expired = res.expired;

    if (expired.length === 0) {
      console.log("ok: no expired cattle servers");
      return;
    }

    console.log(
      formatTable([
        ["ID", "NAME", "IDENTITY", "TASK", "EXPIRES", "STATUS"],
        ...expired.map((s) => [s.id, s.name, s.identity || "-", s.taskId || "-", String(Math.floor(s.expiresAt.getTime() / 1000)), s.status]),
      ]),
    );

    if (args.dryRun) return;

    const st = openCattleState(layout.cattleDbPath);
    try {
      for (const id of res.deletedIds) {
        st.markDeletedById(id, now);
      }
    } finally {
      st.close();
    }

    console.log(`ok: reaped ${res.deletedIds.length} cattle server(s)`);
  },
});

const cattleLogs = defineCommand({
  meta: { name: "logs", description: "Stream logs from a cattle VM over tailnet SSH." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    idOrName: { type: "string", description: "Cattle server id or name.", required: true },
    lines: { type: "string", description: "Number of lines (default: 200).", default: "200" },
    since: { type: "string", description: "Time window (journalctl syntax, e.g. '10m ago')." },
    follow: { type: "boolean", description: "Follow logs.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { config } = ctx;

    requireEnabled({
      enabled: Boolean(config.cattle?.enabled),
      hint: "cattle is disabled (set cattle.enabled=true in fleet/clawdlets.json)",
    });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");

    const servers = await listCattleServers({ token: hcloudToken, labelSelector: buildCattleLabelSelector() });
    const server = resolveOne(servers, String((args as any).idOrName || ""));

    const ip = await resolveTailscaleIpv4(server.name);
    const targetHost = `admin@${ip}`;

    const n = String(args.lines || "200").trim() || "200";
    if (!/^\d+$/.test(n) || Number(n) <= 0) throw new Error(`invalid --lines: ${n}`);

    const since = args.since ? String(args.since).trim() : "";
    const remoteCmd = [
      "sudo",
      "journalctl",
      "-u",
      shellQuote("clawdlets-cattle.service"),
      "-n",
      shellQuote(n),
      ...(since ? ["--since", shellQuote(since)] : []),
      ...(args.follow ? ["-f"] : []),
      "--no-pager",
    ].join(" ");

    await sshRun(targetHost, remoteCmd, { redact: [] });
  },
});

const cattleSsh = defineCommand({
  meta: { name: "ssh", description: "SSH into a cattle VM over tailnet (admin@<tailscale-ip>)." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    idOrName: { type: "string", description: "Cattle server id or name.", required: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { config } = ctx;

    requireEnabled({
      enabled: Boolean(config.cattle?.enabled),
      hint: "cattle is disabled (set cattle.enabled=true in fleet/clawdlets.json)",
    });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawdlets/env or env var; run: clawdlets env init)");

    const servers = await listCattleServers({ token: hcloudToken, labelSelector: buildCattleLabelSelector() });
    const server = resolveOne(servers, String((args as any).idOrName || ""));

    const ip = await resolveTailscaleIpv4(server.name);
    const targetHost = `admin@${ip}`;

    await run("ssh", ["-t", "--", targetHost], { redact: [] });
  },
});

export const cattle = defineCommand({
  meta: { name: "cattle", description: "Cattle (ephemeral agents on Hetzner Cloud)." },
  subCommands: {
    spawn: cattleSpawn,
    list: cattleList,
    destroy: cattleDestroy,
    reap: cattleReap,
    logs: cattleLogs,
    ssh: cattleSsh,
  },
});
