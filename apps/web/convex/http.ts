import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { hasAuthEnv } from "./lib/env";

const http = httpRouter();

if (!hasAuthEnv()) {
  throw new Error("missing SITE_URL / BETTER_AUTH_SECRET / CONVEX_SITE_URL for Better Auth");
}
authComponent.registerRoutes(http, createAuth);

export default http;
