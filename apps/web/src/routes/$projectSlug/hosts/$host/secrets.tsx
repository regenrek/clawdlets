import { createFileRoute } from "@tanstack/react-router"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { HostSecretsPanel } from "~/components/secrets/host-secrets-panel"
import { useProjectBySlug } from "~/lib/project-data"

export const Route = createFileRoute("/$projectSlug/hosts/$host/secrets")({
  component: HostSecrets,
})

function HostSecrets() {
  const { projectSlug, host } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId

  if (projectQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }

  return (
    <div className="space-y-6">
      <HostSecretsPanel projectId={projectId as Id<"projects">} host={host} />
    </div>
  )
}
