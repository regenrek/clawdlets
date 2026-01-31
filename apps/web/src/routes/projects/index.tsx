import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon } from "@hugeicons/core-free-icons"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useConvexAuth } from "convex/react"
import { Button } from "~/components/ui/button"
import { ProjectsTable } from "~/components/dashboard/projects-table"
import { getDashboardOverview } from "~/sdk/dashboard"
import { slugifyProjectName, storeLastProjectSlug } from "~/lib/project-routing"
import { authClient } from "~/lib/auth-client"

export const Route = createFileRoute("/projects/")({
  component: ProjectsIndex,
})

function ProjectsIndex() {
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const canQuery = Boolean(session?.user?.id) && isAuthenticated && !isPending && !isLoading
  const overview = useQuery({
    queryKey: ["dashboardOverview"],
    queryFn: async () => await getDashboardOverview({ data: {} }),
    gcTime: 5_000,
    enabled: canQuery,
  })
  const projects = overview.data?.projects ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1">
            Local infra repos managed by Clawdlets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/projects/import" />}
          >
            Import
          </Button>
          <Button
            nativeButton={false}
            render={<Link to="/projects/new" />}
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            New
          </Button>
        </div>
      </div>

      {overview.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : overview.error ? (
        <div className="text-sm text-destructive">{String(overview.error)}</div>
      ) : projects.length > 0 ? (
        <ProjectsTable
          projects={projects}
          selectedProjectId={null}
          onSelectProjectId={(projectId) => {
            const selected = projects.find((project) => project.projectId === projectId)
            if (!selected) return
            const projectSlug = slugifyProjectName(selected.name)
            storeLastProjectSlug(projectSlug)
            void router.navigate({
              to: "/$projectSlug",
              params: { projectSlug },
            })
          }}
        />
      ) : (
        <div className="border rounded-lg p-6 bg-card">
          <div className="font-medium">No projects yet</div>
          <div className="text-muted-foreground text-sm mt-1">
            Create your first project to configure and deploy a fleet.
          </div>
          <div className="mt-4">
            <Button
              nativeButton={false}
              render={<Link to="/projects/new" />}
            >
              Create Project
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
