export function isAuthDisabled(): boolean {
  const raw = String(process.env["CLAWDLETS_AUTH_DISABLED"] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function assertAuthNotDisabledInProd(): void {
  if (!isAuthDisabled()) return;
  const deployment = String(process.env.CONVEX_DEPLOYMENT || "").trim();
  const isDev = !deployment || deployment.startsWith("dev:");
  if (!isDev) {
    throw new Error("CLAWDLETS_AUTH_DISABLED is not allowed in non-dev Convex deployments");
  }
}
