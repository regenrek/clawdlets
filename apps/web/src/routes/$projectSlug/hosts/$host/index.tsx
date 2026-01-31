import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { useMemo } from "react"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import { KpiCard } from "~/components/dashboard/kpi-card"
import { RecentRunsTable, type RunRow } from "~/components/dashboard/recent-runs-table"
import { RunActivityChart } from "~/components/dashboard/run-activity-chart"
import { useProjectBySlug } from "~/lib/project-data"
import { api } from "../../../../../convex/_generated/api"
import { clawdletsConfigQueryOptions, projectsListQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/$projectSlug/hosts/$host/")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    await context.queryClient.ensureQueryData(clawdletsConfigQueryOptions(projectId))
  },
  component: HostOverview,
})

function HostOverview() {
  const { projectSlug, host } = Route.useParams()
  const router = useRouter()
  const convexQueryClient = router.options.context.convexQueryClient
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId

  const cfg = useQuery({
    ...clawdletsConfigQueryOptions(projectId as Id<"projects"> | null),
    enabled: Boolean(projectId),
  })

  const config = cfg.data?.config as any
  const hostCfg = host && config ? (config.hosts as any)?.[host] : null

  const recentRuns = useQuery({
    queryKey: ["dashboardRecentRuns", projectId, host],
    enabled: Boolean(projectId && host),
    queryFn: async () => {
      const args = {
        projectId: projectId as Id<"projects">,
        paginationOpts: { numItems: 200, cursor: null as string | null },
      }
      if (convexQueryClient.serverHttpClient) {
        return await convexQueryClient.serverHttpClient.consistentQuery(api.runs.listByProjectPage, args)
      }
      return await convexQueryClient.convexClient.query(api.runs.listByProjectPage, args)
    },
  })
  const runs = (recentRuns.data?.page ?? []) as RunRow[]

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
      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-black tracking-tight truncate">{host || "Host"}</h1>
                <Badge variant={hostCfg?.enable !== false ? "secondary" : "outline"} className="capitalize">
                  {hostCfg?.enable !== false ? "enabled" : "disabled"}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm truncate">
                {hostCfg?.targetHost ? `Target: ${hostCfg.targetHost}` : "No target host configured"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/$projectSlug/hosts/$host/deploy" params={{ projectSlug, host }} />}
              >
                Deploy
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/$projectSlug/hosts/$host/updates" params={{ projectSlug, host }} />}
              >
                Updates
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/$projectSlug/hosts/$host/logs" params={{ projectSlug, host }} />}
              >
                Logs
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/$projectSlug/hosts/$host/audit" params={{ projectSlug, host }} />}
              >
                Audit
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/$projectSlug/hosts/$host/restart" params={{ projectSlug, host }} />}
              >
                Restart
              </Button>
              <Button
                size="sm"
                nativeButton={false}
                render={<Link to="/$projectSlug/hosts/$host/settings" params={{ projectSlug, host }} />}
              >
                Settings
              </Button>
            </div>
          </div>

          {!hostCfg ? (
            <div className="text-muted-foreground">Select a host from the list.</div>
          ) : (
            <>
              <div className="grid auto-rows-min gap-4 md:grid-cols-3">
                <KpiCard title="Status" value={hostCfg.enable !== false ? "Enabled" : "Disabled"} subtext="Host state" />
                <KpiCard title="Location" value={hostCfg.hetzner?.location || "—"} subtext="Hetzner region" />
                <KpiCard title="Server type" value={hostCfg.hetzner?.serverType || "—"} subtext="Compute profile" />
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
                    <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:!py-0">
                      <CardTitle>Activity</CardTitle>
                      <CardDescription>Runs for the last 14 days.</CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="px-2 sm:p-6">
                    {recentRuns.isPending ? (
                      <div className="text-muted-foreground text-sm">Loading…</div>
                    ) : recentRuns.error ? (
                      <div className="text-sm text-destructive">{String(recentRuns.error)}</div>
                    ) : (
                      <RunActivityChart runs={runs} />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Host details</CardTitle>
                    <CardDescription>Network and provisioning defaults.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Target host</span>
                      <span className="font-medium truncate">{hostCfg.targetHost || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Tailnet</span>
                      <span className="font-medium">{hostCfg.tailnet?.mode || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">SSH exposure</span>
                      <span className="font-medium">{hostCfg.sshExposure?.mode || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Disk device</span>
                      <span className="font-medium">{hostCfg.diskDevice || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Admin CIDR</span>
                      <span className="font-medium">{hostCfg.provisioning?.adminCidr || "—"}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>Recent runs</CardTitle>
                    <CardDescription>Latest activity for this project.</CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link to="/$projectSlug/runs" params={{ projectSlug }} />}
                  >
                    View all
                  </Button>
                </CardHeader>
                <CardContent>
                  {recentRuns.isPending ? (
                    <div className="text-muted-foreground text-sm">Loading…</div>
                  ) : recentRuns.error ? (
                    <div className="text-sm text-destructive">{String(recentRuns.error)}</div>
                  ) : runs.length === 0 ? (
                    <div className="text-muted-foreground text-sm">No runs yet.</div>
                  ) : (
                    <RecentRunsTable
                      runs={runs.slice(0, 8)}
                      projectSlug={projectSlug}
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  )
}
