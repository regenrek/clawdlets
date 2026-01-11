import { describe, it, expect } from "vitest";

describe("yaml scalar", () => {
  it("reads quoted scalars", async () => {
    const { readYamlScalarFromMapping } = await import("../src/lib/yaml-scalar");
    expect(readYamlScalarFromMapping({ yamlText: 'token: "abc"\n', key: "token" })).toBe("abc");
  });

  it("reads unquoted scalars", async () => {
    const { readYamlScalarFromMapping } = await import("../src/lib/yaml-scalar");
    expect(readYamlScalarFromMapping({ yamlText: "token: abc\n", key: "token" })).toBe("abc");
  });

  it("reads block scalars", async () => {
    const { readYamlScalarFromMapping } = await import("../src/lib/yaml-scalar");
    const v = readYamlScalarFromMapping({ yamlText: "token: |\n  hello\n  world\n", key: "token" });
    expect(v).toContain("hello");
    expect(v).toContain("world");
  });

  it("returns null for missing key", async () => {
    const { readYamlScalarFromMapping } = await import("../src/lib/yaml-scalar");
    expect(readYamlScalarFromMapping({ yamlText: "a: b\n", key: "token" })).toBe(null);
  });

  it("returns null for non-mapping YAML", async () => {
    const { readYamlScalarFromMapping } = await import("../src/lib/yaml-scalar");
    expect(readYamlScalarFromMapping({ yamlText: "- a\n- b\n", key: "token" })).toBe(null);
  });

  it("returns null for non-scalar values", async () => {
    const { readYamlScalarFromMapping } = await import("../src/lib/yaml-scalar");
    expect(readYamlScalarFromMapping({ yamlText: "token:\n  nested: true\n", key: "token" })).toBe(null);
  });
});

