import { describe, expect, it, vi } from "vitest";

const listCattleServersMock = vi.fn();
const createCattleServerMock = vi.fn(async () => ({
  id: "1",
  name: "rex",
  persona: "rex",
  taskId: "t1",
  ttlSeconds: 60,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: new Date("2026-01-01T00:01:00Z"),
  ipv4: "1.2.3.4",
  status: "running",
  labels: {},
}));

vi.mock("@clawdlets/core/lib/hcloud-cattle", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/core/lib/hcloud-cattle")>("@clawdlets/core/lib/hcloud-cattle");
  return {
    ...actual,
    listCattleServers: listCattleServersMock,
    createCattleServer: createCattleServerMock,
  };
});

vi.mock("@clawdlets/core/lib/cattle-cloudinit", () => ({
  buildCattleCloudInitUserData: () => "#cloud-config\n",
}));

vi.mock("@clawdlets/core/lib/persona-loader", () => ({
  loadPersona: () => ({
    name: "rex",
    config: { model: { primary: "openai/gpt-4o" } },
    cloudInitFiles: [],
  }),
}));

vi.mock("@clawdlets/core/lib/llm-provider-env", () => ({
  getModelRequiredEnvVars: () => ["OPENAI_API_KEY"],
}));

vi.mock("@clawdlets/core/lib/ttl", () => ({
  parseTtlToSeconds: () => ({ seconds: 60 }),
}));

describe("clf-orchestrator worker spawn errors", () => {
  const runtime = {
    hcloudToken: "token",
    cattle: {
      image: "img",
      serverType: "cx22",
      location: "nbg1",
      maxInstances: 1,
      defaultTtl: "2h",
      labels: {},
      defaultAutoShutdown: true,
      secretsBaseUrl: "http://127.0.0.1:18337",
      bootstrapTtlMs: 60_000,
    },
    personasRoot: "/tmp/personas",
    adminAuthorizedKeys: ["ssh-ed25519 AAAA"],
    tailscaleAuthKey: "tskey-auth-123",
    env: { OPENAI_API_KEY: "x", GITHUB_TOKEN: "gh-token" },
  };

  it("fails when maxInstances is reached", async () => {
    listCattleServersMock.mockResolvedValueOnce([{ id: "1" }]);
    const { runClfWorkerLoop } = await import("../src/worker");
    const stopSignal = { stopped: false };
    const queue = {
      claimNext: vi
        .fn()
        .mockReturnValueOnce({
          jobId: "j1",
          kind: "cattle.spawn",
          requester: "maren",
          payload: {
            persona: "rex",
            task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "do", callbackUrl: "" },
          },
        })
        .mockReturnValueOnce(null),
      extendLease: vi.fn(),
      ack: vi.fn(),
      fail: vi.fn(() => {
        stopSignal.stopped = true;
        return { status: "failed" };
      }),
    } as any;
    await runClfWorkerLoop({
      queue,
      workerId: "w1",
      pollMs: 1,
      leaseMs: 1000,
      leaseRefreshMs: 1000,
      runtime,
      stopSignal,
    });
    expect(queue.fail).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/maxInstances reached/i) }));
  });

  it("fails when withGithubToken is requested without GITHUB_TOKEN", async () => {
    listCattleServersMock.mockResolvedValueOnce([]);
    const { runClfWorkerLoop } = await import("../src/worker");
    const stopSignal = { stopped: false };
    const runtimeMissing = { ...runtime, env: { OPENAI_API_KEY: "x" } };
    const queue = {
      claimNext: vi
        .fn()
        .mockReturnValueOnce({
          jobId: "j1",
          kind: "cattle.spawn",
          requester: "maren",
          payload: {
            persona: "rex",
            withGithubToken: true,
            task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "do", callbackUrl: "" },
          },
        })
        .mockReturnValueOnce(null),
      extendLease: vi.fn(),
      createCattleBootstrapToken: vi.fn(() => ({ token: "boot", expiresAt: Date.now() + 60_000 })),
      ack: vi.fn(),
      fail: vi.fn(() => {
        stopSignal.stopped = true;
        return { status: "failed" };
      }),
    } as any;
    await runClfWorkerLoop({
      queue,
      workerId: "w1",
      pollMs: 1,
      leaseMs: 1000,
      leaseRefreshMs: 1000,
      runtime: runtimeMissing,
      stopSignal,
    });
    expect(queue.fail).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/GITHUB_TOKEN missing/i) }));
  });

  it("acknowledges spawn when withGithubToken succeeds", async () => {
    listCattleServersMock.mockResolvedValueOnce([]);
    const { runClfWorkerLoop } = await import("../src/worker");
    const stopSignal = { stopped: false };
    const queue = {
      claimNext: vi
        .fn()
        .mockReturnValueOnce({
          jobId: "j1",
          kind: "cattle.spawn",
          requester: "maren",
          payload: {
            persona: "rex",
            withGithubToken: true,
            task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "do", callbackUrl: "" },
          },
        })
        .mockReturnValueOnce(null),
      extendLease: vi.fn(),
      createCattleBootstrapToken: vi.fn(() => ({ token: "boot", expiresAt: Date.now() + 60_000 })),
      ack: vi.fn(() => {
        stopSignal.stopped = true;
        return true;
      }),
      fail: vi.fn(),
    } as any;
    await runClfWorkerLoop({
      queue,
      workerId: "w1",
      pollMs: 1,
      leaseMs: 1000,
      leaseRefreshMs: 1000,
      runtime,
      stopSignal,
    });
    expect(queue.ack).toHaveBeenCalled();
    expect(createCattleServerMock).toHaveBeenCalled();
  });

  it("uses payload overrides and disables auto-shutdown", async () => {
    listCattleServersMock.mockResolvedValueOnce([]);
    const { runClfWorkerLoop } = await import("../src/worker");
    const stopSignal = { stopped: false };
    const createBootstrap = vi.fn(() => ({ token: "boot", expiresAt: Date.now() + 60_000 }));
    const queue = {
      claimNext: vi
        .fn()
        .mockReturnValueOnce({
          jobId: "j1",
          kind: "cattle.spawn",
          requester: "maren",
          payload: {
            persona: "rex",
            autoShutdown: false,
            image: "img-custom",
            serverType: "cx32",
            location: "fsn1",
            task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "do", callbackUrl: "" },
          },
        })
        .mockReturnValueOnce(null),
      extendLease: vi.fn(),
      createCattleBootstrapToken: createBootstrap,
      ack: vi.fn(() => {
        stopSignal.stopped = true;
        return true;
      }),
      fail: vi.fn(),
    } as any;
    await runClfWorkerLoop({
      queue,
      workerId: "w1",
      pollMs: 1,
      leaseMs: 1000,
      leaseRefreshMs: 1000,
      runtime,
      stopSignal,
    });
    expect(queue.ack).toHaveBeenCalled();
    expect(createBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        publicEnv: { CLAWDLETS_CATTLE_AUTO_SHUTDOWN: "0" },
      }),
    );
    expect(createCattleServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "img-custom",
        serverType: "cx32",
        location: "fsn1",
      }),
    );
  });
});
