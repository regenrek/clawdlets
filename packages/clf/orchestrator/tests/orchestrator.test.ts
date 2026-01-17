import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");

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

describe("clf-orchestrator cattle-http", () => {
  it("serves env for a valid one-time token", async () => {
    const { openClfQueue } = await import("@clawdlets/clf-queue");
    const { createCattleInternalHttpServer } = await import("../src/cattle-http");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-cattle-http-"));
    const dbPath = path.join(dir, "state.sqlite");
    const q = openClfQueue(dbPath);

    const server = createCattleInternalHttpServer({
      queue: q,
      env: { OPENAI_API_KEY: "secret", OTHER: "nope" },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      const missing = await fetch(`${base}/v1/cattle/env`);
      expect(missing.status).toBe(401);

      const invalid = await fetch(`${base}/v1/cattle/env`, { headers: { Authorization: "Bearer nope" } });
      expect(invalid.status).toBe(401);

      const { token } = q.createCattleBootstrapToken({
        jobId: "j1",
        requester: "maren",
        cattleName: "c1",
        envKeys: ["OPENAI_API_KEY"],
        publicEnv: { CLAWDLETS_CATTLE_AUTO_SHUTDOWN: "0" },
        ttlMs: 60_000,
      });

      const ok = await fetch(`${base}/v1/cattle/env`, { headers: { Authorization: `Bearer ${token}` } });
      expect(ok.status).toBe(200);
      const okJson = (await ok.json()) as any;
      expect(okJson.ok).toBe(true);
      expect(okJson.env).toEqual({ CLAWDLETS_CATTLE_AUTO_SHUTDOWN: "0", OPENAI_API_KEY: "secret" });

      const reused = await fetch(`${base}/v1/cattle/env`, { headers: { Authorization: `Bearer ${token}` } });
      expect(reused.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      q.close();
    }
  });

  it("rejects expired tokens", async () => {
    const { openClfQueue } = await import("@clawdlets/clf-queue");
    const { createCattleInternalHttpServer } = await import("../src/cattle-http");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-cattle-http-"));
    const dbPath = path.join(dir, "state.sqlite");
    const q = openClfQueue(dbPath);

    const server = createCattleInternalHttpServer({ queue: q, env: { OPENAI_API_KEY: "secret" } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      const { token } = q.createCattleBootstrapToken({
        jobId: "j1",
        requester: "maren",
        cattleName: "c1",
        envKeys: ["OPENAI_API_KEY"],
        publicEnv: {},
        now: 0,
        ttlMs: 30_000,
      });

      const res = await fetch(`${base}/v1/cattle/env`, { headers: { Authorization: `Bearer ${token}` } });
      expect(res.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      q.close();
    }
  });

  it("rejects invalid env var names (db corruption defense-in-depth)", async () => {
    const { openClfQueue } = await import("@clawdlets/clf-queue");
    const { createCattleInternalHttpServer } = await import("../src/cattle-http");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-cattle-http-"));
    const dbPath = path.join(dir, "state.sqlite");
    const q = openClfQueue(dbPath);

    const token = "t_" + Math.random().toString(16).slice(2);
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const db = new BetterSqlite3(dbPath);
    try {
      const now = Date.now();
      db.prepare(
        `
          insert into cattle_bootstrap_tokens (
            token_hash, created_at, expires_at, used_at,
            job_id, requester, cattle_name,
            env_keys_json, public_env_json
          ) values (
            @token_hash, @created_at, @expires_at, null,
            @job_id, @requester, @cattle_name,
            @env_keys_json, @public_env_json
          )
        `,
      ).run({
        token_hash: tokenHash,
        created_at: now,
        expires_at: now + 60_000,
        job_id: "j1",
        requester: "maren",
        cattle_name: "c1",
        env_keys_json: JSON.stringify(["BAD-NAME"]),
        public_env_json: JSON.stringify({}),
      });
    } finally {
      db.close();
    }

    const server = createCattleInternalHttpServer({ queue: q, env: { OPENAI_API_KEY: "secret" } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      const res = await fetch(`${base}/v1/cattle/env`, { headers: { Authorization: `Bearer ${token}` } });
      expect(res.status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      q.close();
    }
  });
});
