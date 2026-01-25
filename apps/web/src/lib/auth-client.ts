import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

const baseURL = String((import.meta as any).env.VITE_SITE_URL || "").trim();

export const authClient = createAuthClient({
  ...(baseURL ? { baseURL } : {}),
  plugins: [convexClient()],
});

