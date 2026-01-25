export function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as any;
  const code = e?.data?.code;
  if (code === "unauthorized") return true;
  const message = typeof e?.message === "string" ? e.message : "";
  return message.toLowerCase().includes("unauth");
}

