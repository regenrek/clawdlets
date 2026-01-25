import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";

import { isAuthError } from "~/lib/auth-utils";
import { assertAuthNotDisabledInProd } from "./env";

function getConvexUrl(): string {
  const url = String(process.env["VITE_CONVEX_URL"] || process.env["CONVEX_URL"] || "").trim();
  if (!url) throw new Error("missing VITE_CONVEX_URL");
  return url;
}

function getConvexSiteUrl(): string {
  const url = String(
    process.env["VITE_CONVEX_SITE_URL"] || process.env["CONVEX_SITE_URL"] || "",
  ).trim();
  if (!url) {
    throw new Error(
      "missing VITE_CONVEX_SITE_URL (must be your Convex Site URL ending in .convex.site)",
    );
  }
  return url;
}

assertAuthNotDisabledInProd();

const start = convexBetterAuthReactStart({
  convexUrl: getConvexUrl(),
  convexSiteUrl: getConvexSiteUrl(),
  jwtCache: { enabled: true, isAuthError },
});

export const getToken = start.getToken;
export const handler = start.handler;
export const fetchAuthQuery = start.fetchAuthQuery;
export const fetchAuthMutation = start.fetchAuthMutation;
export const fetchAuthAction = start.fetchAuthAction;

