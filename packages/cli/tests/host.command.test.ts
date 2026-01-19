import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { makeConfig, baseHost } from "./fixtures.js";

const findRepoRootMock = vi.fn(() => "/repo");
const loadClawdletsConfigMock = vi.fn();
const writeClawdletsConfigMock = vi.fn();
const resolveHostNameMock = vi.fn();

vi.mock("@clawdlets/core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawdlets/core/lib/clawdlets-config", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/core/lib/clawdlets-config")>(
    "@clawdlets/core/lib/clawdlets-config",
  );
  return {
    ...actual,
    loadClawdletsConfig: loadClawdletsConfigMock,
    writeClawdletsConfig: writeClawdletsConfigMock,
    resolveHostName: resolveHostNameMock,
  };
});

describe("host command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("adds a host", async () => {
    const config = makeConfig();
    loadClawdletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawdlets.json", config });
    const { host } = await import("../src/commands/host.js");
    await host.subCommands?.add?.run?.({ args: { host: "beta" } } as any);
    expect(writeClawdletsConfigMock).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("ok: added host beta");
  });

  it("set-default warns on invalid host", async () => {
    const config = makeConfig();
    loadClawdletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawdlets.json", config });
    resolveHostNameMock.mockReturnValue({ ok: false, message: "bad host", tips: ["use --host alpha"] });
    const { host } = await import("../src/commands/host.js");
    await host.subCommands?.["set-default"]?.run?.({ args: { host: "nope" } } as any);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/warn:/));
  });

  it("set updates ssh keys and known hosts", async () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-host-"));
    const keyFile = path.join(tmp, "id_ed25519.pub");
    const knownFile = path.join(tmp, "known_hosts");
    const pubKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEk4yXx5oKXxmA3k2xZ6oUw1wK8bC9B8dJr3p+o8k8P test@example";
    fs.writeFileSync(keyFile, `${pubKey}\n`, "utf8");
    fs.writeFileSync(knownFile, "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake\n", "utf8");

    const config = makeConfig({ hostName: "alpha", hostOverrides: { ...baseHost } });
    loadClawdletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawdlets.json", config });
    resolveHostNameMock.mockReturnValue({ ok: true, host: "alpha" });
    const { host } = await import("../src/commands/host.js");
    await host.subCommands?.set?.run?.({
      args: {
        host: "alpha",
        "ssh-exposure": "bootstrap",
        "add-ssh-key-file": keyFile,
        "add-ssh-known-host-file": knownFile,
      },
    } as any);
    expect(writeClawdletsConfigMock).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("ok: updated host alpha");
  });

  it("set warns on unknown host entry", async () => {
    const config = makeConfig({ hostName: "alpha", hostOverrides: { ...baseHost } });
    loadClawdletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawdlets.json", config });
    resolveHostNameMock.mockReturnValue({ ok: true, host: "beta" });
    const { host } = await import("../src/commands/host.js");
    await host.subCommands?.set?.run?.({ args: { host: "beta", enable: "true" } } as any);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/unknown host/i));
  });

  it("set rejects invalid booleans and modes", async () => {
    const config = makeConfig({ hostName: "alpha", hostOverrides: { ...baseHost } });
    loadClawdletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawdlets.json", config });
    resolveHostNameMock.mockReturnValue({ ok: true, host: "alpha" });
    const { host } = await import("../src/commands/host.js");
    await expect(
      host.subCommands?.set?.run?.({ args: { host: "alpha", enable: "maybe" } } as any),
    ).rejects.toThrow(/invalid boolean/i);
    await expect(
      host.subCommands?.set?.run?.({ args: { host: "alpha", "ssh-exposure": "nope" } } as any),
    ).rejects.toThrow(/invalid --ssh-exposure/i);
    await expect(
      host.subCommands?.set?.run?.({ args: { host: "alpha", tailnet: "nope" } } as any),
    ).rejects.toThrow(/invalid --tailnet/i);
  });

  it("set rejects invalid ssh keys", async () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-host-"));
    const privFile = path.join(tmp, "id_ed25519");
    fs.writeFileSync(privFile, "-----BEGIN OPENSSH PRIVATE KEY-----\n", "utf8");

    const config = makeConfig({ hostName: "alpha", hostOverrides: { ...baseHost } });
    loadClawdletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawdlets.json", config });
    resolveHostNameMock.mockReturnValue({ ok: true, host: "alpha" });
    const { host } = await import("../src/commands/host.js");
    await expect(
      host.subCommands?.set?.run?.({ args: { host: "alpha", "add-ssh-key": "not-a-key" } } as any),
    ).rejects.toThrow(/invalid --add-ssh-key/i);
    await expect(
      host.subCommands?.set?.run?.({ args: { host: "alpha", "add-ssh-key-file": privFile } } as any),
    ).rejects.toThrow(/private key/i);
  });

  it("set rejects invalid known_hosts input", async () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawdlets-host-"));
    const emptyKnown = path.join(tmp, "known_hosts");
    fs.writeFileSync(emptyKnown, "\n", "utf8");
    const config = makeConfig({ hostName: "alpha", hostOverrides: { ...baseHost } });
    loadClawdletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawdlets.json", config });
    resolveHostNameMock.mockReturnValue({ ok: true, host: "alpha" });
    const { host } = await import("../src/commands/host.js");
    await expect(
      host.subCommands?.set?.run?.({ args: { host: "alpha", "add-ssh-known-host-file": emptyKnown } } as any),
    ).rejects.toThrow(/no known_hosts entries/i);
  });
});
