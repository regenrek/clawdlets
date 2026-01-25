import { createServerFn } from "@tanstack/react-start";
import { assertAuthNotDisabledInProd, isAuthDisabled } from "~/server/env";

export const getAuthBootstrap = createServerFn({ method: "GET" }).handler(async () => {
  assertAuthNotDisabledInProd();

  const authDisabled = isAuthDisabled();
  if (authDisabled) return { authDisabled: true as const, token: null as string | null };

  const { getToken } = await import("~/server/better-auth");
  const token = await getToken();
  return { authDisabled: false as const, token: token ?? null };
});

