import { beforeEach, describe, expect, it, vi } from "vitest";

const loadHostContextMock = vi.fn();
const sshRunMock = vi.fn();

vi.mock("@clawdlets/core/lib/context", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

vi.mock("@clawdlets/core/lib/ssh-remote", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clawdlets/core/lib/ssh-remote")>();
  return {
    ...actual,
    sshRun: sshRunMock,
  };
});

vi.mock("../src/commands/ssh-target.js", () => ({
  needsSudo: (targetHost: string) => !targetHost.startsWith("root@"),
  requireTargetHost: (v: string) => v,
}));

describe("server channels command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("status builds exact remote command (quoted) + tty", async () => {
    loadHostContextMock.mockReturnValue({ hostName: "alpha", hostCfg: { targetHost: "admin@host" } });

    const { serverChannels } = await import("../src/commands/server/channels.js");
    await serverChannels.subCommands?.status?.run?.({
      args: { host: "alpha", targetHost: "admin@host", bot: "maren", probe: true, timeout: "10000", json: true, sshTty: true },
    } as any);

    expect(sshRunMock).toHaveBeenCalledWith(
      "admin@host",
      "'sudo' '/etc/clawdlets/bin/clawdbot-channels' '--bot' 'maren' 'status' '--probe' '--timeout' '10000' '--json'",
      { tty: true },
    );
  });

  it("capabilities builds exact remote command (quoted)", async () => {
    loadHostContextMock.mockReturnValue({ hostName: "alpha", hostCfg: { targetHost: "admin@host" } });

    const { serverChannels } = await import("../src/commands/server/channels.js");
    await serverChannels.subCommands?.capabilities?.run?.({
      args: {
        host: "alpha",
        targetHost: "admin@host",
        bot: "maren",
        channel: "discord",
        account: "default",
        target: "discord channel:123",
        timeout: "10000",
        json: true,
        sshTty: false,
      },
    } as any);

    expect(sshRunMock).toHaveBeenCalledWith(
      "admin@host",
      "'sudo' '/etc/clawdlets/bin/clawdbot-channels' '--bot' 'maren' 'capabilities' '--channel' 'discord' '--account' 'default' '--target' 'discord channel:123' '--timeout' '10000' '--json'",
      { tty: false },
    );
  });

  it("login builds exact remote command (quoted)", async () => {
    loadHostContextMock.mockReturnValue({ hostName: "alpha", hostCfg: { targetHost: "admin@host" } });

    const { serverChannels } = await import("../src/commands/server/channels.js");
    await serverChannels.subCommands?.login?.run?.({
      args: { host: "alpha", targetHost: "admin@host", bot: "maren", channel: "whatsapp", account: "default", verbose: true, sshTty: true },
    } as any);

    expect(sshRunMock).toHaveBeenCalledWith(
      "admin@host",
      "'sudo' '/etc/clawdlets/bin/clawdbot-channels' '--bot' 'maren' 'login' '--channel' 'whatsapp' '--account' 'default' '--verbose'",
      { tty: true },
    );
  });

  it("logout builds exact remote command (quoted) without sudo for root@", async () => {
    loadHostContextMock.mockReturnValue({ hostName: "alpha", hostCfg: { targetHost: "root@host" } });

    const { serverChannels } = await import("../src/commands/server/channels.js");
    await serverChannels.subCommands?.logout?.run?.({
      args: { host: "alpha", targetHost: "root@host", bot: "maren", channel: "whatsapp", account: "default", sshTty: false },
    } as any);

    expect(sshRunMock).toHaveBeenCalledWith(
      "root@host",
      "'/etc/clawdlets/bin/clawdbot-channels' '--bot' 'maren' 'logout' '--channel' 'whatsapp' '--account' 'default'",
      { tty: false },
    );
  });
});

