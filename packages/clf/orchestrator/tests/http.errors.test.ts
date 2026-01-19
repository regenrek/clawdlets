import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("clf-orchestrator http errors", () => {
  it("handles invalid JSON and missing jobs", async () => {
    const { openClfQueue } = await import("@clawdlets/clf-queue");
    const { createOrchestratorHttpServer } = await import("../src/http");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-http-"));
    const dbPath = path.join(dir, "state.sqlite");
    const q = openClfQueue(dbPath);

    const server = createOrchestratorHttpServer({ queue: q });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      const bad = await fetch(`${base}/v1/jobs/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ nope",
      });
      expect(bad.status).toBe(400);

      const badRunAt = await fetch(`${base}/v1/jobs/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 1,
          requester: "maren",
          kind: "cattle.reap",
          payload: { dryRun: true },
          runAt: "not-a-date",
        }),
      });
      expect(badRunAt.status).toBe(200);

      const goodRunAt = await fetch(`${base}/v1/jobs/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 1,
          requester: "maren",
          kind: "cattle.reap",
          payload: { dryRun: true },
          runAt: "2026-01-19T00:00:00Z",
        }),
      });
      expect(goodRunAt.status).toBe(200);

      const missing = await fetch(`${base}/v1/jobs/nope`);
      expect(missing.status).toBe(404);

      const list = await fetch(`${base}/v1/jobs?status=queued,bad&kind=cattle.reap&limit=1`);
      expect(list.status).toBe(200);

      const notFound = await fetch(`${base}/nope`);
      expect(notFound.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      q.close();
    }
  });

  it("rejects cancel for non-cancelable jobs", async () => {
    const { openClfQueue } = await import("@clawdlets/clf-queue");
    const { createOrchestratorHttpServer } = await import("../src/http");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-http-"));
    const dbPath = path.join(dir, "state.sqlite");
    const q = openClfQueue(dbPath);

    const server = createOrchestratorHttpServer({ queue: q });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      const { jobId } = q.enqueue({
        kind: "cattle.reap",
        requester: "maren",
        payload: { dryRun: true },
      });
      const claimed = q.claimNext({ workerId: "w1", leaseMs: 1000 });
      if (claimed) q.ack({ jobId, workerId: "w1", result: {} });

      const cancel = await fetch(`${base}/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
      expect(cancel.status).toBe(409);

      const missing = await fetch(`${base}/v1/jobs/${encodeURIComponent("missing")}/cancel`, { method: "POST" });
      expect(missing.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      q.close();
    }
  });
});
