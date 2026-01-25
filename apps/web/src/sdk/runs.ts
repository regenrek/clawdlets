import { createServerFn } from "@tanstack/react-start";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { createConvexClient } from "~/server/convex";
import { cancelActiveRun, runWithEvents } from "~/server/run-manager";
import { readClawdletsEnvTokens } from "~/server/redaction";

export const cancelRun = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input");
    const d = data as Record<string, unknown>;
    return { runId: d["runId"] as Id<"runs"> };
  })
  .handler(async ({ data }) => {
    const canceled = cancelActiveRun(data.runId);
    const client = createConvexClient();
    const { run, project } = await client.query(api.runs.get, { runId: data.runId });
    const redactTokens = await readClawdletsEnvTokens(project.localPath);

    await runWithEvents({
      client,
      runId: data.runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "warn", message: "Cancel requested." });
      },
    });
    await client.mutation(api.runs.setStatus, { runId: data.runId, status: "canceled" });
    return { canceled };
  });
