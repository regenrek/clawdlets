import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const openClfQueueMock = vi.fn();
const createOrchestratorHttpServerMock = vi.fn();
const createCattleInternalHttpServerMock = vi.fn();
let stopMode: "immediate" | "delayed" = "immediate";
const runClfWorkerLoopMock = vi.fn(async ({ stopSignal }: { stopSignal: { stopped: boolean } }) => {
  if (stopMode === "immediate") {
    stopSignal.stopped = true;
  } else {
    setTimeout(() => {
      stopSignal.stopped = true;
    }, 0);
  }
});
const loadAdminAuthorizedKeysMock = vi.fn(() => ["ssh-ed25519 AAAA"]);
const parseCattleBaseLabelsMock = vi.fn(() => ({}));
const assertSafeUnixSocketPathMock = vi.fn();
const tryChmodUnixSocketMock = vi.fn();

let config: any;
let server: any;
let cattleServer: any;
let queue: any;
let networkInterfacesMock: Record<string, any> = {};
let hostnameMock = "host";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const mocked = {
    ...actual,
    networkInterfaces: () => networkInterfacesMock,
    hostname: () => hostnameMock,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

function makeServer() {
  return {
    once: vi.fn(),
    listen: vi.fn((...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") cb();
    }),
    close: vi.fn((cb: any) => {
      if (typeof cb === "function") cb();
    }),
  };
}

vi.mock("@clawdlets/clf-queue", () => ({
  openClfQueue: (...args: any[]) => openClfQueueMock(...args),
}));

vi.mock("../src/config", () => ({
  loadClfOrchestratorConfigFromEnv: () => config,
}));

vi.mock("../src/http", () => ({
  createOrchestratorHttpServer: (...args: any[]) => createOrchestratorHttpServerMock(...args),
}));

vi.mock("../src/cattle-http", () => ({
  createCattleInternalHttpServer: (...args: any[]) => createCattleInternalHttpServerMock(...args),
}));

vi.mock("../src/worker", () => ({
  runClfWorkerLoop: (...args: any[]) => runClfWorkerLoopMock(...args),
  loadAdminAuthorizedKeys: (...args: any[]) => loadAdminAuthorizedKeysMock(...args),
  parseCattleBaseLabels: (...args: any[]) => parseCattleBaseLabelsMock(...args),
}));

vi.mock("../src/unix-socket-safety", () => ({
  assertSafeUnixSocketPath: (...args: any[]) => assertSafeUnixSocketPathMock(...args),
  tryChmodUnixSocket: (...args: any[]) => tryChmodUnixSocketMock(...args),
}));

describe("clf-orchestrator main", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    stopMode = "immediate";
    queue = { close: vi.fn() };
    server = makeServer();
    cattleServer = makeServer();
    openClfQueueMock.mockReturnValue(queue);
    createOrchestratorHttpServerMock.mockReturnValue(server);
    createCattleInternalHttpServerMock.mockReturnValue(cattleServer);
    networkInterfacesMock = {};
    hostnameMock = "host";
    config = {
      dbPath: "/tmp/clf.sqlite",
      socketPath: path.join(fs.mkdtempSync(path.join(tmpdir(), "clf-sock-")), "orchestrator.sock"),
      workerConcurrency: 1,
      workerPollMs: 10,
      workerLeaseMs: 10_000,
      workerLeaseRefreshMs: 10_000,
      hcloudToken: "token",
      cattle: {
        image: "img",
        serverType: "cx22",
        location: "nbg1",
        maxInstances: 10,
        defaultTtl: "2h",
        labelsJson: "{}",
        defaultAutoShutdown: true,
        secretsListenHost: "127.0.0.1",
        secretsListenPort: 18337,
        secretsBaseUrl: "",
        bootstrapTtlMs: 60_000,
      },
      personasRoot: "/var/lib/clf/cattle-personas",
      adminAuthorizedKeysFile: "",
      adminAuthorizedKeysInline: "ssh-ed25519 AAAA",
      tailscaleAuthKey: "tskey-auth-123",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("starts and stops cleanly", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    await import("../src/main");
    await new Promise((r) => setTimeout(r, 260));
    await new Promise((r) => setTimeout(r, 0));
    expect(createOrchestratorHttpServerMock).toHaveBeenCalled();
    expect(createCattleInternalHttpServerMock).toHaveBeenCalled();
    expect(runClfWorkerLoopMock).toHaveBeenCalled();
    expect(queue.close).toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("uses systemd socket when LISTEN_FDS is set", async () => {
    stopMode = "delayed";
    process.env.LISTEN_PID = String(process.pid);
    process.env.LISTEN_FDS = "1";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
    await import("../src/main");
    await new Promise((r) => setTimeout(r, 260));
    expect(server.listen).toHaveBeenCalledWith({ fd: 3 }, expect.any(Function));
    expect(tryChmodUnixSocketMock).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("resolves tailscale listen host from auto", async () => {
    stopMode = "delayed";
    config.cattle.secretsListenHost = "auto";
    networkInterfacesMock = {
      tailscale0: [{ address: "100.64.1.2", family: "IPv4", internal: false } as any],
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
    await import("../src/main");
    await new Promise((r) => setTimeout(r, 260));
    expect(cattleServer.listen).toHaveBeenCalledWith(18337, "100.64.1.2", expect.any(Function));
    logSpy.mockRestore();
  });

  it("falls back to tailscale-range interfaces", async () => {
    stopMode = "delayed";
    config.cattle.secretsListenHost = "auto";
    networkInterfacesMock = {
      eth0: [{ address: "100.100.10.10", family: "IPv4", internal: false } as any],
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
    await import("../src/main");
    await new Promise((r) => setTimeout(r, 260));
    expect(cattleServer.listen).toHaveBeenCalledWith(18337, "100.100.10.10", expect.any(Function));
    logSpy.mockRestore();
  });

  it("fails when tailscale auto resolution finds no ipv4", async () => {
    stopMode = "delayed";
    config.cattle.secretsListenHost = "auto";
    networkInterfacesMock = {};
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    await import("../src/main");
    await new Promise((r) => setTimeout(r, 260));
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith("clf-orchestrator: fatal error");
    errSpy.mockRestore();
  });

  it("fails on wildcard cattle listen host", async () => {
    config.cattle.secretsListenHost = "0.0.0.0";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    await import("../src/main");
    await new Promise((r) => setTimeout(r, 0));
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith("clf-orchestrator: fatal error");
    errSpy.mockRestore();
  });
});
