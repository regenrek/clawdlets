import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getRepoLayout } from "@clawdlets/core/repo-layout";

const loadHostContextOrExitMock = vi.fn();
vi.mock("@clawdlets/core/lib/context", () => ({
  loadHostContextOrExit: loadHostContextOrExitMock,
}));

const createClfClientMock = vi.fn();
vi.mock(import("@clawdlets/clf-queue"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, CLF_PROTOCOL_VERSION: (actual as any).CLF_PROTOCOL_VERSION, createClfClient: createClfClientMock };
});

const openCattleStateMock = vi.fn();
vi.mock("../src/lib/cattle-state", () => ({
  openCattleState: openCattleStateMock,
}));

const loadDeployCredsMock = vi.fn();
vi.mock("@clawdlets/core/lib/deploy-creds", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

const listCattleServersMock = vi.fn();
const destroyCattleServerMock = vi.fn();
const reapExpiredCattleMock = vi.fn(async (params: { dryRun?: boolean; now?: Date }) => {
  const servers = (await listCattleServersMock()) as Array<any>;
  const nowMs = params.now ? params.now.getTime() : Date.now();
  const expired = servers
    .filter((s) => s?.expiresAt instanceof Date && s.expiresAt.getTime() > 0 && s.expiresAt.getTime() <= nowMs)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  if (params.dryRun) return { expired, deletedIds: [] };
  for (const s of expired) await destroyCattleServerMock({ id: s.id });
  return { expired, deletedIds: expired.map((s) => s.id) };
});
vi.mock("@clawdlets/cattle-core/lib/hcloud-cattle", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/cattle-core/lib/hcloud-cattle")>("@clawdlets/cattle-core/lib/hcloud-cattle");
  return {
    ...actual,
    listCattleServers: listCattleServersMock,
    destroyCattleServer: destroyCattleServerMock,
    reapExpiredCattle: reapExpiredCattleMock,
  };
});

