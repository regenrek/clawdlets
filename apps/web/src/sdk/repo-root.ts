import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { ConvexClient } from "~/server/convex"
import { assertRepoRootPath } from "~/server/paths"

export type ProjectContext = {
  project: { localPath: string }
  role: "admin" | "viewer"
  repoRoot: string
}

type RepoRootOptions = {
  allowMissing?: boolean
  requireRepoLayout?: boolean
}

export async function getProjectContext(
  client: ConvexClient,
  projectId: Id<"projects">,
  options: RepoRootOptions = {},
): Promise<ProjectContext> {
  const result = await client.query(api.projects.get, { projectId })
  const repoRoot = assertRepoRootPath(result.project.localPath, {
    allowMissing: options.allowMissing === true,
    requireRepoLayout: options.requireRepoLayout === true,
  })
  return { ...result, repoRoot }
}

export async function getRepoRoot(
  client: ConvexClient,
  projectId: Id<"projects">,
): Promise<string> {
  const { repoRoot } = await getProjectContext(client, projectId, {
    allowMissing: false,
    requireRepoLayout: true,
  })
  return repoRoot
}

export async function getAdminProjectContext(
  client: ConvexClient,
  projectId: Id<"projects">,
  options: RepoRootOptions = {},
): Promise<ProjectContext> {
  const context = await getProjectContext(client, projectId, options)
  if (context.role !== "admin") throw new Error("admin required")
  return context
}
