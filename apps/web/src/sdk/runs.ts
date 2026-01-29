import { createServerFn } from "@tanstack/react-start";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { createConvexClient } from "~/server/convex";
import { cancelActiveRun, runWithEvents } from "~/server/run-manager";
import { readClawdletsEnvTokens } from "~/server/redaction";
import { assertRepoRootPath } from "~/server/paths";

export const cancelRun = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input");
    const d = data as Record<string, unknown>;
    return { runId: d["runId"] as Id<"runs"> };
  })
  .handler(async ({ data }) => {
    const client = createConvexClient();
    const { run, project, role } = await client.query(api.runs.get, { runId: data.runId });
    if (role !== "admin") throw new Error("admin required");
    if (run.status === "succeeded" || run.status === "failed" || run.status === "canceled") {
      return { canceled: false };
    }
    const repoRoot = assertRepoRootPath(project.localPath, { allowMissing: false, requireRepoLayout: true });
    const redactTokens = await readClawdletsEnvTokens(repoRoot);

    const canceled = cancelActiveRun(data.runId);
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
