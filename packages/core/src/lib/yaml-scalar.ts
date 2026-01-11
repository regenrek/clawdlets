import YAML from "yaml";

export function readYamlScalarFromMapping(params: { yamlText: string; key: string }): string | null {
  const key = String(params.key || "").trim();
  if (!key) return null;

  let parsed: unknown;
  try {
    parsed = YAML.parse(String(params.yamlText ?? ""));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(parsed, key)) return null;

  const value = (parsed as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "";
  return null;
}

