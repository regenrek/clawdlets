import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeConfig } from "./fixtures.js";

const loadHostContextMock = vi.fn();
const loadDeployCredsMock = vi.fn();
const listCattleServersMock = vi.fn();
const buildCattleLabelSelectorMock = vi.fn(() => "labels");
const resolveTailscaleIpv4Mock = vi.fn();
const sshRunMock = vi.fn();
const runMock = vi.fn();

vi.mock("@clawdlets/core/lib/context", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

vi.mock("@clawdlets/core/lib/deploy-creds", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

vi.mock("@clawdlets/cattle-core/lib/hcloud-cattle", () => ({
  listCattleServers: listCattleServersMock,
  buildCattleLabelSelector: buildCattleLabelSelectorMock,
}));

vi.mock("@clawdlets/core/lib/ssh-remote", () => ({
  sshRun: sshRunMock,
  shellQuote: (s: string) => s,
}));

vi.mock("@clawdlets/core/lib/run", () => ({
  run: runMock,
}));

vi.mock("../src/commands/cattle/common.js", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/cattle/common.js")>(
    "../src/commands/cattle/common.js",
  );
  return {
    ...actual,
    resolveOne: (servers: Array<{ id: number; name: string }>, idOrName: string) =>
      servers.find((s) => String(s.id) === idOrName || s.name === idOrName) ?? servers[0],
    resolveTailscaleIpv4: resolveTailscaleIpv4Mock,
  };
});

describe("cattle logs/ssh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs via tailnet ssh", async () => {
    const config = makeConfig({ fleetOverrides: { botOrder: [] } });
    (config as any).cattle = { enabled: true };
    loadHostContextMock.mockReturnValue({ config });
    loadDeployCredsMock.mockReturnValue({ values: { HCLOUD_TOKEN: "token" } });
    listCattleServersMock.mockResolvedValue([{ id: 1, name: "cattle-1" }]);
    resolveTailscaleIpv4Mock.mockResolvedValue("100.64.0.10");
    const { cattleLogs } = await import("../src/commands/cattle/logs.js");
    await cattleLogs.run({ args: { idOrName: "1", lines: "10" } } as any);
    expect(sshRunMock).toHaveBeenCalled();
  });

  it("ssh opens session", async () => {
    const config = makeConfig({ fleetOverrides: { botOrder: [] } });
    (config as any).cattle = { enabled: true };
    loadHostContextMock.mockReturnValue({ config });
    loadDeployCredsMock.mockReturnValue({ values: { HCLOUD_TOKEN: "token" } });
    listCattleServersMock.mockResolvedValue([{ id: 1, name: "cattle-1" }]);
    resolveTailscaleIpv4Mock.mockResolvedValue("100.64.0.10");
    const { cattleSsh } = await import("../src/commands/cattle/ssh.js");
    await cattleSsh.run({ args: { idOrName: "1" } } as any);
    expect(runMock).toHaveBeenCalledWith("ssh", ["-t", "--", "admin@100.64.0.10"], { redact: [] });
  });
});
