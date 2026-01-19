import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getRepoLayout } from "@clawdlets/core/repo-layout";
import { makeConfig } from "./fixtures.js";

const loadHostContextMock = vi.fn();

vi.mock("../src/lib/context.js", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

describe("secrets path", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("prints local and remote paths", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({ hostName: "alpha" });
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha" });
    const { secretsPath } = await import("../src/commands/secrets/path.js");
    await secretsPath.run({ args: { host: "alpha" } } as any);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("local:"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("remote:"));
  });
});
