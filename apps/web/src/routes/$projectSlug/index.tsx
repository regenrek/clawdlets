import { createFileRoute } from "@tanstack/react-router"
import type { Id } from "../../../convex/_generated/dataModel"
import { ProjectDashboard } from "~/components/dashboard/project-dashboard"
import { useProjectBySlug } from "~/lib/project-data"
import { projectsListQueryOptions } from "~/lib/query-options"

export const Route = createFileRoute("/$projectSlug/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(projectsListQueryOptions())
  },
  component: ProjectDashboardRoute,
})

function ProjectDashboardRoute() {
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
  return (
    <ProjectDashboard
      projectId={projectQuery.projectId as Id<"projects">}
      projectSlug={projectSlug}
    />
  )
}
