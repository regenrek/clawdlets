import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from "convex/server";

import { isAuthDisabled } from "./env";

export type ConvexClient = {
  query: <Query extends FunctionReference<"query">>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ) => Promise<FunctionReturnType<Query>>;
  mutation: <Mutation extends FunctionReference<"mutation">>(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation>>;
  action: <Action extends FunctionReference<"action">>(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ) => Promise<FunctionReturnType<Action>>;
};

function getConvexUrl(): string {
  const url = String(process.env["VITE_CONVEX_URL"] || process.env["CONVEX_URL"] || "").trim();
  if (!url) throw new Error("missing VITE_CONVEX_URL");
  return url;
}

function createAuthDisabledClient(): ConvexHttpClient {
  return new ConvexHttpClient(getConvexUrl(), { skipConvexDeploymentUrlCheck: true });
}

export function createConvexClient(): ConvexClient {
  if (isAuthDisabled()) return createAuthDisabledClient();

  return {
    query: async (query, ...args) => {
      const { fetchAuthQuery } = await import("~/server/better-auth");
      return await fetchAuthQuery(query, ...args);
    },
    mutation: async (mutation, ...args) => {
      const { fetchAuthMutation } = await import("~/server/better-auth");
      return await fetchAuthMutation(mutation, ...args);
    },
    action: async (action, ...args) => {
      const { fetchAuthAction } = await import("~/server/better-auth");
      return await fetchAuthAction(action, ...args);
    },
  };
}

