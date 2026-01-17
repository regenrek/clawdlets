export type ClfCliErrorKind = "user" | "server" | "job" | "unknown";

export function classifyError(err: unknown): { kind: ClfCliErrorKind; message: string } {
  const e = err as { code?: string; message?: string };
  const msg = String(e?.message || err);
  const code = String(e?.code || "");

  if (code === "ENOENT" || code === "ECONNREFUSED" || code === "EACCES") return { kind: "server", message: msg };
  return { kind: "unknown", message: msg };
}

export function exitCodeFor(kind: ClfCliErrorKind): number {
  if (kind === "user") return 2;
  if (kind === "server") return 3;
  if (kind === "job") return 4;
  return 1;
}

