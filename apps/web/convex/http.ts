import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { isAuthDisabled } from "./lib/env";

const http = httpRouter();

if (!isAuthDisabled()) {
  authComponent.registerRoutes(http, createAuth);
}

export default http;
