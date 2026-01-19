import { describe, expect, it } from "vitest";
import { renderDoctorGateFailure, renderDoctorReport } from "../src/lib/doctor-render.js";

const checks = [
  { scope: "repo", status: "ok", label: "Repo OK" },
  { scope: "repo", status: "missing", label: "Secrets missing", detail: "nope" },
  { scope: "server-deploy", status: "warn", label: "SSH exposure", detail: "bootstrap" },
  { scope: "bootstrap", status: "ok", label: "Nix ok" },
];

describe("doctor render", () => {
  it("renders report with grouped categories and summary", () => {
    const out = renderDoctorReport({ checks, host: "alpha", scope: "all", strict: false, showOk: false });
    expect(out).toMatch(/doctor: host=alpha scope=all/);
    expect(out).toMatch(/summary: ok=2 warn=1 missing=1/);
    expect(out).toMatch(/repo \/ secrets/);
    expect(out).toMatch(/\[MISSING\] Secrets missing/);
    expect(out).not.toMatch(/\[OK\] Repo OK/);
  });

  it("renders gate failure summary", () => {
    const out = renderDoctorGateFailure({ checks, scope: "server-deploy", strict: true });
    expect(out).toMatch(/doctor gate failed \(server-deploy, strict\)/);
    expect(out).toMatch(/missing=1 warn=1/);
    expect(out).toMatch(/hint: run clawdlets doctor --scope server-deploy --strict/);
  });
});
