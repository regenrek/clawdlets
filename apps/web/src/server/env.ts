export function hasAuthEnv(): boolean {
  const siteUrl = String(process.env["SITE_URL"] || "").trim()
  const secret = String(process.env["BETTER_AUTH_SECRET"] || "").trim()
  const convexUrl = String(process.env["VITE_CONVEX_URL"] || process.env["CONVEX_URL"] || "").trim()
  const convexSiteUrl = String(
    process.env["VITE_CONVEX_SITE_URL"] || process.env["CONVEX_SITE_URL"] || "",
  ).trim()
  return Boolean(siteUrl && secret && convexUrl && convexSiteUrl)
}

export function assertAuthEnv(): void {
  if (hasAuthEnv()) return
  throw new Error("missing SITE_URL, BETTER_AUTH_SECRET, VITE_CONVEX_URL, VITE_CONVEX_SITE_URL")
}
