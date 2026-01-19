import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeConfig } from "./fixtures.js";

const loadHostContextMock = vi.fn();
const sshRunMock = vi.fn();

vi.mock("../src/lib/context.js", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

vi.mock("@clawdlets/core/lib/ssh-remote", () => ({
  sshRun: sshRunMock,
  shellQuote: (s: string) => s,
}));

vi.mock("../src/commands/ssh-target.js", () => ({
  needsSudo: () => false,
  requireTargetHost: (v: string) => v,
}));

describe("server github-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs status/run/logs/show commands", async () => {
    const config = makeConfig({ hostName: "alpha" });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ hostName: "alpha", hostCfg });
    const { serverGithubSync } = await import("../src/commands/server/github-sync.js");
    await serverGithubSync.subCommands?.status?.run?.({ args: { host: "alpha", targetHost: "admin@host" } } as any);
    await serverGithubSync.subCommands?.run?.run?.({ args: { host: "alpha", targetHost: "admin@host", bot: "maren" } } as any);
    await serverGithubSync.subCommands?.logs?.run?.({ args: { host: "alpha", targetHost: "admin@host", bot: "maren", lines: "10" } } as any);
    await serverGithubSync.subCommands?.show?.run?.({ args: { host: "alpha", targetHost: "admin@host", bot: "maren", kind: "prs", lines: "10" } } as any);
    expect(sshRunMock).toHaveBeenCalled();
  });
});
