import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { CLF_PROTOCOL_VERSION, createClfClient } from "@clawdlets/clf-queue";
import { sanitizeOperatorId } from "@clawdlets/core/lib/identifiers";
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds";
import { parseTtlToSeconds } from "@clawdlets/core/lib/ttl";
import { CattleTaskSchema, CATTLE_TASK_SCHEMA_VERSION, type CattleTask } from "@clawdlets/core/lib/cattle-task";
import {
  CATTLE_LABEL_IDENTITY,
  buildCattleLabelSelector,
  destroyCattleServer,
  listCattleServers,
  reapExpiredCattle,
  type CattleServer,
} from "@clawdlets/core/lib/hcloud-cattle";
import { safeCattleLabelValue } from "@clawdlets/core/lib/cattle-planner";
import { openCattleState } from "@clawdlets/core/lib/cattle-state";
import { run, capture } from "@clawdlets/core/lib/run";
import { shellQuote, sshRun } from "@clawdlets/core/lib/ssh-remote";
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

async function waitForClfJobTerminal(params: {
  client: { show: (jobId: string) => Promise<{ job: any }> };
  jobId: string;
  timeoutMs: number;
  pollMs: number;
}): Promise<any> {
  const start = Date.now();
  while (true) {
    const res = await params.client.show(params.jobId);
    const job = res.job;
    if (job?.status === "done" || job?.status === "failed" || job?.status === "canceled") return job;
    if (Date.now() - start > params.timeoutMs) {
      throw new Error(`timeout waiting for job ${params.jobId} (last=${String(job?.status || "")})`);
    }
    await new Promise((r) => setTimeout(r, params.pollMs));
  }
}

