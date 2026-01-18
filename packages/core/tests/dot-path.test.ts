import { describe, it, expect } from "vitest";
import { splitDotPath } from "../src/lib/dot-path";

describe("splitDotPath", () => {
  it("rejects prototype pollution segments", () => {
    expect(() => splitDotPath("__proto__.x")).toThrow(/invalid --path segment/i);
    expect(() => splitDotPath("constructor.y")).toThrow(/invalid --path segment/i);
    expect(() => splitDotPath("a.prototype.b")).toThrow(/invalid --path segment/i);
  });

  it("splits and trims dot paths", () => {
    expect(splitDotPath(" fleet.botOrder ")).toEqual(["fleet", "botOrder"]);
    expect(splitDotPath("a..b")).toEqual(["a", "b"]);
  });

  it("rejects empty paths", () => {
    expect(() => splitDotPath("")).toThrow(/missing --path/i);
    expect(() => splitDotPath("   ")).toThrow(/missing --path/i);
    expect(() => splitDotPath(".")).toThrow(/invalid --path/i);
  });
});
