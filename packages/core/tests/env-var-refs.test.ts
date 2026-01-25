import { describe, expect, it } from "vitest";

describe("env var refs", () => {
  it("finds ${ENV} refs across nested objects and arrays", async () => {
    const { findEnvVarRefs } = await import("../src/lib/env-var-refs");

    const refs = findEnvVarRefs({
      a: "${A}",
      b: ["x", "${B}", { c: "prefix-${C}-suffix" }],
      d: { e: "nope", f: 123, g: null, h: ["${A}", "${C}"] },
    });

    expect(refs.vars).toEqual(["A", "B", "C"]);
    expect(refs.pathsByVar.A).toEqual(["a", "d.h[0]"]);
    expect(refs.pathsByVar.B).toEqual(["b[1]"]);
    expect(refs.pathsByVar.C).toEqual(["b[2].c", "d.h[1]"]);
  });

  it("ignores invalid env var names and missing braces", async () => {
    const { findEnvVarRefs } = await import("../src/lib/env-var-refs");

    const refs = findEnvVarRefs({
      ok: "${OK_1}",
      badLower: "${bad}",
      badDash: "${BAD-DASH}",
      missingClose: "${MISSING",
      empty: "${}",
    });

    expect(refs.vars).toEqual(["OK_1"]);
    expect(refs.pathsByVar.OK_1).toEqual(["ok"]);
  });

  it("treats $${ENV} as an escaped literal (no ref)", async () => {
    const { findEnvVarRefs } = await import("../src/lib/env-var-refs");

    const refs = findEnvVarRefs({
      escaped: "$${SHOULD_NOT_MATCH}",
      real: "${SHOULD_MATCH}",
      mix: "a$${ESCAPED}b${REAL}c",
    });

    expect(refs.vars).toEqual(["REAL", "SHOULD_MATCH"]);
    expect(refs.pathsByVar.REAL).toEqual(["mix"]);
    expect(refs.pathsByVar.SHOULD_MATCH).toEqual(["real"]);
  });
});

