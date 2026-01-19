import { describe, expect, it, vi, beforeEach } from "vitest";

const collectDoctorChecksMock = vi.fn();
const renderDoctorGateFailureMock = vi.fn(() => "gate failed");

vi.mock("@clawdlets/core/doctor", () => ({
  collectDoctorChecks: collectDoctorChecksMock,
}));

vi.mock("../src/lib/doctor-render.js", () => ({
  renderDoctorGateFailure: renderDoctorGateFailureMock,
}));

describe("requireDeployGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes when no missing and strict=false", async () => {
    collectDoctorChecksMock.mockResolvedValue([{ status: "ok", scope: "repo", label: "ok" }]);
    const { requireDeployGate } = await import("../src/lib/deploy-gate.js");
    await expect(requireDeployGate({ host: "alpha", scope: "repo", strict: false })).resolves.toBeUndefined();
  });

  it("throws when missing checks exist", async () => {
    collectDoctorChecksMock.mockResolvedValue([{ status: "missing", scope: "repo", label: "missing" }]);
    const { requireDeployGate } = await import("../src/lib/deploy-gate.js");
    await expect(requireDeployGate({ host: "alpha", scope: "repo", strict: false })).rejects.toThrow(/gate failed/);
  });

  it("throws on warn when strict", async () => {
    collectDoctorChecksMock.mockResolvedValue([{ status: "warn", scope: "repo", label: "warn" }]);
    const { requireDeployGate } = await import("../src/lib/deploy-gate.js");
    await expect(requireDeployGate({ host: "alpha", scope: "repo", strict: true })).rejects.toThrow(/gate failed/);
  });
});