describe("cattle command", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-cli-cattle-"));
  const layout = getRepoLayout(repoRoot);
  const hostName = "clawdbot-fleet-host";

  const hostCfg = {
    agentModelPrimary: "zai/glm-4.7",
  } as any;

  const config = {
    schemaVersion: 11,
    defaultHost: hostName,
    fleet: {
      secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      secretFiles: {},
      sshAuthorizedKeys: [],
      sshKnownHosts: [],
      botOrder: [],
      bots: {},
      codex: { enable: false, bots: [] },
      backups: { restic: { enable: false, repository: "" } },
    },
    cattle: {
      enabled: true,
      hetzner: { image: "img-1", serverType: "cx22", location: "nbg1", maxInstances: 10, defaultTtl: "2h", labels: { "managed-by": "clawdlets" } },
      defaults: { autoShutdown: true, callbackUrl: "" },
    },
    hosts: { [hostName]: hostCfg },
  } as any;

  let logSpy: ReturnType<typeof vi.spyOn> | undefined;
  let nowSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    loadDeployCredsMock.mockReturnValue({
      envFile: { origin: "default", status: "ok", path: path.join(layout.runtimeDir, "env") },
      values: { HCLOUD_TOKEN: "token", GITHUB_TOKEN: "", NIX_BIN: "nix", SOPS_AGE_KEY_FILE: "" },
    });

    loadHostContextOrExitMock.mockReturnValue({
      repoRoot,
      layout,
      config,
      hostName,
      hostCfg,
    });

    openCattleStateMock.mockReturnValue({
      upsertServer: vi.fn(),
      listActive: vi.fn(() => []),
      findActiveByIdOrName: vi.fn(() => null),
      markDeletedById: vi.fn(),
      close: vi.fn(),
    });
  });

  afterEach(() => {
    if (logSpy) logSpy.mockRestore();
    if (nowSpy) nowSpy.mockRestore();
    logSpy = undefined;
    nowSpy = undefined;
  });

  it("spawn --dry-run prints a deterministic enqueue request JSON", async () => {
    const taskFile = path.join(repoRoot, "task.json");
    fs.writeFileSync(
      taskFile,
      JSON.stringify({ schemaVersion: 1, taskId: "issue-42", type: "clawdbot.gateway.agent", message: "do the thing", callbackUrl: "" }, null, 2),
      "utf8",
    );

    const logs: string[] = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const { cattle } = await import("../src/commands/cattle");
    await cattle.subCommands.spawn.run({
      args: { host: hostName, persona: "rex", taskFile, ttl: "2h", autoShutdown: false, withGithubToken: true, dryRun: true } as any,
    });

    const obj = JSON.parse(logs.join("\n"));
    expect(obj.action).toBe("clf.jobs.enqueue");
    expect(obj.request.kind).toBe("cattle.spawn");
    expect(obj.request.payload.persona).toBe("rex");
    expect(obj.request.payload.ttl).toBe("2h");
    expect(obj.request.payload.autoShutdown).toBe(false);
    expect(obj.request.payload.withGithubToken).toBe(true);
    expect(obj.request.payload.task.taskId).toBe("issue-42");
  });

  it("spawn --wait=false prints the enqueued job id", async () => {
    const taskFile = path.join(repoRoot, "task.json");
    fs.writeFileSync(
      taskFile,
      JSON.stringify({ schemaVersion: 1, taskId: "issue-42", type: "clawdbot.gateway.agent", message: "do the thing", callbackUrl: "" }, null, 2),
      "utf8",
    );

    const enqueueMock = vi.fn(async () => ({ protocolVersion: 1, jobId: "job-1" }));
    createClfClientMock.mockReturnValue({
      enqueue: enqueueMock,
      show: vi.fn(),
      list: vi.fn(),
      cancel: vi.fn(),
      health: vi.fn(),
    });

    const logs: string[] = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const { cattle } = await import("../src/commands/cattle");
    await cattle.subCommands.spawn.run({
      args: { host: hostName, persona: "rex", taskFile, ttl: "2h", wait: false } as any,
    });

    expect(enqueueMock).toHaveBeenCalled();
    expect(logs.join("\n")).toMatch(/job-1/);
  });

  it("spawn stores server state on success", async () => {
    const taskFile = path.join(repoRoot, "task.json");
    fs.writeFileSync(
      taskFile,
      JSON.stringify({ schemaVersion: 1, taskId: "issue-42", type: "clawdbot.gateway.agent", message: "do the thing" }, null, 2),
      "utf8",
    );

    const upsertServer = vi.fn();
    const close = vi.fn();
    openCattleStateMock.mockReturnValueOnce({ upsertServer, close });

    createClfClientMock.mockReturnValue({
      enqueue: vi.fn(async () => ({ protocolVersion: 1, jobId: "job-2" })),
      show: vi.fn().mockResolvedValue({
        job: {
          status: "done",
          result: {
            server: {
              id: "srv-1",
              name: "cattle-rex-1",
              ipv4: "1.2.3.4",
              createdAt: "not-a-date",
              expiresAt: "",
              ttlSeconds: 120,
              labels: { team: "ops" },
              status: "running",
            },
          },
        },
      }),
    });

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const logs: string[] = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const { cattle } = await import("../src/commands/cattle");
    await cattle.subCommands.spawn.run({
      args: { host: hostName, persona: "rex", taskFile, wait: true } as any,
    });

    expect(upsertServer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "srv-1",
        name: "cattle-rex-1",
        ttlSeconds: 120,
        createdAt: 1_700_000_000,
        expiresAt: 0,
        labels: { team: "ops" },
        lastStatus: "running",
        lastIpv4: "1.2.3.4",
      }),
    );
    expect(close).toHaveBeenCalled();
    expect(logs.join("\n")).toMatch(/ok: spawned/);
    nowSpy.mockRestore();
  });

  it("spawn throws on failed job status", async () => {
    const taskFile = path.join(repoRoot, "task.json");
    fs.writeFileSync(
      taskFile,
      JSON.stringify({ schemaVersion: 1, taskId: "issue-42", type: "clawdbot.gateway.agent", message: "do the thing" }, null, 2),
      "utf8",
    );

    createClfClientMock.mockReturnValue({
      enqueue: vi.fn(async () => ({ protocolVersion: 1, jobId: "job-3" })),
      show: vi.fn().mockResolvedValue({ job: { status: "failed", lastError: "boom" } }),
    });

    const { cattle } = await import("../src/commands/cattle");
    await expect(
      cattle.subCommands.spawn.run({ args: { host: hostName, persona: "rex", taskFile, wait: true } as any }),
    ).rejects.toThrow(/failed.*boom/);
  });

  it("spawn rejects invalid wait timeout", async () => {
    const taskFile = path.join(repoRoot, "task.json");
    fs.writeFileSync(
      taskFile,
      JSON.stringify({ schemaVersion: 1, taskId: "issue-42", type: "clawdbot.gateway.agent", message: "do the thing" }, null, 2),
      "utf8",
    );

    createClfClientMock.mockReturnValue({
      enqueue: vi.fn(async () => ({ protocolVersion: 1, jobId: "job-4" })),
      show: vi.fn(),
    });

    const { cattle } = await import("../src/commands/cattle");
    await expect(
      cattle.subCommands.spawn.run({ args: { host: hostName, persona: "rex", taskFile, wait: true, waitTimeout: "0" } as any }),
    ).rejects.toThrow(/invalid --wait-timeout/);
  });

  it("spawn rejects invalid ttl", async () => {
    const taskFile = path.join(repoRoot, "task.json");
    fs.writeFileSync(
      taskFile,
      JSON.stringify({ schemaVersion: 1, taskId: "issue-42", type: "clawdbot.gateway.agent", message: "do the thing" }, null, 2),
      "utf8",
    );

    const { cattle } = await import("../src/commands/cattle");
    await expect(
      cattle.subCommands.spawn.run({ args: { host: hostName, persona: "rex", taskFile, ttl: "nope", dryRun: true } as any }),
    ).rejects.toThrow(/invalid --ttl/);
  });

  it("spawn rejects when cattle disabled", async () => {
    const taskFile = path.join(repoRoot, "task.json");
    fs.writeFileSync(
      taskFile,
      JSON.stringify({ schemaVersion: 1, taskId: "issue-42", type: "clawdbot.gateway.agent", message: "do the thing" }, null, 2),
      "utf8",
    );

    loadHostContextOrExitMock.mockReturnValue({
      repoRoot,
      layout,
      config: { ...config, cattle: { enabled: false } },
      hostName,
      hostCfg,
    });

    const { cattle } = await import("../src/commands/cattle");
    await expect(
      cattle.subCommands.spawn.run({ args: { host: hostName, persona: "rex", taskFile, dryRun: true } as any }),
    ).rejects.toThrow(/cattle is disabled/);
  });

  it("reap --dry-run does not delete", async () => {
    const logs: string[] = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    listCattleServersMock.mockResolvedValue([
      {
        id: "1",
        name: "cattle-rex-1",
        persona: "rex",
        taskId: "a",
        ttlSeconds: 60,
        createdAt: new Date(1_699_999_000_000),
        expiresAt: new Date(1_699_999_900_000),
        ipv4: "",
        status: "running",
        labels: {},
      },
      {
        id: "2",
        name: "cattle-rex-2",
        persona: "rex",
        taskId: "b",
        ttlSeconds: 60,
        createdAt: new Date(1_700_000_000_000),
        expiresAt: new Date(1_700_000_100_000),
        ipv4: "",
        status: "running",
        labels: {},
      },
    ]);

    const { cattle } = await import("../src/commands/cattle");
    await cattle.subCommands.reap.run({
      args: { host: hostName, dryRun: true } as any,
    });

    expect(destroyCattleServerMock).not.toHaveBeenCalled();
    expect(logs.join("\n")).toMatch(/cattle-rex-1/);
    expect(logs.join("\n")).not.toMatch(/cattle-rex-2/);
  });

  it("list --json prints servers from Hetzner", async () => {
    nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    listCattleServersMock.mockResolvedValue([
      {
        id: "10",
        name: "cattle-rex-10",
        persona: "rex",
        taskId: "t",
        ttlSeconds: 60,
        createdAt: new Date(1_700_000_000_000),
        expiresAt: new Date(1_700_000_060_000),
        ipv4: "1.2.3.4",
        status: "running",
        labels: {},
      },
    ]);

    const logs: string[] = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const { cattle } = await import("../src/commands/cattle");
    await cattle.subCommands.list.run({
      args: { host: hostName, json: true } as any,
    });

    const obj = JSON.parse(logs.join("\n"));
    expect(obj.servers?.[0]?.id).toBe("10");
    expect(obj.servers?.[0]?.name).toBe("cattle-rex-10");
  });

  it("destroy --all --dry-run does not delete", async () => {
    listCattleServersMock.mockResolvedValue([
      {
        id: "11",
        name: "cattle-rex-11",
        persona: "rex",
        taskId: "t",
        ttlSeconds: 60,
        createdAt: new Date(1_700_000_000_000),
        expiresAt: new Date(1_700_000_060_000),
        ipv4: "",
        status: "running",
        labels: {},
      },
    ]);

    const logs: string[] = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const { cattle } = await import("../src/commands/cattle");
    await cattle.subCommands.destroy.run({
      args: { host: hostName, all: true, dryRun: true } as any,
    });

    expect(destroyCattleServerMock).not.toHaveBeenCalled();
    expect(logs.join("\n")).toMatch(/cattle-rex-11/);
  });
});
