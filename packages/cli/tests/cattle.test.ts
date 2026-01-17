import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getRepoLayout } from "@clawdlets/core/repo-layout";

const loadHostContextOrExitMock = vi.fn();
vi.mock("../src/lib/context.js", () => ({
  loadHostContextOrExit: loadHostContextOrExitMock,
}));

const loadDeployCredsMock = vi.fn();
vi.mock("@clawdlets/core/lib/deploy-creds", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

const loadIdentityMock = vi.fn();
vi.mock("@clawdlets/core/lib/identity-loader", () => ({
  loadIdentity: loadIdentityMock,
}));

const sopsDecryptYamlFileMock = vi.fn(async (params: { filePath: string }) => {
  const name = path.basename(params.filePath, ".yaml");
  return `${name}: secret-${name}\n`;
});
vi.mock("@clawdlets/core/lib/sops", () => ({
  sopsDecryptYamlFile: sopsDecryptYamlFileMock,
}));

const listCattleServersMock = vi.fn();
const createCattleServerMock = vi.fn();
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
vi.mock("@clawdlets/core/lib/hcloud-cattle", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/core/lib/hcloud-cattle")>("@clawdlets/core/lib/hcloud-cattle");
  return {
    ...actual,
    listCattleServers: listCattleServersMock,
    createCattleServer: createCattleServerMock,
    destroyCattleServer: destroyCattleServerMock,
    reapExpiredCattle: reapExpiredCattleMock,
  };
});

describe("cattle command", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-cli-cattle-"));
  const layout = getRepoLayout(repoRoot);
  const hostName = "clawdbot-fleet-host";

  const hostCfg = {
    sshAuthorizedKeys: ["ssh-ed25519 AAA"],
    agentModelPrimary: "zai/glm-4.7",
  } as any;

  const config = {
    schemaVersion: 6,
    fleet: { envSecrets: { ZAI_API_KEY: "z_ai_api_key", Z_AI_API_KEY: "z_ai_api_key" } },
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

    fs.mkdirSync(path.join(repoRoot, "secrets", "hosts", hostName), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "secrets", "hosts", hostName, "tailscale_auth_key.yaml"), "sops: {}\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "secrets", "hosts", hostName, "z_ai_api_key.yaml"), "sops: {}\n", "utf8");

    const ageKeyFile = path.join(repoRoot, "agekey.txt");
    fs.writeFileSync(ageKeyFile, "AGE-SECRET-KEY-1...\n", "utf8");

    loadDeployCredsMock.mockReturnValue({
      envFile: { origin: "default", status: "ok", path: path.join(layout.runtimeDir, "env") },
      values: { HCLOUD_TOKEN: "token", GITHUB_TOKEN: "", NIX_BIN: "nix", SOPS_AGE_KEY_FILE: ageKeyFile },
    });

    loadHostContextOrExitMock.mockReturnValue({
      repoRoot,
      layout,
      config,
      hostName,
      hostCfg,
    });

    loadIdentityMock.mockReturnValue({
      name: "rex",
      config: { model: { primary: "zai/glm-4.7" } },
      cloudInitFiles: [
        { path: "/var/lib/clawdlets/identity/SOUL.md", permissions: "0600", owner: "root:root", content: "# Rex\n" },
        { path: "/var/lib/clawdlets/identity/config.json", permissions: "0600", owner: "root:root", content: "{\n}\n" },
      ],
    });
  });

  afterEach(() => {
    if (logSpy) logSpy.mockRestore();
    if (nowSpy) nowSpy.mockRestore();
    logSpy = undefined;
    nowSpy = undefined;
  });

  it("spawn --dry-run prints a deterministic plan JSON", async () => {
    const taskFile = path.join(repoRoot, "task.json");
    fs.writeFileSync(
      taskFile,
      JSON.stringify({ schemaVersion: 1, taskId: "issue-42", type: "clawdbot.gateway.agent", message: "do the thing", callbackUrl: "" }, null, 2),
      "utf8",
    );

    nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    listCattleServersMock.mockResolvedValue([]);

    const logs: string[] = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const { cattle } = await import("../src/commands/cattle");
    await cattle.subCommands.spawn.run({
      args: { host: hostName, identity: "rex", taskFile, ttl: "2h", dryRun: true } as any,
    });

    const obj = JSON.parse(logs.join("\n"));
    expect(obj.action).toBe("hcloud.server.create");
    expect(obj.labels.identity).toBe("rex");
    expect(obj.labels["task-id"]).toBe("issue-42");
    expect(obj.createdAt).toBe(1_700_000_000);
    expect(obj.expiresAt).toBe(1_700_000_000 + 7200);
  });

  it("reap --dry-run does not delete", async () => {
    const logs: string[] = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    listCattleServersMock.mockResolvedValue([
      {
        id: "1",
        name: "cattle-rex-1",
        identity: "rex",
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
        identity: "rex",
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
        identity: "rex",
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
        identity: "rex",
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
