import YAML from "yaml";

function quoteYamlString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"')}"`;
}

export function upsertYamlScalarLine(params: { text: string; key: string; value: string }): string {
  const { text, key, value } = params;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`^\\s*${escaped}\\s*:\\s*.*$`, "m");
  const line = `${key}: ${quoteYamlString(value)}`;
  if (rx.test(text)) return text.replace(rx, line);
  return `${text.trimEnd()}\n${line}\n`;
}

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
