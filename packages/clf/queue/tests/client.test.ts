import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { describe, it, expect } from "vitest";

describe("clf client", () => {
  it("performs health, enqueue, list, show, cancel", async () => {
    const { createClfClient } = await import("../src/client");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-client-"));
    const socketPath = path.join(dir, "orchestrator.sock");

    let seenListQuery = "";
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://localhost");
      if (url.pathname === "/healthz") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === "/v1/jobs/enqueue") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ protocolVersion: 1, jobId: "job-1" }));
        return;
      }
      if (url.pathname === "/v1/jobs") {
        seenListQuery = url.search;
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ protocolVersion: 1, jobs: [] }));
        return;
      }
      if (url.pathname === "/v1/jobs/job-1") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            protocolVersion: 1,
            job: {
              jobId: "job-1",
              kind: "cattle.spawn",
              status: "queued",
              requester: "maren",
              idempotencyKey: "",
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
              runAt: "2026-01-01T00:00:00Z",
              attempt: 0,
              maxAttempts: 1,
              lastError: "",
              payload: { persona: "rex" },
            },
          }),
        );
        return;
      }
      if (url.pathname === "/v1/jobs/job-1/cancel") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ protocolVersion: 1, ok: true }));
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    try {
      const client = createClfClient({ socketPath, timeoutMs: 500 });
      await expect(client.health()).resolves.toEqual({ ok: true });

      await expect(
        client.enqueue({
          protocolVersion: 1,
          requester: "maren",
          kind: "cattle.spawn",
          payload: { persona: "rex", task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "m", callbackUrl: "" } },
        }),
      ).resolves.toEqual({ protocolVersion: 1, jobId: "job-1" });

      await expect(client.list({ requester: "maren", status: "queued", kind: "cattle.spawn", limit: 10 })).resolves.toEqual({
        protocolVersion: 1,
        jobs: [],
      });
      expect(seenListQuery).toContain("requester=maren");
      expect(seenListQuery).toContain("status=queued");
      expect(seenListQuery).toContain("kind=cattle.spawn");
      expect(seenListQuery).toContain("limit=10");

      const show = await client.show("job-1");
      expect(show.job.jobId).toBe("job-1");

      await expect(client.cancel("job-1")).resolves.toEqual({ protocolVersion: 1, ok: true });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ignore
      }
    }
  });

  it("rejects missing socket path and job ids", async () => {
    const { createClfClient } = await import("../src/client");
    expect(() => createClfClient({ socketPath: "" })).toThrow(/socketPath missing/i);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-client-"));
    const socketPath = path.join(dir, "orchestrator.sock");
    const server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      const client = createClfClient({ socketPath });
      await expect(client.show("")).rejects.toThrow(/jobId missing/i);
      await expect(client.cancel("")).rejects.toThrow(/jobId missing/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ignore
      }
    }
  });

  it("surfaces invalid json responses", async () => {
    const { createClfClient } = await import("../src/client");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-client-"));
    const socketPath = path.join(dir, "orchestrator.sock");

    const server = http.createServer((req, res) => {
      if (req.url === "/v1/jobs/enqueue") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end("not-json");
        return;
      }
      res.statusCode = 500;
      res.end("nope");
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    try {
      const client = createClfClient({ socketPath });
      await expect(
        client.enqueue({
          protocolVersion: 1,
          requester: "maren",
          kind: "cattle.spawn",
          payload: { persona: "rex", task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "m", callbackUrl: "" } },
        }),
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ignore
      }
    }
  });

  it("fails on non-200 responses", async () => {
    const { createClfClient } = await import("../src/client");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-client-"));
    const socketPath = path.join(dir, "orchestrator.sock");

    const server = http.createServer((req, res) => {
      if (req.url === "/v1/jobs") {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: { message: "boom" } }));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      const client = createClfClient({ socketPath });
      await expect(client.list()).rejects.toThrow(/list failed/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ignore
      }
    }
  });
  it("rejects oversized responses", async () => {
    const { createClfClient } = await import("../src/client");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-client-"));
    const socketPath = path.join(dir, "orchestrator.sock");

    const server = http.createServer((req, res) => {
      if (req.url === "/healthz") {
        const body = JSON.stringify({ ok: true, pad: "x".repeat(1024 * 1024 + 32) });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(body);
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    try {
      const client = createClfClient({ socketPath });
      await expect(client.health()).rejects.toThrow(/response body too large/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ignore
      }
    }
  });

  it("times out stuck requests", async () => {
    if (process.platform === "win32") return;

    const { createClfClient } = await import("../src/client");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-client-"));
    const socketPath = path.join(dir, "orchestrator.sock");

    const server = http.createServer((req, res) => {
      if (req.url === "/healthz") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        // Intentionally never end.
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    try {
      const client = createClfClient({ socketPath, timeoutMs: 250 });
      await expect(client.health()).rejects.toThrow(/timeout/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ignore
      }
    }
  });
});
