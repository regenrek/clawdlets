import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Outlet, useRouter, useRouterState } from "@tanstack/react-router"
import type { Id } from "../../../../convex/_generated/dataModel"
import { Badge } from "~/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { useHostSelection } from "~/lib/host-selection"
import { cn } from "~/lib/utils"
import { getClawdletsConfig } from "~/sdk/config"

const hostTabs = [
  { value: "overview", label: "Overview" },
  { value: "agents", label: "Agents" },
  { value: "secrets", label: "Secrets" },
  { value: "bootstrap", label: "Bootstrap" },
  { value: "deploy", label: "Deploy" },
  { value: "logs", label: "Logs" },
  { value: "audit", label: "Audit" },
  { value: "restart", label: "Restart" },
  { value: "settings", label: "Settings" },
] as const

type HostTabValue = (typeof hostTabs)[number]["value"]

export const Route = createFileRoute("/projects/$projectId/hosts")({
  component: HostsLayout,
})

function HostsLayout() {
  const { projectId } = Route.useParams()
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const search = useRouterState({ select: (s) => s.location.search })
  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })
  const config = cfg.data?.config as any
  const hosts = React.useMemo(() => Object.keys(config?.hosts || {}).sort(), [config])
  const hostParam = React.useMemo(() => {
    const params = new URLSearchParams(search)
    return params.get("host")?.trim() || ""
  }, [search])
  const { host } = useHostSelection({
    hosts,
    defaultHost: config?.defaultHost || null,
    mode: hostParam ? "required" : "optional",
  })
  const hostCfg = host && config ? config.hosts[host] : null
  const enabled = hostCfg ? hostCfg.enable !== false : false

  const rawTab = React.useMemo(() => {
    const match = pathname.match(/\/hosts\/([^/]+)/)
    return (match?.[1] || "overview") as HostTabValue
  }, [pathname])

  const activeTab = hostTabs.some((tab) => tab.value === rawTab) ? rawTab : "overview"

  React.useEffect(() => {
    if (!hostParam && rawTab !== "overview") {
      void router.navigate({
        to: `/projects/${projectId}/hosts/overview`,
        replace: true,
        search: {},
      } as any)
      return
    }
    if (hostParam && rawTab !== activeTab) {
      void router.navigate({
        to: `/projects/${projectId}/hosts/${activeTab}`,
        replace: true,
        search: (prev: Record<string, unknown>) => prev,
      } as any)
    }
  }, [activeTab, hostParam, projectId, rawTab, router])

  return (
    <div className="space-y-6">
      {hostParam ? (
        <>
          <div className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "size-2.5 rounded-full",
                      enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
                    )}
                  />
                  <div className="text-lg font-semibold truncate">
                    {host || "No host selected"}
                  </div>
                  {hostCfg?.hetzner?.serverType ? (
                    <Badge variant="outline" className="uppercase">
                      {hostCfg.hetzner.serverType}
                    </Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {hostCfg?.targetHost ? `Target: ${hostCfg.targetHost}` : "No target host configured"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <div className="rounded-md border bg-muted/30 px-2 py-1">
                  Tailnet: {hostCfg?.tailnet?.mode || "—"}
                </div>
                <div className="rounded-md border bg-muted/30 px-2 py-1">
                  Exposure: {hostCfg?.sshExposure?.mode || "—"}
                </div>
                <div className="rounded-md border bg-muted/30 px-2 py-1">
                  Location: {hostCfg?.hetzner?.location || "—"}
                </div>
                <Badge variant={enabled ? "secondary" : "outline"}>
                  {enabled ? "enabled" : "disabled"}
                </Badge>
              </div>
            </div>
          </div>

          <div className="-mt-1 overflow-hidden border-b border-border/60 bg-background/90 backdrop-blur">
            <Tabs
              value={activeTab}
              className="gap-0"
              onValueChange={(next) => {
                void router.navigate({
                  to: `/projects/${projectId}/hosts/${next}`,
                  search: (prev: Record<string, unknown>) => prev,
                } as any)
              }}
            >
              <TabsList
                variant="line"
                className="h-10 w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto overflow-y-hidden px-0"
              >
                {hostTabs.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value} className="after:bottom-0">
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </>
      ) : null}
      <Outlet />
    </div>
  )
}
