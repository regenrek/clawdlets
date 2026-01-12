import { needsSudo, requireTargetHost } from "../ssh-target.js";

export { needsSudo, requireTargetHost };

function quoteYamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function upsertYamlScalarLine(params: { text: string; key: string; value: string }): string {
  const { text, key, value } = params;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(`^\\s*${escaped}\\s*:\\s*.*$`, "m");
  const line = `${key}: ${quoteYamlString(value)}`;
  if (rx.test(text)) return text.replace(rx, line);
  return `${text.trimEnd()}\n${line}\n`;
}
