import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config";

const findRepoRootMock = vi.hoisted(() => vi.fn());
vi.mock("@clawdlets/core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

const loadClawdletsConfigRawMock = vi.hoisted(() => vi.fn());
const loadClawdletsConfigMock = vi.hoisted(() => vi.fn());
const writeClawdletsConfigMock = vi.hoisted(() => vi.fn());
vi.mock("@clawdlets/core/lib/clawdlets-config", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/core/lib/clawdlets-config")>("@clawdlets/core/lib/clawdlets-config");
  return {
    ...actual,
    loadClawdletsConfigRaw: loadClawdletsConfigRawMock,
    loadClawdletsConfig: loadClawdletsConfigMock,
    writeClawdletsConfig: writeClawdletsConfigMock,
  };
});

describe("config set", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    findRepoRootMock.mockReturnValue("/repo");
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("init refuses overwrite without --force", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-config-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    const configPath = path.join(repoRoot, "fleet", "clawdlets.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "{}", "utf8");
    const { config } = await import("../src/commands/config");
    await expect(config.subCommands.init.run({ args: { host: "alpha", force: false } } as any)).rejects.toThrow(
      /config already exists/i,
    );
  });

  it("init dry-run prints planned write", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-config-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    const { config } = await import("../src/commands/config");
    await config.subCommands.init.run({ args: { host: "alpha", "dry-run": true } } as any);
    expect(writeClawdletsConfigMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/planned: write/i));
  });

  it("show prints JSON", async () => {
    const configObj = createDefaultClawdletsConfig({ host: "alpha", bots: [] });
    loadClawdletsConfigMock.mockReturnValue({ config: configObj });
    const { config } = await import("../src/commands/config");
    await config.subCommands.show.run({ args: { pretty: false } } as any);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(configObj));
  });

  it("validate prints ok", async () => {
    const configObj = createDefaultClawdletsConfig({ host: "alpha", bots: [] });
    loadClawdletsConfigMock.mockReturnValue({ config: configObj });
    const { config } = await import("../src/commands/config");
    await config.subCommands.validate.run({ args: {} } as any);
    expect(logSpy).toHaveBeenCalledWith("ok");
  });

  it("get prints JSON path output", async () => {
    const configObj = createDefaultClawdletsConfig({ host: "alpha", bots: [] });
    loadClawdletsConfigMock.mockReturnValue({ config: configObj });
    const { config } = await import("../src/commands/config");
    await config.subCommands.get.run({ args: { path: "defaultHost", json: true } } as any);
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] || "{}"));
    expect(payload.path).toBe("defaultHost");
    expect(payload.value).toBe("alpha");
  });

  it("can fix an invalid config by applying a valid update", async () => {
    const baseConfig = createDefaultClawdletsConfig({ host: "clawdbot-fleet-host", bots: [] });
    baseConfig.cattle.enabled = true;
    baseConfig.cattle.hetzner.image = "";
    loadClawdletsConfigRawMock.mockReturnValue({
      configPath: "/repo/fleet/clawdlets.json",
      config: baseConfig,
    });

    const { config } = await import("../src/commands/config");
    await config.subCommands.set.run({
      args: { path: "cattle.enabled", "value-json": "false" } as any,
    });

    expect(writeClawdletsConfigMock).toHaveBeenCalledTimes(1);
    const call = writeClawdletsConfigMock.mock.calls[0][0];
    expect(call.config.cattle.enabled).toBe(false);
  });

  it("set fails on invalid JSON", async () => {
    const baseConfig = createDefaultClawdletsConfig({ host: "alpha", bots: [] });
    loadClawdletsConfigRawMock.mockReturnValue({
      configPath: "/repo/fleet/clawdlets.json",
      config: baseConfig,
    });
    const { config } = await import("../src/commands/config");
    await expect(config.subCommands.set.run({ args: { path: "fleet.botOrder", "value-json": "nope" } } as any)).rejects.toThrow(
      /invalid --value-json/i,
    );
  });

  it("set rejects missing value flags", async () => {
    const baseConfig = createDefaultClawdletsConfig({ host: "alpha", bots: [] });
    loadClawdletsConfigRawMock.mockReturnValue({
      configPath: "/repo/fleet/clawdlets.json",
      config: baseConfig,
    });
    const { config } = await import("../src/commands/config");
    await expect(config.subCommands.set.run({ args: { path: "fleet.botOrder" } } as any)).rejects.toThrow(
      /set requires/i,
    );
  });

  it("set delete errors on missing path", async () => {
    const baseConfig = createDefaultClawdletsConfig({ host: "alpha", bots: [] });
    loadClawdletsConfigRawMock.mockReturnValue({
      configPath: "/repo/fleet/clawdlets.json",
      config: baseConfig,
    });
    const { config } = await import("../src/commands/config");
    await expect(config.subCommands.set.run({ args: { path: "fleet.nope", delete: true } } as any)).rejects.toThrow(
      /path not found/i,
    );
  });
});
