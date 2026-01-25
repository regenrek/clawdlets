import { describe, it, expect } from "vitest";

describe("ttl", () => {
  it("parses ttl strings", async () => {
    const { parseTtlToSeconds } = await import("@clawdlets/cattle-core/lib/ttl");
    expect(parseTtlToSeconds("30s")?.seconds).toBe(30);
    expect(parseTtlToSeconds("15m")?.seconds).toBe(15 * 60);
    expect(parseTtlToSeconds("2h")?.seconds).toBe(2 * 60 * 60);
    expect(parseTtlToSeconds("1d")?.seconds).toBe(24 * 60 * 60);
  });

  it("rejects invalid ttl strings", async () => {
    const { parseTtlToSeconds } = await import("@clawdlets/cattle-core/lib/ttl");
    expect(parseTtlToSeconds("")).toBeNull();
    expect(parseTtlToSeconds("0m")).toBeNull();
    expect(parseTtlToSeconds("2 hours")).toBeNull();
    expect(parseTtlToSeconds("m2")).toBeNull();
  });
});

