import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clf-orchestrator http", () => {
  it("enqueues, lists, shows, cancels", async () => {
    const { openClfQueue } = await import("@clawdlets/clf-queue");
    const { createOrchestratorHttpServer } = await import("../src/http");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-orchestrator-"));
    const dbPath = path.join(dir, "state.sqlite");
    const q = openClfQueue(dbPath);

    const server = createOrchestratorHttpServer({ queue: q });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      const health = await fetch(`${base}/healthz`);
      expect(health.status).toBe(200);

      const enqueue = await fetch(`${base}/v1/jobs/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 1,
          requester: "maren",
          idempotencyKey: "msg-1",
          kind: "cattle.reap",
          payload: { dryRun: true },
        }),
      });
      expect(enqueue.status).toBe(200);
      const enqJson = (await enqueue.json()) as { jobId: string };
      expect(enqJson.jobId).toBeTruthy();

      const list = await fetch(`${base}/v1/jobs?requester=maren`);
      expect(list.status).toBe(200);
      const listJson = (await list.json()) as { jobs: Array<{ jobId: string }> };
      expect(listJson.jobs.some((j) => j.jobId === enqJson.jobId)).toBe(true);

      const show = await fetch(`${base}/v1/jobs/${encodeURIComponent(enqJson.jobId)}`);
      expect(show.status).toBe(200);
      const showJson = (await show.json()) as { job: { jobId: string; payload: unknown } };
      expect(showJson.job.jobId).toBe(enqJson.jobId);

      const cancel = await fetch(`${base}/v1/jobs/${encodeURIComponent(enqJson.jobId)}/cancel`, { method: "POST" });
      expect(cancel.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      q.close();
    }
  });
});

describe("clf-orchestrator worker", () => {
  it("processes a cattle.spawn job (mocked hcloud)", async () => {
    vi.mock("@clawdlets/core/lib/hcloud-cattle", async () => {
      const actual = await vi.importActual<typeof import("@clawdlets/core/lib/hcloud-cattle")>("@clawdlets/core/lib/hcloud-cattle");
      return {
        ...actual,
        listCattleServers: vi.fn(async () => []),
        createCattleServer: vi.fn(async (opts: any) => ({
          id: "1",
          name: String(opts.name),
          identity: String(opts.labels?.identity || ""),
          taskId: String(opts.labels?.["task-id"] || ""),
          ttlSeconds: 60,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          expiresAt: new Date("2026-01-01T00:01:00Z"),
          ipv4: "1.2.3.4",
          status: "running",
          labels: opts.labels || {},
        })),
        reapExpiredCattle: vi.fn(async () => ({ expired: [], deletedIds: [] })),
      };
    });

    const { openClfQueue } = await import("@clawdlets/clf-queue");
    const { runClfWorkerLoop } = await import("../src/worker");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-orchestrator-"));
    const dbPath = path.join(dir, "state.sqlite");
    const identitiesRoot = path.join(dir, "identities");
    fs.mkdirSync(path.join(identitiesRoot, "rex"), { recursive: true });
    fs.writeFileSync(path.join(identitiesRoot, "rex", "SOUL.md"), "hi\n");
    fs.writeFileSync(
      path.join(identitiesRoot, "rex", "config.json"),
      JSON.stringify({ schemaVersion: 1, model: { primary: "openai/gpt-4o", fallbacks: [] } }, null, 2),
    );

    const q = openClfQueue(dbPath);
    try {
      const { jobId } = q.enqueue({
        kind: "cattle.spawn",
        requester: "maren",
        payload: {
          identity: "rex",
          ttl: "1m",
          task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "do it", callbackUrl: "" },
        },
      });

      const stopSignal = { stopped: false };
      const workerPromise = runClfWorkerLoop({
        queue: q,
        workerId: "w1",
        pollMs: 10,
        leaseMs: 60_000,
        leaseRefreshMs: 10,
        runtime: {
          hcloudToken: "token",
          cattle: {
            image: "img",
            serverType: "cx22",
            location: "nbg1",
            maxInstances: 10,
            defaultTtl: "2h",
            labels: {},
            defaultAutoShutdown: true,
            secretsBaseUrl: "http://clawdlets-pet:18337",
            bootstrapTtlMs: 60_000,
          },
          identitiesRoot,
          adminAuthorizedKeys: ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockKey"],
          tailscaleAuthKey: "tskey-auth-123",
          env: { OPENAI_API_KEY: "x", OPEN_AI_APIKEY: "x" },
        },
        stopSignal,
      });

      for (let i = 0; i < 200; i++) {
        const j = q.get(jobId);
        if (j?.status === "done") break;
        await new Promise((r) => setTimeout(r, 10));
      }

      const done = q.get(jobId);
      expect(done?.status).toBe("done");
      expect((done?.result as any)?.server?.ipv4).toBe("1.2.3.4");

      stopSignal.stopped = true;
      await workerPromise;
    } finally {
      q.close();
    }
  });
});
