import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute, useRouter, useRouterState } from "@tanstack/react-router"
import { useMemo } from "react"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import { KpiCard } from "~/components/dashboard/kpi-card"
import { RecentRunsTable, type RunRow } from "~/components/dashboard/recent-runs-table"
import { RunActivityChart } from "~/components/dashboard/run-activity-chart"
import { useHostSelection } from "~/lib/host-selection"
import { getClawdletsConfig } from "~/sdk/config"
import { api } from "../../../../../convex/_generated/api"

export const Route = createFileRoute("/projects/$projectId/hosts/overview")({
  component: HostsOverview,
})

function HostsOverview() {
  const { projectId } = Route.useParams()
  const router = useRouter()
  const convexQueryClient = router.options.context.convexQueryClient
  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })
  const search = useRouterState({ select: (s) => s.location.search })
  const hostParam = useMemo(() => {
    const params = new URLSearchParams(search)
    return params.get("host")?.trim() || ""
  }, [search])

  const config = cfg.data?.config as any
  const hosts = useMemo(() => Object.keys(config?.hosts || {}).sort(), [config])
  const enabledHosts = useMemo(
    () => hosts.filter((h) => Boolean((config?.hosts as any)?.[h]?.enable)).length,
    [config, hosts],
  )
  const { host } = useHostSelection({
    hosts,
    defaultHost: config?.defaultHost || null,
    mode: hostParam ? "required" : "optional",
  })
  const hostCfg = host && config ? (config.hosts as any)?.[host] : null
  const recentRuns = useQuery({
    queryKey: ["dashboardRecentRuns", projectId, hostParam],
    enabled: Boolean(projectId && hostParam),
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
    gcTime: 5_000,
  })
  const runs = (recentRuns.data?.page ?? []) as RunRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Hosts Overview</h1>
        <p className="text-muted-foreground">
          Fleet host summary, status, and defaults.
        </p>
      </div>

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : hostParam ? (
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
                render={<Link to="/projects/$projectId/hosts/deploy" params={{ projectId }} search={{ host }} />}
              >
                Deploy
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/projects/$projectId/hosts/logs" params={{ projectId }} search={{ host }} />}
              >
                Logs
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/projects/$projectId/hosts/audit" params={{ projectId }} search={{ host }} />}
              >
                Audit
              </Button>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/projects/$projectId/hosts/restart" params={{ projectId }} search={{ host }} />}
              >
                Restart
              </Button>
              <Button
                size="sm"
                nativeButton={false}
                render={<Link to="/projects/$projectId/hosts/settings" params={{ projectId }} search={{ host }} />}
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
                    render={<Link to="/projects/$projectId/runs" params={{ projectId }} />}
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
                    <RecentRunsTable runs={runs.slice(0, 8)} projectId={projectId as Id<"projects">} />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Default host</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {config.defaultHost || "—"}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Hosts</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {hosts.length}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Enabled</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {enabledHosts}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3">
            {hosts.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">
                  No hosts configured yet.
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-xl border bg-card">
                <div className="grid grid-cols-12 gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
                  <div className="col-span-5">Name</div>
                  <div className="col-span-4">Public/Target</div>
                  <div className="col-span-2">Location</div>
                  <div className="col-span-1 text-right">Status</div>
                </div>
                <div className="divide-y">
                  {hosts.map((host) => {
                    const hostCfg = (config?.hosts as any)?.[host] || {}
                    const enabled = hostCfg?.enable !== false
                    const location = hostCfg?.hetzner?.location || "—"
                    const target = hostCfg?.targetHost || "—"
                    return (
                      <Link
                        key={host}
                        to="/projects/$projectId/hosts/overview"
                        params={{ projectId }}
                        search={{ host }}
                        className="grid grid-cols-12 items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                      >
                        <div className="col-span-5 flex items-center gap-2 min-w-0">
                          <span className={enabled ? "size-2 rounded-full bg-emerald-500" : "size-2 rounded-full bg-muted-foreground/40"} />
                          <div className="font-medium truncate">{host}</div>
                          {config.defaultHost === host ? (
                            <Badge variant="secondary" className="shrink-0">default</Badge>
                          ) : null}
                        </div>
                        <div className="col-span-4 text-sm text-muted-foreground truncate">
                          {target}
                        </div>
                        <div className="col-span-2 text-sm text-muted-foreground truncate">
                          {location}
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Badge variant={enabled ? "secondary" : "outline"}>
                            {enabled ? "enabled" : "disabled"}
                          </Badge>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
