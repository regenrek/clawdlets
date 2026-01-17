import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { describe, it, expect } from "vitest";

describe("clf client", () => {
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
