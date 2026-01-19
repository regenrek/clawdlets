import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

const findRepoRootMock = vi.fn(() => "/repo");
const resolveHostNameOrExitMock = vi.fn(() => "alpha");
const collectDoctorChecksMock = vi.fn();
const renderDoctorReportMock = vi.fn(() => "report");

vi.mock("@clawdlets/core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("../src/lib/host-resolve.js", () => ({
  resolveHostNameOrExit: resolveHostNameOrExitMock,
}));

vi.mock("@clawdlets/core/doctor", () => ({
  collectDoctorChecks: collectDoctorChecksMock,
}));

vi.mock("../src/lib/doctor-render.js", () => ({
  renderDoctorReport: renderDoctorReportMock,
}));

describe("doctor command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("rejects invalid scope", async () => {
    const { doctor } = await import("../src/commands/doctor.js");
    await expect(doctor.run({ args: { scope: "nope" } } as any)).rejects.toThrow(/invalid --scope/i);
  });

  it("prints json output", async () => {
    collectDoctorChecksMock.mockResolvedValue([{ status: "ok", scope: "repo", label: "ok" }]);
    const { doctor } = await import("../src/commands/doctor.js");
    await doctor.run({ args: { json: true } } as any);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("\"checks\""));
  });

  it("sets exitCode when missing checks", async () => {
    collectDoctorChecksMock.mockResolvedValue([{ status: "missing", scope: "repo", label: "missing" }]);
    const { doctor } = await import("../src/commands/doctor.js");
    await doctor.run({ args: {} } as any);
    expect(process.exitCode).toBe(1);
  });

  it("exits early for CLI repo without clawdlets.json", async () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (String(p).endsWith("config/template-source.json")) return true;
      if (String(p).endsWith("fleet/clawdlets.json")) return false;
      return false;
    });
    const { doctor } = await import("../src/commands/doctor.js");
    await doctor.run({ args: { scope: "repo" } } as any);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/CLI repo detected/i));
    existsSpy.mockRestore();
  });
});
