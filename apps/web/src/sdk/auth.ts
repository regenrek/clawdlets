import { createServerFn } from "@tanstack/react-start";
import { assertAuthEnv } from "~/server/env";

export const getAuthBootstrap = createServerFn({ method: "GET" }).handler(async () => {
  assertAuthEnv();

  const { getToken } = await import("~/server/better-auth");
  const token = await getToken();
  return { token: token ?? null };
});
