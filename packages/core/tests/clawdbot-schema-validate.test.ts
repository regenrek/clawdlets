import { describe, expect, it } from "vitest";
import {
  __test_getCompileCount,
  __test_getValidatorCacheMax,
  __test_resetValidatorCache,
  validateClawdbotConfig,
} from "../src/lib/clawdbot-schema-validate.js";

describe("clawdbot schema validation issues", () => {
  it("points required property path", () => {
    const schema = { type: "object", required: ["name"] };
    const res = validateClawdbotConfig({}, schema);
    expect(res.ok).toBe(false);
    expect(res.issues[0]?.path).toEqual(["name"]);
  });

  it("points nested required property path", () => {
    const schema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: { inner: { type: "string" } },
          required: ["inner"],
          additionalProperties: false,
        },
      },
      required: ["outer"],
      additionalProperties: false,
    };
    const res = validateClawdbotConfig({ outer: {} }, schema);
    expect(res.ok).toBe(false);
    expect(res.issues[0]?.path).toEqual(["outer", "inner"]);
  });

  it("points additionalProperties path", () => {
    const schema = {
      type: "object",
      properties: { ok: { type: "string" } },
      additionalProperties: false,
    };
    const res = validateClawdbotConfig({ ok: "x", extra: 1 }, schema);
    expect(res.ok).toBe(false);
    const paths = res.issues.map((i) => i.path.join("."));
    expect(paths).toContain("extra");
  });

  it("points propertyNames path", () => {
    const schema = { type: "object", propertyNames: { pattern: "^ok" } };
    const res = validateClawdbotConfig({ bad: 1 }, schema);
    expect(res.ok).toBe(false);
    const paths = res.issues.map((i) => i.path.join("."));
    expect(paths).toContain("bad");
  });

  it("points unevaluatedProperties path", () => {
    const schema = {
      type: "object",
      properties: { ok: { type: "string" } },
      unevaluatedProperties: false,
    };
    const res = validateClawdbotConfig({ ok: "x", extra: 1 }, schema);
    expect(res.ok).toBe(false);
    const paths = res.issues.map((i) => i.path.join("."));
    expect(paths).toContain("extra");
  });

  it("captures array indices and JSON pointer decode", () => {
    const schema = {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "number" } },
        "a/b": { type: "string" },
      },
      additionalProperties: false,
    };
    const res = validateClawdbotConfig({ items: ["x"], "a/b": 1 }, schema);
    expect(res.ok).toBe(false);
    const paths = res.issues.map((i) => i.path.join("."));
    expect(paths.some((p) => p === "items.0")).toBe(true);
    expect(paths.some((p) => p === "a/b")).toBe(true);
  });

  it("decodes ~0 in JSON pointers", () => {
    const schema = {
      type: "object",
      properties: {
        "a~b": { type: "string" },
      },
      additionalProperties: false,
    };
    const res = validateClawdbotConfig({ "a~b": 1 }, schema);
    expect(res.ok).toBe(false);
    const paths = res.issues.map((i) => i.path.join("."));
    expect(paths).toContain("a~b");
  });

  it("caches compiled validators for the same schema object", () => {
    __test_resetValidatorCache();
    const schema = {
      type: "object",
      properties: { ok: { type: "string" } },
      additionalProperties: false,
    };
    const first = validateClawdbotConfig({ ok: "yes" }, schema);
    const second = validateClawdbotConfig({ ok: "no" }, schema);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(__test_getCompileCount()).toBe(1);
  });

  it("caches compiled validators across identical schema content", () => {
    __test_resetValidatorCache();
    const schemaA = {
      type: "object",
      properties: { ok: { type: "string" } },
      additionalProperties: false,
    };
    const schemaB = JSON.parse(JSON.stringify(schemaA));
    const first = validateClawdbotConfig({ ok: "yes" }, schemaA);
    const second = validateClawdbotConfig({ ok: "no" }, schemaB);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(__test_getCompileCount()).toBe(1);
  });

  it("recompiles when schema content changes despite same $id", () => {
    __test_resetValidatorCache();
    const schemaA = {
      $id: "clawdbot-test",
      type: "object",
      properties: { ok: { type: "string" } },
      additionalProperties: false,
    };
    const schemaB = {
      $id: "clawdbot-test",
      type: "object",
      properties: { ok: { type: "number" } },
      additionalProperties: false,
    };
    const first = validateClawdbotConfig({ ok: "yes" }, schemaA);
    const second = validateClawdbotConfig({ ok: 123 }, schemaB);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(__test_getCompileCount()).toBe(2);
  });

  it("evicts least-recently-used schema fingerprints", () => {
    __test_resetValidatorCache();
    const max = __test_getValidatorCacheMax();
    const baseSchema = {
      type: "object",
      properties: { ok: { type: "string" } },
      additionalProperties: false,
    };
    expect(validateClawdbotConfig({ ok: "yes" }, baseSchema).ok).toBe(true);

    for (let i = 0; i < max; i += 1) {
      const schema = {
        type: "object",
        properties: { [`k${i}`]: { type: "string" } },
        additionalProperties: false,
      };
      expect(validateClawdbotConfig({ [`k${i}`]: "yes" }, schema as any).ok).toBe(true);
    }

    const afterFill = __test_getCompileCount();
    expect(afterFill).toBeGreaterThan(1);

    const baseClone = JSON.parse(JSON.stringify(baseSchema));
    expect(validateClawdbotConfig({ ok: "yes" }, baseClone).ok).toBe(true);
    expect(__test_getCompileCount()).toBe(afterFill + 1);
  });
});
