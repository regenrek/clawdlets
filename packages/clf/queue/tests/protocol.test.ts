import { describe, it, expect } from "vitest";

describe("clf protocol", () => {
  it("exports stable enums", async () => {
    const mod = await import("../src/protocol");
    expect(mod.CLF_PROTOCOL_VERSION).toBe(1);
    expect(mod.ClfJobStatusSchema.options).toContain("queued");
    expect(mod.ClfJobKindSchema.options).toContain("cattle.spawn");
  });
});
