export function formatTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const widths: number[] = [];
  for (const r of rows) {
    for (let i = 0; i < r.length; i++) {
      widths[i] = Math.max(widths[i] || 0, String(r[i] ?? "").length);
    }
  }
  return rows
    .map((r) => r.map((c, i) => String(c ?? "").padEnd(widths[i] || 0)).join("  ").trimEnd())
    .join("\n");
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

