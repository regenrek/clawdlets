import { describe, it, expect } from "vitest";

describe("clf jobs", () => {
  it("parses cattle.spawn payload", async () => {
    const { parseClfJobPayload } = await import("../src/jobs");

    const payload = parseClfJobPayload("cattle.spawn", {
      persona: "rex",
      task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "do it", callbackUrl: "" },
      ttl: "2h",
    });

    expect(payload.persona).toBe("rex");
    expect(payload.task.taskId).toBe("t1");
    expect(payload.ttl).toBe("2h");
  });

  it("parses cattle.reap payload with defaults", async () => {
    const { parseClfJobPayload } = await import("../src/jobs");
    const payload = parseClfJobPayload("cattle.reap", {});
    expect(payload.dryRun).toBe(false);
  });

  it("rejects unsupported job kinds", async () => {
    const { parseClfJobPayload } = await import("../src/jobs");
    expect(() => parseClfJobPayload("unknown" as any, {})).toThrow(/unsupported job kind/i);
  });
});
