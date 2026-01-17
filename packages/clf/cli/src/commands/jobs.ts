import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import {
  CLF_PROTOCOL_VERSION,
  ClfJobKindSchema,
  createClfClient,
  type ClfJobKind,
} from "@clawdlets/clf-queue";
import { CattleTaskSchema, CATTLE_TASK_SCHEMA_VERSION, type CattleTask } from "@clawdlets/core/lib/cattle-task";
import { formatTable, printJson } from "../lib/output.js";
import { classifyError, exitCodeFor } from "../lib/errors.js";

function requireString(value: unknown, label: string): string {
  const v = String(value ?? "").trim();
  if (!v) throw new Error(`${label} missing`);
  return v;
}

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid JSON: ${filePath} (${String((e as Error)?.message || e)})`);
  }
}

function parseJobKindFromArgs(args: any): ClfJobKind {
  const positional = Array.isArray(args._) && args._.length > 0 ? String(args._[0] || "").trim() : "";
  const raw = String(args.kind || positional || "").trim();
  return ClfJobKindSchema.parse(raw);
}

function socketPathFromArgs(args: any): string {
  return String(args.socket || process.env.CLF_SOCKET_PATH || "/run/clf/orchestrator.sock").trim();
}

function parseCattleTask(params: {
  cwd: string;
  taskFile?: unknown;
  taskId?: unknown;
  message?: unknown;
  callbackUrl?: unknown;
}): CattleTask {
  const taskFileRaw = String(params.taskFile || "").trim();
  if (taskFileRaw) {
    const filePath = path.isAbsolute(taskFileRaw) ? taskFileRaw : path.resolve(params.cwd, taskFileRaw);
    if (!fs.existsSync(filePath)) throw new Error(`task file missing: ${filePath}`);
    const raw = readJsonFile(filePath);
    const parsed = CattleTaskSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`invalid task file (expected schemaVersion ${CATTLE_TASK_SCHEMA_VERSION}): ${filePath}`);
    return parsed.data;
  }

  const taskId = requireString(params.taskId, "--task-id");
  const message = requireString(params.message, "--message");
  const callbackUrl = String(params.callbackUrl || "").trim();
  return CattleTaskSchema.parse({
    schemaVersion: CATTLE_TASK_SCHEMA_VERSION,
    taskId,
    type: "clawdbot.gateway.agent",
    message,
    callbackUrl,
  });
}

function failJson(message: string): void {
  printJson({ ok: false, error: { message } });
}

const jobsEnqueue = defineCommand({
  meta: { name: "enqueue", description: "Enqueue a job." },
  args: {
    socket: { type: "string", description: "Unix socket path (default: /run/clf/orchestrator.sock)." },
    kind: { type: "string", description: "Job kind (or pass as positional)." },
    requester: { type: "string", description: "Requester id (bot/user).", required: true },
    idempotencyKey: { type: "string", description: "Idempotency key (e.g. Discord message id)." },
    runAt: { type: "string", description: "Run at (ISO time).", default: "" },
    priority: { type: "string", description: "Priority int (higher runs first).", default: "0" },
    json: { type: "boolean", description: "JSON output.", default: false },

    // cattle.spawn
    identity: { type: "string", description: "Identity name." },
    taskFile: { type: "string", description: "Task JSON file (schemaVersion 1)." },
    taskId: { type: "string", description: "Task id (when not using --task-file)." },
    message: { type: "string", description: "Task message (when not using --task-file)." },
    callbackUrl: { type: "string", description: "Callback URL (when constructing task)." },
    ttl: { type: "string", description: "TTL (e.g. 30m, 2h)." },
    image: { type: "string", description: "Hetzner image override." },
    serverType: { type: "string", description: "Hetzner server type override." },
    location: { type: "string", description: "Hetzner location override." },
    autoShutdown: { type: "boolean", description: "Auto poweroff after task." },

    // cattle.reap
    dryRun: { type: "boolean", description: "Dry-run reap.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const jsonMode = Boolean((args as any).json);

    try {
      const kind = parseJobKindFromArgs(args);
      const requester = requireString((args as any).requester, "--requester");
      const socketPath = socketPathFromArgs(args);
      const idempotencyKey = String((args as any).idempotencyKey || "").trim();
      const runAt = String((args as any).runAt || "").trim();
      const prioRaw = String((args as any).priority || "0").trim();
      if (!/^-?\d+$/.test(prioRaw)) throw new Error(`invalid --priority: ${prioRaw}`);
      const priority = Number(prioRaw);

      const client = createClfClient({ socketPath });

      let payload: unknown;
      if (kind === "cattle.spawn") {
        const identity = requireString((args as any).identity, "--identity");
        const task = parseCattleTask({
          cwd,
          taskFile: (args as any).taskFile,
          taskId: (args as any).taskId,
          message: (args as any).message,
          callbackUrl: (args as any).callbackUrl,
        });
        payload = {
          identity,
          task,
          ttl: String((args as any).ttl || "").trim(),
          image: String((args as any).image || "").trim(),
          serverType: String((args as any).serverType || "").trim(),
          location: String((args as any).location || "").trim(),
          ...(typeof (args as any).autoShutdown === "boolean" ? { autoShutdown: Boolean((args as any).autoShutdown) } : {}),
        };
      } else if (kind === "cattle.reap") {
        payload = { dryRun: Boolean((args as any).dryRun) };
      } else {
        throw new Error(`unsupported job kind: ${kind}`);
      }

      const res = await client.enqueue({
        protocolVersion: CLF_PROTOCOL_VERSION,
        requester,
        idempotencyKey,
        kind,
        payload,
        runAt,
        priority,
      });

      if (jsonMode) printJson(res);
      else console.log(res.jobId);
    } catch (e) {
      const { kind, message } = classifyError(e);
      if (jsonMode) failJson(message);
      else console.error(message);
      process.exitCode = exitCodeFor(kind === "unknown" ? "user" : kind);
    }
  },
});

const jobsList = defineCommand({
  meta: { name: "list", description: "List jobs." },
  args: {
    socket: { type: "string", description: "Unix socket path (default: /run/clf/orchestrator.sock)." },
    requester: { type: "string", description: "Filter by requester." },
    status: { type: "string", description: "Filter by status (csv)." },
    kind: { type: "string", description: "Filter by kind (csv)." },
    limit: { type: "string", description: "Limit (default: 50).", default: "50" },
    json: { type: "boolean", description: "JSON output.", default: false },
  },
  async run({ args }) {
    const jsonMode = Boolean((args as any).json);
    try {
      const socketPath = socketPathFromArgs(args);
      const requester = String((args as any).requester || "").trim();
      const status = String((args as any).status || "").trim();
      const kind = String((args as any).kind || "").trim();
      const limitRaw = String((args as any).limit || "50").trim();
      if (!/^\d+$/.test(limitRaw)) throw new Error(`invalid --limit: ${limitRaw}`);
      const limit = Number(limitRaw);

      const client = createClfClient({ socketPath });
      const res = await client.list({ requester, status, kind, limit });

      if (jsonMode) {
        printJson(res);
        return;
      }

      const rows: string[][] = [
        ["JOB", "KIND", "STATUS", "ATT", "UPDATED"],
        ...res.jobs.map((j) => [
          j.jobId.slice(0, 8),
          j.kind,
          j.status,
          `${j.attempt}/${j.maxAttempts}`,
          j.updatedAt.replace("T", " ").replace("Z", ""),
        ]),
      ];
      console.log(formatTable(rows));
    } catch (e) {
      const { kind, message } = classifyError(e);
      if (jsonMode) failJson(message);
      else console.error(message);
      process.exitCode = exitCodeFor(kind === "unknown" ? "user" : kind);
    }
  },
});

const jobsShow = defineCommand({
  meta: { name: "show", description: "Show a job." },
  args: {
    socket: { type: "string", description: "Unix socket path (default: /run/clf/orchestrator.sock)." },
    jobId: { type: "string", description: "Job id.", required: true },
    json: { type: "boolean", description: "JSON output.", default: false },
  },
  async run({ args }) {
    const jsonMode = Boolean((args as any).json);
    try {
      const socketPath = socketPathFromArgs(args);
      const jobId = requireString((args as any).jobId, "--job-id");
      const client = createClfClient({ socketPath });
      const res = await client.show(jobId);
      if (jsonMode) printJson(res);
      else console.log(JSON.stringify(res, null, 2));
    } catch (e) {
      const { kind, message } = classifyError(e);
      if (jsonMode) failJson(message);
      else console.error(message);
      process.exitCode = exitCodeFor(kind === "unknown" ? "user" : kind);
    }
  },
});

const jobsCancel = defineCommand({
  meta: { name: "cancel", description: "Cancel a job (best-effort)." },
  args: {
    socket: { type: "string", description: "Unix socket path (default: /run/clf/orchestrator.sock)." },
    jobId: { type: "string", description: "Job id.", required: true },
    json: { type: "boolean", description: "JSON output.", default: false },
  },
  async run({ args }) {
    const jsonMode = Boolean((args as any).json);
    try {
      const socketPath = socketPathFromArgs(args);
      const jobId = requireString((args as any).jobId, "--job-id");
      const client = createClfClient({ socketPath });
      const res = await client.cancel(jobId);
      if (jsonMode) printJson(res);
      else console.log("ok");
    } catch (e) {
      const { kind, message } = classifyError(e);
      if (jsonMode) failJson(message);
      else console.error(message);
      process.exitCode = exitCodeFor(kind === "unknown" ? "user" : kind);
    }
  },
});

export const jobs = defineCommand({
  meta: { name: "jobs", description: "Queue + job operations (bot-facing)." },
  subCommands: {
    enqueue: jobsEnqueue,
    list: jobsList,
    show: jobsShow,
    cancel: jobsCancel,
  },
});

