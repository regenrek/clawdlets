import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { ConvexClient } from "~/server/convex"
import { getAdminProjectContext, type ProjectContext } from "~/sdk/repo-root"
import { assertRunBoundToProject } from "~/sdk/run-binding"

export async function requireAdminAndBoundRun(params: {
  client: ConvexClient
  projectId: Id<"projects">
  runId: Id<"runs">
  expectedKind: string
  requireRunning?: boolean
}): Promise<ProjectContext & { run: { kind: string; status: string } }> {
  const context = await getAdminProjectContext(params.client, params.projectId)
  const runGet = await params.client.query(api.runs.get, { runId: params.runId })

  assertRunBoundToProject({
    runId: params.runId,
    runProjectId: runGet.run.projectId as Id<"projects">,
    expectedProjectId: params.projectId,
    runKind: runGet.run.kind,
    expectedKind: params.expectedKind,
  })

  if (params.requireRunning !== false && runGet.run.status !== "running") {
    throw new Error("run not running")
  }

  return { ...context, run: { kind: runGet.run.kind, status: runGet.run.status } }
}

