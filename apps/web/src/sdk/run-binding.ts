import type { Id } from "../../convex/_generated/dataModel"

export function assertRunBoundToProject(params: {
  runId: Id<"runs">
  runProjectId: Id<"projects">
  expectedProjectId: Id<"projects">
  runKind?: string
  expectedKind?: string
}): void {
  if (params.runProjectId !== params.expectedProjectId) {
    throw new Error(`runId does not belong to projectId (${params.runId})`)
  }
  if (params.expectedKind && params.runKind && params.runKind !== params.expectedKind) {
    throw new Error(`run kind mismatch (${params.runId})`)
  }
}

