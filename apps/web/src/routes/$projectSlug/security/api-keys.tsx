import { createFileRoute } from "@tanstack/react-router"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useProjectBySlug } from "~/lib/project-data"
import { deployCredsQueryOptions, projectsListQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/$projectSlug/security/api-keys")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    await context.queryClient.ensureQueryData(deployCredsQueryOptions(projectId))
  },
  component: SecurityApiKeys,
})

function SecurityApiKeys() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)

  if (projectQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectQuery.projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }

  return <DeployCredsCard projectId={projectQuery.projectId as Id<"projects">} />
}

