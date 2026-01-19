import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const findRepoRootMock = vi.fn(() => "/repo");
const loadClawdletsConfigMock = vi.fn(() => ({ config: {} }));
const resolveHostNameMock = vi.fn();

vi.mock("@clawdlets/core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawdlets/core/lib/clawdlets-config", () => ({
  loadClawdletsConfig: loadClawdletsConfigMock,
  resolveHostName: resolveHostNameMock,
}));

describe("resolveHostNameOrExit", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("returns host when resolved", async () => {
    resolveHostNameMock.mockReturnValue({ ok: true, host: "alpha" });
    const { resolveHostNameOrExit } = await import("../src/lib/host-resolve.js");
    const host = resolveHostNameOrExit({ cwd: "/repo", hostArg: "alpha" });
    expect(host).toBe("alpha");
    expect(process.exitCode).toBe(0);
  });

  it("prints tips and sets exitCode on failure", async () => {
    resolveHostNameMock.mockReturnValue({
      ok: false,
      message: "missing host",
      tips: ["try --host alpha"],
    });
    const { resolveHostNameOrExit } = await import("../src/lib/host-resolve.js");
    const host = resolveHostNameOrExit({ cwd: "/repo", hostArg: "" });
    expect(host).toBeNull();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/missing host/));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/tip:/));
  });
});
