import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

describe("clf queue", () => {
  it("enqueues + dedupes by (requester,idempotencyKey)", async () => {
    const { openClfQueue } = await import("../src/queue");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");

    const q = openClfQueue(dbPath);
    try {
      const a = q.enqueue({
        kind: "cattle.spawn",
        payload: { persona: "rex", task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "m", callbackUrl: "" } },
        requester: "maren",
        idempotencyKey: "msg-1",
      });
      const b = q.enqueue({
        kind: "cattle.spawn",
        payload: { persona: "rex", task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "m", callbackUrl: "" } },
        requester: "maren",
        idempotencyKey: "msg-1",
      });
      expect(a.jobId).toBe(b.jobId);
      expect(a.deduped).toBe(false);
      expect(b.deduped).toBe(true);
    } finally {
      q.close();
    }
  });

  it("rejects missing enqueue params and claim workerId", async () => {
    const { openClfQueue } = await import("../src/queue");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");

    const q = openClfQueue(dbPath);
    try {
      expect(() => q.enqueue({ kind: "", payload: {}, requester: "maren" })).toThrow(/enqueue\.kind missing/i);
      expect(() => q.enqueue({ kind: "cattle.spawn", payload: {}, requester: "" })).toThrow(/enqueue\.requester missing/i);
      expect(() => q.claimNext({ workerId: "", leaseMs: 1000 })).toThrow(/workerId missing/i);
    } finally {
      q.close();
    }
  });

  it("claims jobs, retries with backoff, and terminal-fails", async () => {
    const { openClfQueue } = await import("../src/queue");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");

    const q = openClfQueue(dbPath);
    try {
      const now = Date.now();
      const { jobId } = q.enqueue({
        kind: "cattle.spawn",
        payload: { persona: "rex", task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "m", callbackUrl: "" } },
        requester: "maren",
        runAt: now,
        maxAttempts: 2,
      });

      const claimed1 = q.claimNext({ workerId: "w1", now, leaseMs: 60_000 });
      expect(claimed1?.jobId).toBe(jobId);
      expect(claimed1?.attempt).toBe(1);

      const failed1 = q.fail({ jobId, workerId: "w1", now: now + 1000, error: "boom", retry: { baseMs: 5000, maxMs: 5000 } });
      expect(failed1?.status).toBe("queued");

      const rowAfterFail = q.get(jobId)!;
      expect(rowAfterFail.status).toBe("queued");
      expect(rowAfterFail.runAt).toBe(now + 1000 + 5000);

      const claimedTooEarly = q.claimNext({ workerId: "w2", now: now + 2000, leaseMs: 60_000 });
      expect(claimedTooEarly).toBeNull();

      const claimed2 = q.claimNext({ workerId: "w2", now: now + 1000 + 5000, leaseMs: 60_000 });
      expect(claimed2?.attempt).toBe(2);
      expect(claimed2?.lockedBy).toBe("w2");

      const failed2 = q.fail({ jobId, workerId: "w2", now: now + 1000 + 6000, error: "nope" });
      expect(failed2?.status).toBe("failed");

      const final = q.get(jobId)!;
      expect(final.status).toBe("failed");
      expect(final.lastError).toMatch(/nope/);
    } finally {
      q.close();
    }
  });

  it("reclaims lease-expired running jobs", async () => {
    const { openClfQueue } = await import("../src/queue");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");

    let jobId = "";
    const q1 = openClfQueue(dbPath);
    try {
      const now = 1_700_000_000_000;
      jobId = q1.enqueue({
        kind: "cattle.reap",
        payload: { dryRun: true },
        requester: "maren",
        runAt: now,
        maxAttempts: 3,
      }).jobId;

      const claimed1 = q1.claimNext({ workerId: "w1", now, leaseMs: 10_000 });
      expect(claimed1?.jobId).toBe(jobId);
      expect(claimed1?.attempt).toBe(1);

      const claimedTooSoon = q1.claimNext({ workerId: "w2", now: now + 1000, leaseMs: 10_000 });
      expect(claimedTooSoon).toBeNull();
    } finally {
      q1.close();
    }

    const q2 = openClfQueue(dbPath);
    try {
      const now = 1_700_000_000_000;
      const claimed2 = q2.claimNext({ workerId: "w2", now: now + 15_000, leaseMs: 10_000 });
      expect(claimed2?.jobId).toBe(jobId);
      expect(claimed2?.attempt).toBe(2);
      expect(claimed2?.lockedBy).toBe("w2");
    } finally {
      q2.close();
    }
  });

  it("records job_events.attempt consistently for claim/ack/cancel", async () => {
    const { openClfQueue } = await import("../src/queue");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");

    const q = openClfQueue(dbPath);
    let claimedJobId = "";
    let canceledJobId = "";
    try {
      const now = 1_700_000_000_000;
      claimedJobId = q.enqueue({
        kind: "cattle.reap",
        payload: { dryRun: true },
        requester: "maren",
        runAt: now,
      }).jobId;

      const canceled = q.enqueue({
        kind: "cattle.reap",
        payload: { dryRun: true },
        requester: "maren",
      });
      canceledJobId = canceled.jobId;

      const claimed = q.claimNext({ workerId: "w1", now, leaseMs: 60_000 });
      expect(claimed?.jobId).toBe(claimedJobId);
      expect(claimed?.attempt).toBe(1);

      expect(q.ack({ jobId: claimedJobId, workerId: "w1", now: now + 1000, result: { ok: true } })).toBe(true);
      expect(q.cancel({ jobId: canceledJobId, now: now + 2000 })).toBe(true);
    } finally {
      q.close();
    }

    const require = createRequire(import.meta.url);
    const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new BetterSqlite3(dbPath, { readonly: true });
    try {
      const events = db.prepare(`select type, attempt from job_events where job_id = @job_id`).all({ job_id: claimedJobId }) as Array<{
        type: string;
        attempt: number;
      }>;
      const byType = new Map(events.map((e) => [e.type, e.attempt] as const));
      expect(byType.get("enqueue")).toBe(0);
      expect(byType.get("claim")).toBe(1);
      expect(byType.get("ack")).toBe(1);

      const cancelEvents = db
        .prepare(`select type, attempt from job_events where job_id = @job_id`)
        .all({ job_id: canceledJobId }) as Array<{ type: string; attempt: number }>;
      const cancelByType = new Map(cancelEvents.map((e) => [e.type, e.attempt] as const));
      expect(cancelByType.get("enqueue")).toBe(0);
      expect(cancelByType.get("cancel")).toBe(0);
    } finally {
      db.close();
    }
  });

  it("handles list filters, ack/cancel false cases, and prune", async () => {
    const { openClfQueue } = await import("../src/queue");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");

    const q = openClfQueue(dbPath);
    try {
      const now = 1_700_000_000_000;
      const a = q.enqueue({
        kind: "cattle.spawn",
        payload: { persona: "rex", task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "m", callbackUrl: "" } },
        requester: "maren",
        runAt: now,
      }).jobId;
      const b = q.enqueue({
        kind: "cattle.reap",
        payload: { dryRun: true },
        requester: "sonja",
        runAt: now,
      }).jobId;

      const claim = q.claimNext({ workerId: "w1", now, leaseMs: 60_000 });
      expect(claim?.jobId).toBeTruthy();
      const claimedId = claim?.jobId as string;
      const otherId = claimedId === a ? b : a;
      expect(q.ack({ jobId: claimedId, workerId: "w1", now: now + 1000 })).toBe(true);
      expect(q.cancel({ jobId: otherId, now: now + 2000 })).toBe(true);

      const byRequester = q.list({ requester: "maren" });
      expect(byRequester.length).toBe(1);
      const byStatus = q.list({ statuses: ["canceled"] });
      expect(byStatus.some((j) => j.jobId === otherId)).toBe(true);
      const byKind = q.list({ kinds: ["cattle.spawn"], limit: 1 });
      expect(byKind.length).toBe(1);

      expect(q.ack({ jobId: "nope", workerId: "w1", now })).toBe(false);
      expect(q.cancel({ jobId: "nope", now })).toBe(false);

      const require = createRequire(import.meta.url);
      const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
      const db = new BetterSqlite3(dbPath);
      try {
        const old = now - 10 * 86400_000;
        db.prepare(`update jobs set created_at = @old, updated_at = @old where job_id = @job_id`).run({ old, job_id: a });
        db.prepare(`update jobs set created_at = @old, updated_at = @old where job_id = @job_id`).run({ old, job_id: b });
      } finally {
        db.close();
      }

      const pruned = q.prune({ now, keepDays: 1 });
      expect(pruned).toBeGreaterThan(0);
      expect(q.get(a)).toBeNull();
      expect(q.get(b)).toBeNull();
    } finally {
      q.close();
    }
  });

  it("handles extendLease and ack/cancel mismatch", async () => {
    const { openClfQueue } = await import("../src/queue");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");

    const q = openClfQueue(dbPath);
    try {
      const now = 1_700_000_000_000;
      const jobId = q.enqueue({
        kind: "cattle.reap",
        payload: { dryRun: true },
        requester: "maren",
        runAt: now,
      }).jobId;

      const claimed = q.claimNext({ workerId: "w1", now, leaseMs: 60_000 });
      expect(claimed?.jobId).toBe(jobId);

      expect(q.extendLease({ jobId: "", workerId: "w1", leaseUntil: now + 1000 })).toBe(false);
      expect(q.extendLease({ jobId, workerId: "", leaseUntil: now + 1000 })).toBe(false);
      expect(q.extendLease({ jobId, workerId: "w2", leaseUntil: now + 1000 })).toBe(false);

      expect(q.ack({ jobId, workerId: "w2", now })).toBe(false);
      expect(q.cancel({ jobId: "", now })).toBe(false);
    } finally {
      q.close();
    }
  });

  it("issues and consumes cattle bootstrap tokens (one-time)", async () => {
    const { openClfQueue } = await import("../src/queue");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");

    const q = openClfQueue(dbPath);
    try {
      const now = 1_700_000_000_000;
      const issued = q.createCattleBootstrapToken({
        jobId: "job-1",
        requester: "maren",
        cattleName: "cattle-rex-1",
        envKeys: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
        publicEnv: { CLAWDLETS_CATTLE_AUTO_SHUTDOWN: "0" },
        now,
        ttlMs: 60_000,
      });

      const consumed = q.consumeCattleBootstrapToken({ token: issued.token, now: now + 1000 });
      expect(consumed?.jobId).toBe("job-1");
      expect(consumed?.requester).toBe("maren");
      expect(consumed?.cattleName).toBe("cattle-rex-1");
      expect(consumed?.envKeys).toEqual(["OPENAI_API_KEY", "GITHUB_TOKEN"]);
      expect(consumed?.publicEnv?.CLAWDLETS_CATTLE_AUTO_SHUTDOWN).toBe("0");

      const consumedAgain = q.consumeCattleBootstrapToken({ token: issued.token, now: now + 2000 });
      expect(consumedAgain).toBeNull();
    } finally {
      q.close();
    }
  });

  it("rejects invalid env var names in cattle bootstrap tokens", async () => {
    const { openClfQueue } = await import("../src/queue");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");

    const q = openClfQueue(dbPath);
    try {
      expect(() =>
        q.createCattleBootstrapToken({
          jobId: "job-1",
          requester: "maren",
          cattleName: "cattle-rex-1",
          envKeys: ["BAD-NAME"],
          publicEnv: {},
        }),
      ).toThrow(/invalid env var name/i);

      expect(() =>
        q.createCattleBootstrapToken({
          jobId: "job-1",
          requester: "maren",
          cattleName: "cattle-rex-1",
          envKeys: ["OPENAI_API_KEY"],
          publicEnv: { OPENAI_API_KEY: "nope" } as any,
        }),
      ).toThrow(/publicEnv not allowed/i);
    } finally {
      q.close();
    }
  });

  it("secures queue directory + db file permissions", async () => {
    if (process.platform === "win32") return;

    const { openClfQueue } = await import("../src/queue");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const insecure = path.join(dir, "state");
    fs.mkdirSync(insecure);
    fs.chmodSync(insecure, 0o777);
    const dbPath = path.join(insecure, "state.sqlite");

    const q = openClfQueue(dbPath);
    q.close();

    expect(fs.statSync(insecure).mode & 0o777).toBe(0o700);
    expect(fs.statSync(dbPath).mode & 0o777).toBe(0o600);
  });

  it("opens queue with relative paths", async () => {
    const { openClfQueue } = await import("../src/queue");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const q = openClfQueue("state.sqlite");
      q.close();
      expect(fs.existsSync(path.join(dir, "state.sqlite"))).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  it("returns null when failing with wrong worker", async () => {
    const { openClfQueue } = await import("../src/queue");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-queue-"));
    const dbPath = path.join(dir, "state.sqlite");

    const q = openClfQueue(dbPath);
    try {
      const now = Date.now();
      const retryJobId = q.enqueue({
        kind: "cattle.reap",
        payload: { dryRun: true },
        requester: "maren",
        runAt: now,
        maxAttempts: 2,
      }).jobId;
      q.claimNext({ workerId: "w1", now, leaseMs: 60_000 });
      expect(q.fail({ jobId: retryJobId, workerId: "w2", now: now + 1000, error: "nope" })).toBeNull();

      const terminalJobId = q.enqueue({
        kind: "cattle.reap",
        payload: { dryRun: true },
        requester: "maren",
        runAt: now,
        maxAttempts: 1,
      }).jobId;
      q.claimNext({ workerId: "w1", now: now + 2000, leaseMs: 60_000 });
      expect(q.fail({ jobId: terminalJobId, workerId: "w2", now: now + 3000, error: "nope" })).toBeNull();
    } finally {
      q.close();
    }
  });
});
