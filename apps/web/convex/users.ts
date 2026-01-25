import { query, mutation } from "./_generated/server";
import { requireAuthMutation, requireAuthQuery } from "./lib/auth";
import { UserDoc } from "./lib/validators";

export const getCurrent = query({
  args: {},
  returns: UserDoc,
  handler: async (ctx) => {
    const { user } = await requireAuthQuery(ctx);
    return user;
  },
});

export const ensureCurrent = mutation({
  args: {},
  returns: UserDoc,
  handler: async (ctx) => {
    const { user } = await requireAuthMutation(ctx);
    return user;
  },
});
