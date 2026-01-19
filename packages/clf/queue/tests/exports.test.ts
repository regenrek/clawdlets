import { describe, it, expect } from "vitest";

describe("clf queue exports", () => {
  it("re-exports protocol, queue, and client helpers", async () => {
    const index = await import("../src/index");
    const queue = await import("../src/queue");
    const types = await import("../src/queue/types");

    expect(index.CLF_PROTOCOL_VERSION).toBe(1);
    expect(typeof index.openClfQueue).toBe("function");
    expect(typeof index.createClfClient).toBe("function");
    expect(typeof index.parseClfJobPayload).toBe("function");
    expect(typeof queue.openClfQueue).toBe("function");
    expect(types).toBeDefined();
  });
});
