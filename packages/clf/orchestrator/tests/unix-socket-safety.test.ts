import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { describe, it, expect } from "vitest";

describe("unix socket safety", () => {
  it("rejects world-accessible sockets and writable dirs", async () => {
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
      expect(() => assertSafeUnixSocketPath(badSocket)).toThrow(/writable by non-owner/i);
    } finally {
      await new Promise<void>((resolve) => server2.close(() => resolve()));
      try {
        fs.unlinkSync(badSocket);
      } catch {
        // ignore
      }
    }

    const groupWritableDir = path.join(dir, "group-writable");
    fs.mkdirSync(groupWritableDir);
    fs.chmodSync(groupWritableDir, 0o770);
    const groupWritableSocket = path.join(groupWritableDir, "orchestrator.sock");
    const server3 = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server3.listen(groupWritableSocket, resolve));
    try {
      fs.chmodSync(groupWritableSocket, 0o660);
      expect(() => assertSafeUnixSocketPath(groupWritableSocket)).toThrow(/writable by non-owner/i);
    } finally {
      await new Promise<void>((resolve) => server3.close(() => resolve()));
      try {
        fs.unlinkSync(groupWritableSocket);
      } catch {
        // ignore
      }
    }
  });

  it("rejects invalid socket paths", async () => {
    const { assertSafeUnixSocketPath } = await import("../src/unix-socket-safety");
    expect(() => assertSafeUnixSocketPath("")).toThrow(/socketPath missing/i);
    expect(() => assertSafeUnixSocketPath("relative.sock")).toThrow(/must be absolute/i);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-socket-"));
    const notDir = path.join(dir, "not-dir");
    fs.writeFileSync(notDir, "x", "utf8");
    expect(() => assertSafeUnixSocketPath(path.join(notDir, "sock"))).toThrow(/socket directory is not a directory/i);

    const filePath = path.join(dir, "file.sock");
    fs.writeFileSync(filePath, "x", "utf8");
    expect(() => assertSafeUnixSocketPath(filePath)).toThrow(/not a unix socket/i);
  });

  it("rejects sockets missing owner-rw", async () => {
    if (process.platform === "win32") return;
    const { assertSafeUnixSocketPath } = await import("../src/unix-socket-safety");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clf-socket-"));
    const socketPath = path.join(dir, "orchestrator.sock");
    const server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      fs.chmodSync(socketPath, 0o400);
      expect(() => assertSafeUnixSocketPath(socketPath)).toThrow(/owner-rw/i);
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
