import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { describe, it, expect } from "vitest";

describe("unix socket safety", () => {
  it("rejects world-accessible sockets and world-writable dirs", async () => {
    if (process.platform === "win32") return;

    const { assertSafeUnixSocketPath } = await import("../src/unix-socket-safety");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-socket-"));

    const socketPath = path.join(dir, "orchestrator.sock");
    const server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      fs.chmodSync(socketPath, 0o666);
      expect(() => assertSafeUnixSocketPath(socketPath)).toThrow(/world-accessible/i);

      fs.chmodSync(socketPath, 0o660);
      expect(() => assertSafeUnixSocketPath(socketPath)).not.toThrow();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ignore
      }
    }

    const badDir = path.join(dir, "bad");
    fs.mkdirSync(badDir);
    fs.chmodSync(badDir, 0o777);
    const badSocket = path.join(badDir, "orchestrator.sock");
    const server2 = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server2.listen(badSocket, resolve));
    try {
      fs.chmodSync(badSocket, 0o660);
      expect(() => assertSafeUnixSocketPath(badSocket)).toThrow(/world-writable/i);
    } finally {
      await new Promise<void>((resolve) => server2.close(() => resolve()));
      try {
        fs.unlinkSync(badSocket);
      } catch {
        // ignore
      }
    }
  });
});

