import { describe, expect, it } from "vitest";
import { classifyError, exitCodeFor } from "../src/lib/errors.js";

describe("clf cli errors", () => {
  it("classifies server errors by code", () => {
    expect(classifyError({ code: "ENOENT", message: "missing socket" }).kind).toBe("server");
    expect(classifyError({ code: "ECONNREFUSED", message: "refused" }).kind).toBe("server");
    expect(classifyError({ code: "EACCES", message: "denied" }).kind).toBe("server");
  });

  it("classifies unknown errors and maps exit codes", () => {
    expect(classifyError(new Error("nope")).kind).toBe("unknown");
    expect(exitCodeFor("user")).toBe(2);
    expect(exitCodeFor("server")).toBe(3);
    expect(exitCodeFor("job")).toBe(4);
    expect(exitCodeFor("unknown")).toBe(1);
  });
});