const cattleSpawn = defineCommand({
  meta: { name: "spawn", description: "Enqueue a cattle.spawn job via clf-orchestrator (no secrets in user_data)." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    identity: { type: "string", description: "Identity name.", required: true },
    taskFile: { type: "string", description: "Task JSON file (schemaVersion 1).", required: true },
    ttl: { type: "string", description: "TTL override (default: cattle.hetzner.defaultTtl)." },
    image: { type: "string", description: "Hetzner image override (default: cattle.hetzner.image)." },
    serverType: { type: "string", description: "Hetzner server type override (default: cattle.hetzner.serverType)." },
    location: { type: "string", description: "Hetzner location override (default: cattle.hetzner.location)." },
    autoShutdown: { type: "boolean", description: "Auto poweroff after task (default: cattle.defaults.autoShutdown)." },
    withGithubToken: { type: "boolean", description: "Include GITHUB_TOKEN in cattle env (explicit).", default: false },
    socket: { type: "string", description: "clf-orchestrator unix socket path (default: /run/clf/orchestrator.sock)." },
    requester: { type: "string", description: "Requester id (default: $USER)." },
    idempotencyKey: { type: "string", description: "Idempotency key (optional)." },
    wait: { type: "boolean", description: "Wait for job completion.", default: true },
    waitTimeout: { type: "string", description: "Wait timeout seconds.", default: "300" },
    dryRun: { type: "boolean", description: "Print enqueue request without enqueueing.", default: false },
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

    const identity = String(args.identity || "").trim();
    if (!identity) throw new Error("missing --identity");

    const taskFileRaw = String((args as any).taskFile || "").trim();
    if (!taskFileRaw) throw new Error("missing --task-file");
    const taskFile = path.isAbsolute(taskFileRaw) ? taskFileRaw : path.resolve(cwd, taskFileRaw);
    requireFile(taskFile, "task file");

    const taskFromFile = loadTaskFromFile(taskFile);
    const task: CattleTask = { ...taskFromFile, callbackUrl: "" };

    const ttlRaw = String(args.ttl || config.cattle?.hetzner?.defaultTtl || "").trim();
    if (ttlRaw) requireTtlSeconds(ttlRaw);

    const payload = {
      identity,
      task,
      ttl: ttlRaw,
      image: String(args.image || config.cattle?.hetzner?.image || "").trim(),
      serverType: String(args.serverType || config.cattle?.hetzner?.serverType || "").trim(),
      location: String(args.location || config.cattle?.hetzner?.location || "").trim(),
      ...(typeof (args as any).autoShutdown === "boolean"
        ? { autoShutdown: Boolean((args as any).autoShutdown) }
        : typeof config.cattle?.defaults?.autoShutdown === "boolean"
          ? { autoShutdown: Boolean(config.cattle.defaults.autoShutdown) }
          : {}),
      ...((args as any).withGithubToken ? { withGithubToken: true } : {}),
    };

    const socketPath = String((args as any).socket || process.env.CLF_SOCKET_PATH || "/run/clf/orchestrator.sock").trim();
    if (!socketPath) throw new Error("missing --socket (or set CLF_SOCKET_PATH)");

    const requester = sanitizeOperatorId(String((args as any).requester || process.env.USER || "operator"));
    const idempotencyKey = String((args as any).idempotencyKey || "").trim();

    const request = {
      protocolVersion: CLF_PROTOCOL_VERSION,
      requester,
      idempotencyKey,
      kind: "cattle.spawn",
      payload,
      runAt: "",
      priority: 0,
    } as const;

    if (args.dryRun) {
      console.log(JSON.stringify({ action: "clf.jobs.enqueue", socketPath, request }, null, 2));
      return;
    }

    const client = createClfClient({ socketPath });
    const res = await client.enqueue(request);

    const waitTimeoutRaw = String((args as any).waitTimeout || "300").trim();
    if (!/^\d+$/.test(waitTimeoutRaw) || Number(waitTimeoutRaw) <= 0) {
      throw new Error(`invalid --wait-timeout: ${waitTimeoutRaw}`);
    }
    const timeoutMs = Number(waitTimeoutRaw) * 1000;

    if (!args.wait) {
      console.log(res.jobId);
      return;
    }

    const job = await waitForClfJobTerminal({
      client,
      jobId: res.jobId,
      timeoutMs,
      pollMs: 1_000,
    });

    if (job.status !== "done") {
      const err = String(job.lastError || "").trim();
      throw new Error(`spawn job ${res.jobId} ${job.status}${err ? `: ${err}` : ""}`);
    }

    const server = (job.result as any)?.server;
    if (server && typeof server === "object") {
      const id = String((server as any).id || "").trim();
      const name = String((server as any).name || "").trim();
      const ipv4 = String((server as any).ipv4 || "").trim();
      const createdAtIso = String((server as any).createdAt || "").trim();
      const expiresAtIso = String((server as any).expiresAt || "").trim();

      const createdAt = Number.isFinite(Date.parse(createdAtIso)) ? Math.floor(Date.parse(createdAtIso) / 1000) : unixSecondsNow();
      const expiresAt = Number.isFinite(Date.parse(expiresAtIso)) ? Math.floor(Date.parse(expiresAtIso) / 1000) : 0;
      const ttlSeconds =
        typeof (server as any).ttlSeconds === "number" && Number.isFinite((server as any).ttlSeconds)
          ? Math.max(0, Math.floor((server as any).ttlSeconds))
          : Math.max(0, expiresAt - createdAt);

      const labels =
        (server as any).labels && typeof (server as any).labels === "object" && !Array.isArray((server as any).labels)
          ? ((server as any).labels as Record<string, string>)
          : {};

      if (id && name) {
        const st = openCattleState(layout.cattleDbPath);
        try {
          st.upsertServer({
            id,
            name,
            identity: String((server as any).identity || identity),
            task: String((server as any).taskId || task.taskId),
            taskId: String((server as any).taskId || task.taskId),
            ttlSeconds,
            createdAt,
            expiresAt,
            labels,
            lastStatus: String((server as any).status || "unknown"),
            lastIpv4: ipv4,
          });
        } finally {
          st.close();
        }
      }

      console.log(`ok: spawned ${name || "cattle"} (id=${id || "?"} ipv4=${ipv4 || "?"} job=${res.jobId})`);
      return;
    }

    console.log(`ok: spawn completed (job=${res.jobId})`);
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
