import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useRouter } from "@tanstack/react-router"
import * as React from "react"
import { toast } from "sonner"
import { useConvexAuth } from "convex/react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { getDashboardOverview } from "~/sdk/dashboard"
import { migrateClawdletsConfigFileToV11 } from "~/sdk/config-migrate"
import { Badge } from "~/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"
import { Button } from "~/components/ui/button"
import { KpiCard } from "~/components/dashboard/kpi-card"
import { RecentRunsTable, type RunRow } from "~/components/dashboard/recent-runs-table"
import { RunActivityChart } from "~/components/dashboard/run-activity-chart"
import { formatShortDateTime, projectStatusBadgeVariant } from "~/components/dashboard/dashboard-utils"
import { authClient } from "~/lib/auth-client"

function isMigratableConfigError(message: string): boolean {
  const m = message.toLowerCase()
  if (m.includes("schemaversion")) return true
  if (m.includes("was removed; use")) return true
  if (m.includes("legacy host config key")) return true
  return false
}

export function ProjectDashboard(props: {
  projectId: Id<"projects">
  projectSlug: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const convexQueryClient = router.options.context.convexQueryClient
  const { data: session, isPending } = authClient.useSession()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const canQuery = Boolean(session?.user?.id) && isAuthenticated && !isPending && !isLoading

  const overview = useQuery({
    queryKey: ["dashboardOverview"],
    queryFn: async () => await getDashboardOverview({ data: {} }),
    gcTime: 5_000,
    enabled: canQuery,
  })

  const project = React.useMemo(() => {
    return overview.data?.projects.find((p) => p.projectId === props.projectId) ?? null
  }, [overview.data?.projects, props.projectId])

  const recentRuns = useQuery({
    queryKey: ["dashboardRecentRuns", project?.projectId ?? null],
    enabled: Boolean(project?.projectId) && canQuery,
    queryFn: async () => {
      const args = {
        projectId: project!.projectId as Id<"projects">,
        paginationOpts: { numItems: 200, cursor: null as string | null },
      }
      if (convexQueryClient.serverHttpClient) {
        return await convexQueryClient.serverHttpClient.consistentQuery(api.runs.listByProjectPage, args)
      }
      return await convexQueryClient.convexClient.query(api.runs.listByProjectPage, args)
    },
    gcTime: 5_000,
  })

  const runs = (recentRuns.data?.page ?? []) as RunRow[]

  const projectAccess = useQuery({
    ...convexQuery(api.projects.get, {
      projectId: props.projectId,
    }),
    gcTime: 5_000,
    enabled: canQuery,
  })

  const canWrite = projectAccess.data?.role === "admin"
  const canMigrate = Boolean(project?.cfg.error && isMigratableConfigError(project.cfg.error))

  const migrate = useMutation({
    mutationFn: async () => {
      if (!project) throw new Error("project not loaded")
      return await migrateClawdletsConfigFileToV11({ data: { projectId: project.projectId } })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(res.changed ? "Migrated config" : "Config already schemaVersion 11")
        void queryClient.invalidateQueries({ queryKey: ["dashboardOverview"] })
        void queryClient.invalidateQueries({
          queryKey: ["dashboardRecentRuns", project?.projectId ?? null],
        })
      } else {
        const first = res.issues?.[0]
        toast.error(first?.message ? `Migration failed: ${first.message}` : "Migration failed")
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  if (overview.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }

  if (overview.error) {
    return <div className="text-sm text-destructive">{String(overview.error)}</div>
  }

  if (!project) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Project not found</CardTitle>
          <CardDescription>Pick a different project from the list.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            nativeButton={false}
            render={<Link to="/projects" />}
          >
            Back to projects
          </Button>
        </CardFooter>
      </Card>
    )
  }

  const botsValue = project.cfg.error ? "—" : project.cfg.botsTotal.toLocaleString()
  const hostsValue = project.cfg.error
    ? "—"
    : `${project.cfg.hostsEnabled.toLocaleString()} / ${project.cfg.hostsTotal.toLocaleString()}`
  const defaultHost = project.cfg.error ? "—" : project.cfg.defaultHost || "—"
  const defaultHostName = project.cfg.error ? "" : project.cfg.defaultHost || ""
  const defaultHostBase = defaultHostName
    ? `/${props.projectSlug}/hosts/${encodeURIComponent(defaultHostName)}`
    : `/${props.projectSlug}/hosts`
  const canLinkToDefaultHost = Boolean(defaultHostName && props.projectSlug)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight truncate">{project.name}</h1>
            <Badge variant={projectStatusBadgeVariant(project.status)} className="capitalize">
              {project.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm truncate">{project.localPath}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/projects" />}
          >
            Projects
          </Button>
          <Button
            nativeButton={false}
            render={
              <Link
                to="/$projectSlug/setup/fleet"
                params={{ projectSlug: props.projectSlug }}
              />
            }
          >
            Skills
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link to={defaultHostBase} />
            }
          >
            Deploy
          </Button>
        </div>
      </div>

      <div className="grid auto-rows-min gap-4 md:grid-cols-3">
        <KpiCard title="Bots" value={botsValue} subtext="Configured" />
        <KpiCard title="Hosts" value={hostsValue} subtext="Enabled / total" />
        <KpiCard title="Default host" value={defaultHost} subtext="From config" />
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
            <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:!py-0">
              <CardTitle>Activity</CardTitle>
              <CardDescription>Runs for the last 14 days.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2 sm:p-6">
            <RunActivityChart runs={runs} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Project health</CardTitle>
            <CardDescription>Config, services, and status checks.</CardDescription>
          </CardHeader>
          <CardContent>
            {project.cfg.error ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <div className="font-medium">Config load failed</div>
                <div className="text-muted-foreground mt-1 break-words">
                  {project.cfg.error}
                </div>
                {canMigrate ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={!canWrite || migrate.isPending}
                      onClick={() => migrate.mutate()}
                    >
                      Migrate to schemaVersion 11
                    </Button>
                    <div className="text-muted-foreground text-xs">
                      CLI: <code>clawdlets config migrate --to v11</code>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-muted-foreground text-sm">Hosts</div>
                  <div className="font-medium tabular-nums">{hostsValue}</div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-muted-foreground text-sm">Codex</div>
                  <div className="font-medium">{project.cfg.codexEnabled ? "On" : "Off"}</div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-muted-foreground text-sm">Restic</div>
                  <div className="font-medium">{project.cfg.resticEnabled ? "On" : "Off"}</div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-muted-foreground text-sm">Config updated</div>
                  <div className="font-medium">
                    {project.cfg.configMtimeMs ? formatShortDateTime(project.cfg.configMtimeMs) : "—"}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="gap-2">
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              disabled={!canLinkToDefaultHost}
              render={
                <Link
                  to="/$projectSlug/hosts/$host/logs"
                  params={{ projectSlug: props.projectSlug, host: defaultHostName }}
                />
              }
            >
              Logs
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              disabled={!canLinkToDefaultHost}
              render={
                <Link
                  to="/$projectSlug/hosts/$host/audit"
                  params={{ projectSlug: props.projectSlug, host: defaultHostName }}
                />
              }
            >
              Audit
            </Button>
          </CardFooter>
        </Card>
      </div>

      <RecentRunsTable
        runs={runs}
        projectSlug={props.projectSlug}
      />
    </div>
  )
}
