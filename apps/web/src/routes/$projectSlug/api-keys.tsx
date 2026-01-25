import { createFileRoute } from "@tanstack/react-router"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import type { Id } from "../../../convex/_generated/dataModel"
import { useProjectBySlug } from "~/lib/project-data"

export const Route = createFileRoute("/$projectSlug/api-keys")({
  component: ProjectApiKeys,
})

function ProjectApiKeys() {
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">API Keys</h1>
        <p className="text-muted-foreground">
          Project-wide credentials and operator settings.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight">Project credentials</h2>
          <p className="text-sm text-muted-foreground">
            Operator tokens and deploy tooling settings used across the project.
          </p>
        </div>
        <DeployCredsCard projectId={projectQuery.projectId as Id<"projects">} />
      </div>
    </div>
  )
}
