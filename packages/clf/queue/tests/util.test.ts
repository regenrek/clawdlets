import { describe, it, expect } from "vitest";
import {
  safeParseJson,
  isSafeEnvVarName,
  computeBackoffMs,
  sha256Hex,
  isSqliteUniqueConstraintError,
} from "../src/queue/util";

describe("clf queue util", () => {
  it("parses json safely", () => {
    expect(safeParseJson(null)).toBeNull();
    expect(safeParseJson("not-json")).toBeNull();
    expect(safeParseJson("{\"ok\":true}")).toEqual({ ok: true });
  });

  it("validates env var names", () => {
    expect(isSafeEnvVarName("OPENAI_API_KEY")).toBe(true);
    expect(isSafeEnvVarName("BAD-NAME")).toBe(false);
  });

  it("computes backoff with bounds", () => {
    expect(computeBackoffMs({ attempt: 1, baseMs: 1000, maxMs: 10_000 })).toBe(1000);
    expect(computeBackoffMs({ attempt: 3, baseMs: 1000, maxMs: 10_000 })).toBe(4000);
    expect(computeBackoffMs({ attempt: 10, baseMs: 1000, maxMs: 5000 })).toBe(5000);
  });

  it("hashes values and detects sqlite unique errors", () => {
    expect(sha256Hex("hello")).toMatch(/^[0-9a-f]{64}$/);
    expect(isSqliteUniqueConstraintError({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe(true);
    expect(isSqliteUniqueConstraintError({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" })).toBe(true);
    expect(isSqliteUniqueConstraintError({ code: "OTHER" })).toBe(false);
  });
});
