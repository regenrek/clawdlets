export function isAuthDisabled(): boolean {
  const raw = String(
    process.env["CLAWDLETS_AUTH_DISABLED"] ||
      process.env["VITE_CLAWDLETS_AUTH_DISABLED"] ||
      "",
  )
    .trim()
    .toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes"
}

export function assertAuthNotDisabledInProd(): void {
  if (process.env.NODE_ENV === "production" && isAuthDisabled()) {
    throw new Error("CLAWDLETS_AUTH_DISABLED is not allowed in production")
  }
}

