import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { runClfWorkerLoop, loadAdminAuthorizedKeys, parseCattleBaseLabels } from "../src/worker";

const reapExpiredCattleMock = vi.hoisted(() => vi.fn(async () => ({ expired: [], deletedIds: ["srv-1"] })));

vi.mock("@clawdlets/core/lib/hcloud-cattle", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/core/lib/hcloud-cattle")>("@clawdlets/core/lib/hcloud-cattle");
  return {
    ...actual,
    reapExpiredCattle: reapExpiredCattleMock,
  };
});

const runtime = {
  hcloudToken: "token",
  cattle: {
    image: "img",
    serverType: "cx22",
    location: "nbg1",
    maxInstances: 10,
    defaultTtl: "2h",
    labels: {},
    defaultAutoShutdown: true,
    secretsBaseUrl: "http://127.0.0.1:18337",
    bootstrapTtlMs: 60_000,
  },
  personasRoot: "/tmp/personas",
  adminAuthorizedKeys: ["ssh-ed25519 AAAA"],
  tailscaleAuthKey: "tskey-auth-123",
  env: { OPENAI_API_KEY: "x" },
};

describe("clf-orchestrator worker", () => {
  it("loads admin authorized keys from file", () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "clf-keys-"));
    const file = path.join(dir, "keys");
    fs.writeFileSync(file, "# comment\nssh-ed25519 AAAA\n\nssh-rsa BBBB\n", "utf8");
    expect(loadAdminAuthorizedKeys({ filePath: file, inline: "" })).toEqual(["ssh-ed25519 AAAA", "ssh-rsa BBBB"]);
  });

  it("loads admin authorized keys from inline", () => {
    expect(loadAdminAuthorizedKeys({ filePath: "", inline: "ssh-ed25519 AAAA\n#x\nssh-rsa BBBB" })).toEqual([
      "ssh-ed25519 AAAA",
      "ssh-rsa BBBB",
    ]);
  });

  it("rejects missing admin authorized keys", () => {
    expect(() => loadAdminAuthorizedKeys({ filePath: "", inline: "" })).toThrow(/missing admin authorized keys/i);
  });

  it("rejects invalid admin authorized keys file path", () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "clf-keys-dir-"));
    expect(() => loadAdminAuthorizedKeys({ filePath: dir, inline: "" })).toThrow(/not a file/i);
  });

  it("rejects oversized inline authorized keys", () => {
    const big = "a".repeat(70_000);
    expect(() => loadAdminAuthorizedKeys({ filePath: "", inline: big })).toThrow(/inline too large/i);
  });

  it("parses cattle base labels", () => {
    expect(parseCattleBaseLabels("{\"team\":\"ops\"}")).toEqual({ team: "ops" });
    expect(parseCattleBaseLabels("not-json")).toEqual({});
  });

  it("processes cattle.reap jobs", async () => {
    const stopSignal = { stopped: false };
    const queue = {
      claimNext: vi
        .fn()
        .mockReturnValueOnce({ jobId: "j1", kind: "cattle.reap", requester: "maren", payload: { dryRun: true } })
        .mockReturnValueOnce(null),
      extendLease: vi.fn(),
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
  });

  it("fails unsupported job kinds", async () => {
    const stopSignal = { stopped: false };
    const queue = {
      claimNext: vi
        .fn()
        .mockReturnValueOnce({ jobId: "j1", kind: "unknown", requester: "maren", payload: {} })
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
    expect(queue.fail).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/unsupported job kind/i) }));
  });

  it("fails jobs when payload parsing throws", async () => {
    const stopSignal = { stopped: false };
    const queue = {
      claimNext: vi
        .fn()
        .mockReturnValueOnce({ jobId: "j1", kind: "cattle.spawn", requester: "maren", payload: {} })
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
    expect(queue.fail).toHaveBeenCalled();
  });

  it("polls when no job is available", async () => {
    const stopSignal = { stopped: false };
    const queue = {
      claimNext: vi.fn(() => {
        stopSignal.stopped = true;
        return null;
      }),
      extendLease: vi.fn(),
      ack: vi.fn(),
      fail: vi.fn(),
    } as any;
    await runClfWorkerLoop({
      queue,
      workerId: "w1",
      pollMs: 0,
      leaseMs: 1000,
      leaseRefreshMs: 1000,
      runtime,
      stopSignal,
    });
    expect(queue.claimNext).toHaveBeenCalled();
  });

  it("extends leases while processing", async () => {
    vi.useFakeTimers();
    reapExpiredCattleMock.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ expired: [], deletedIds: [] }), 10)),
    );
    const stopSignal = { stopped: false };
    const queue = {
      claimNext: vi
        .fn()
        .mockReturnValueOnce({ jobId: "j1", kind: "cattle.reap", requester: "maren", payload: { dryRun: true } })
        .mockReturnValueOnce(null),
      extendLease: vi.fn(),
      ack: vi.fn(() => {
        stopSignal.stopped = true;
        return true;
      }),
      fail: vi.fn(),
    } as any;
    const promise = runClfWorkerLoop({
      queue,
      workerId: "w1",
      pollMs: 1,
      leaseMs: 1000,
      leaseRefreshMs: 1,
      runtime,
      stopSignal,
    });
    vi.advanceTimersByTime(20);
    await promise;
    vi.useRealTimers();
    expect(queue.extendLease).toHaveBeenCalled();
  });
});
