import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { ConvexClient } from "~/server/convex"

export async function getRepoRoot(
  client: ConvexClient,
  projectId: Id<"projects">,
): Promise<string> {
  const { project } = await client.query(api.projects.get, { projectId })
  return project.localPath
}
