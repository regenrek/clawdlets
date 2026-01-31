import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

function resolveBaseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return String((import.meta as any).env.VITE_SITE_URL || "").trim();
}

const baseURL = resolveBaseUrl();

export const authClient = createAuthClient({
  ...(baseURL ? { baseURL } : {}),
  plugins: [convexClient()],
});
