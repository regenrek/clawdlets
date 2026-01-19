import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const runMainMock = vi.fn();
const defineCommandMock = vi.fn((cmd) => cmd);
const readCliVersionMock = vi.fn(() => "0.0.0");

vi.mock("citty", () => ({
  runMain: runMainMock,
  defineCommand: defineCommandMock,
}));

vi.mock("../src/lib/version.js", () => ({
  readCliVersion: readCliVersionMock,
}));

describe("cli main", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalArgv = process.argv.slice();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.argv = originalArgv.slice();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (exitSpy) exitSpy.mockRestore();
    process.argv = originalArgv.slice();
  });

  it("prints version and exits", async () => {
    process.argv = ["node", "clawdlets", "--version"];
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as any);
    await expect(import("../src/main.ts")).rejects.toThrow(/exit:0/);
    expect(readCliVersionMock).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("0.0.0");
    expect(runMainMock).not.toHaveBeenCalled();
  });

  it("normalizes args and runs main", async () => {
    process.argv = ["node", "clawdlets", "--", "doctor"];
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as any);
    await import("../src/main.ts");
    expect(runMainMock).toHaveBeenCalledTimes(1);
    expect(process.argv).toEqual(["node", "clawdlets", "doctor"]);
  });
});
