export function hasAuthEnv(): boolean {
  const siteUrl = String(process.env.SITE_URL || "").trim();
  const secret = String(process.env.BETTER_AUTH_SECRET || "").trim();
  const convexSiteUrl = String(process.env.CONVEX_SITE_URL || "").trim();
  return Boolean(siteUrl && secret && convexSiteUrl);
}
