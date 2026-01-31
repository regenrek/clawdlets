import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs"

const TABS = ["overview", "logs", "settings", "skills"] as const
type TabKey = (typeof TABS)[number]

function resolveTab(pathname: string): TabKey {
  const last = pathname.split("/").filter(Boolean).pop() || "overview"
  return TABS.includes(last as TabKey) ? (last as TabKey) : "overview"
}

export const Route = createFileRoute("/$projectSlug/hosts/$host/agents/$botId")({
  component: AgentDetailLayout,
})

function AgentDetailLayout() {
  const { projectSlug, host, botId } = Route.useParams()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const activeTab = resolveTab(pathname)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          <Link
            to="/$projectSlug/hosts/$host/agents"
            params={{ projectSlug, host }}
            className="hover:underline"
          >
            Agents
          </Link>{" "}
          / <code>{botId}</code>
        </div>
        <h1 className="text-2xl font-black tracking-tight">{botId}</h1>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const tab = TABS.includes(value as TabKey) ? (value as TabKey) : "overview"
          void navigate({
            to: "/$projectSlug/hosts/$host/agents/$botId/" + tab,
            params: { projectSlug, host, botId },
          })
        }}
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
        </TabsList>
      </Tabs>

      <Outlet />
    </div>
  )
}
