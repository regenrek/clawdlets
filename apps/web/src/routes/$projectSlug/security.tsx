"use client"

import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { projectsListQueryOptions } from "~/lib/query-options"

const TABS = ["api-keys", "ssh-keys", "cache"] as const
type TabKey = (typeof TABS)[number]

function resolveTab(pathname: string): TabKey {
  const last = pathname.split("/").filter(Boolean).pop() || "api-keys"
  return TABS.includes(last as TabKey) ? (last as TabKey) : "api-keys"
}

export const Route = createFileRoute("/$projectSlug/security")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(projectsListQueryOptions())
  },
  component: ProjectSecurityLayout,
})

function ProjectSecurityLayout() {
  const { projectSlug } = Route.useParams()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const activeTab = resolveTab(pathname)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-black tracking-tight">Security</h1>
        <p className="text-muted-foreground">Project-wide credentials, SSH keys, and Nix cache policy.</p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const tab = TABS.includes(value as TabKey) ? (value as TabKey) : "api-keys"
          void navigate({
            to: "/$projectSlug/security/" + tab,
            params: { projectSlug },
          })
        }}
      >
        <TabsList>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="ssh-keys">SSH Keys</TabsTrigger>
          <TabsTrigger value="cache">Nix Cache</TabsTrigger>
        </TabsList>
      </Tabs>

      <Outlet />
    </div>
  )
}
