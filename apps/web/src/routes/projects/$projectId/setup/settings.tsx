import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { api } from "../../../../../convex/_generated/api"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"

export const Route = createFileRoute("/projects/$projectId/setup/settings")({
  component: ProjectSettings,
})

function ProjectSettings() {
  const { projectId } = Route.useParams()
  const project = useQuery({
    ...convexQuery(api.projects.get, { projectId: projectId as Id<"projects"> }),
    gcTime: 5_000,
  })

  const p = project.data?.project

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Project Settings</h1>
        <p className="text-muted-foreground">
          Project-level metadata and entry points to host configuration.
        </p>
      </div>

      {project.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : project.error ? (
        <div className="text-sm text-destructive">{String(project.error)}</div>
      ) : !p ? (
        <div className="text-muted-foreground">Project not found.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Project</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="font-medium">{p.name}</div>
              <div className="text-muted-foreground">{p.localPath}</div>
              <div className="text-muted-foreground">Status: {p.status}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Quick links</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" nativeButton={false} render={<Link to="/projects/$projectId/setup/fleet" params={{ projectId }} />}>
                Fleet
              </Button>
              <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/projects/$projectId/setup/doctor" params={{ projectId }} />}>
                Doctor
              </Button>
              <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/projects/$projectId/hosts/overview" params={{ projectId }} />}>
                Hosts
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
