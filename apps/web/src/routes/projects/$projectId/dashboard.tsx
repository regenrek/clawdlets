import { createFileRoute } from "@tanstack/react-router"
import type { Id } from "../../../../convex/_generated/dataModel"
import { ProjectDashboard } from "~/components/dashboard/project-dashboard"

export const Route = createFileRoute("/projects/$projectId/dashboard")({
  component: ProjectDashboardRoute,
})

function ProjectDashboardRoute() {
  const { projectId } = Route.useParams()
  return <ProjectDashboard projectId={projectId as Id<"projects">} />
}
