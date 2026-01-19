import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach } from "vitest";

const loadHostContextMock = vi.fn();
const resolveGitRevMock = vi.fn();
const captureMock = vi.fn();
const runMock = vi.fn();
const loadDeployCredsMock = vi.fn();

vi.mock("../src/lib/context.js", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

vi.mock("@clawdlets/core/lib/git", () => ({
  resolveGitRev: resolveGitRevMock,
}));

vi.mock("@clawdlets/core/lib/run", () => ({
  capture: captureMock,
  run: runMock,
}));

vi.mock("@clawdlets/core/lib/deploy-creds", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

describe("image command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("image build errors on non-linux", async () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    loadHostContextMock.mockReturnValue({
      repoRoot: "/repo",
      layout: { runtimeDir: "/repo/.clawdlets" },
      hostName: "alpha",
    });
    resolveGitRevMock.mockResolvedValue("deadbeef");
    const { image } = await import("../src/commands/image.js");
    await expect(image.subCommands?.build?.run?.({ args: { host: "alpha", dryRun: true } } as any)).rejects.toThrow(/requires Linux/i);
    platformSpy.mockRestore();
  });

  it("image upload runs hcloud-upload-image", async () => {
    loadHostContextMock.mockReturnValue({
      hostName: "alpha",
      hostCfg: { hetzner: { location: "nbg1" } },
    });
    loadDeployCredsMock.mockReturnValue({
      values: { HCLOUD_TOKEN: "token" },
    });
    const { image } = await import("../src/commands/image.js");
    await image.subCommands?.upload?.run?.({
      args: {
        host: "alpha",
        "image-url": "https://example.com/image.raw",
        compression: "none",
        architecture: "x86",
        dryRun: true,
      },
    } as any);
    expect(runMock).toHaveBeenCalledWith(
      "hcloud-upload-image",
      expect.arrayContaining(["upload", "--image-url", "https://example.com/image.raw"]),
      expect.objectContaining({ dryRun: true }),
    );
  });
});
