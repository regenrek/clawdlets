import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import type { Id } from "../../../convex/_generated/dataModel"
import { AppHeader } from "~/components/layout/app-header"
import { AppSidebar } from "~/components/layout/app-sidebar"
import { Button } from "~/components/ui/button"
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar"
import { useProjectBySlug } from "~/lib/project-data"
import { buildHostPath, parseHostName, parseProjectSlug } from "~/lib/project-routing"
import { getClawdletsConfig } from "~/sdk/config"

type OpenHost = {
  name: string
  mode: "bootstrap" | "public"
}

function formatOpenHostLabel(hosts: OpenHost[]) {
  const names = hosts.map((host) => host.name)
  if (names.length <= 2) return names.join(", ")
  return `${names[0]}, ${names[1]} +${names.length - 2} more`
}

function formatOpenHostModes(hosts: OpenHost[]) {
  const modes = Array.from(new Set(hosts.map((host) => host.mode)))
  if (modes.length === 0) return "bootstrap"
  if (modes.length === 1) return modes[0]
  return "bootstrap/public"
}

function OpenSshExposureBanner() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const projectSlug = parseProjectSlug(pathname)
  const activeHost = parseHostName(pathname)
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId

  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    enabled: Boolean(projectId),
    queryFn: async () =>
      await getClawdletsConfig({
        data: { projectId: projectId as Id<"projects"> },
      }),
  })

  const config = cfg.data?.config as any
  const openHosts = React.useMemo<OpenHost[]>(() => {
    if (!config || !config.hosts || typeof config.hosts !== "object") return []
    return Object.entries(config.hosts).flatMap(([name, hostCfg]) => {
      if (!hostCfg || typeof hostCfg !== "object") return []
      if ((hostCfg as any).enable === false) return []
      const mode = (hostCfg as any).sshExposure?.mode
      if (mode === "bootstrap" || mode === "public") return [{ name, mode }]
      return []
    })
  }, [config])

  if (!projectSlug || !projectId || openHosts.length === 0) return null

  const targetHost = openHosts.find((host) => host.name === activeHost)?.name ?? openHosts[0]?.name
  const hostLabel = formatOpenHostLabel(openHosts)
  const modeLabel = formatOpenHostModes(openHosts)
  const verb = openHosts.length === 1 ? "is" : "are"
  const bootstrapPath = targetHost ? `${buildHostPath(projectSlug, targetHost)}/bootstrap` : ""
  const settingsPath = targetHost ? `${buildHostPath(projectSlug, targetHost)}/settings` : ""

  return (
    <div className="border-b border-destructive/40 bg-destructive/10 text-destructive">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-2 px-4 py-2 text-sm sm:px-6">
        <span className="font-semibold">Public SSH exposure detected.</span>
        <span className="text-destructive/90">
          {hostLabel} {verb} in {modeLabel} mode.
        </span>
        <span className="text-destructive/80">
          Complete the post-bootstrap checklist to switch SSH to tailnet and lock down public access.
        </span>
        {bootstrapPath ? (
          <Button
            size="sm"
            variant="destructive"
            nativeButton={false}
            render={<Link to={bootstrapPath} hash="lockdown" />}
          >
            Open checklist
          </Button>
        ) : null}
        {settingsPath ? (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link to={settingsPath} />}
          >
            Host settings
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function AppShell({
  children,
  showSidebar = true,
}: {
  children: React.ReactNode
  showSidebar?: boolean
}) {
  return (
    <SidebarProvider>
      {showSidebar ? <AppSidebar /> : null}
      <SidebarInset>
        <div className="min-h-svh flex flex-col">
          <AppHeader showSidebarToggle={showSidebar} />
          <OpenSshExposureBanner />
          <main className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
              {children}
            </div>
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export { AppShell }
