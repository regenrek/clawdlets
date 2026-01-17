import { describe, it, expect } from "vitest";

describe("clf jobs", () => {
  it("parses cattle.spawn payload", async () => {
    const { parseClfJobPayload } = await import("../src/jobs");

    const payload = parseClfJobPayload("cattle.spawn", {
      identity: "rex",
      task: { schemaVersion: 1, taskId: "t1", type: "clawdbot.gateway.agent", message: "do it", callbackUrl: "" },
      ttl: "2h",
    });

    expect(payload.identity).toBe("rex");
    expect(payload.task.taskId).toBe("t1");
    expect(payload.ttl).toBe("2h");
  });
});

