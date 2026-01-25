import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { CLF_PROTOCOL_VERSION, createClfClient } from "@clawdlets/clf-queue";
import { sanitizeOperatorId } from "@clawdlets/shared/lib/identifiers";
import { openCattleState } from "../../lib/cattle-state.js";
import { type CattleTask } from "@clawdlets/cattle-core/lib/cattle-task";
import { loadHostContextOrExit } from "@clawdlets/core/lib/context";
import { loadTaskFromFile, requireEnabled, requireFile, requireTtlSeconds, unixSecondsNow, waitForClfJobTerminal } from "./common.js";

export const cattleSpawn = defineCommand({
  meta: { name: "spawn", description: "Enqueue a cattle.spawn job via clf-orchestrator (no secrets in user_data)." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    persona: { type: "string", description: "Persona name.", required: true },
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

    const persona = String((args as any).persona || "").trim();
    if (!persona) throw new Error("missing --persona");

    const taskFileRaw = String((args as any).taskFile || "").trim();
    if (!taskFileRaw) throw new Error("missing --task-file");
    const taskFile = path.isAbsolute(taskFileRaw) ? taskFileRaw : path.resolve(cwd, taskFileRaw);
    requireFile(taskFile, "task file");

    const taskFromFile = loadTaskFromFile(taskFile);
    const task: CattleTask = { ...taskFromFile, callbackUrl: "" };

    const ttlRaw = String(args.ttl || config.cattle?.hetzner?.defaultTtl || "").trim();
    if (ttlRaw) requireTtlSeconds(ttlRaw);

    const payload = {
      persona,
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
            persona: String((server as any).persona || persona),
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
