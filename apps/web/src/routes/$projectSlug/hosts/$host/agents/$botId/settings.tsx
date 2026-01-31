import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useConvexAuth } from "convex/react"
import type { Id } from "../../../../../../../convex/_generated/dataModel"
import { BotCapabilities } from "~/components/fleet/bot-capabilities"
import { BotClawdbotEditor } from "~/components/fleet/bot-clawdbot-editor"
import { BotIntegrations } from "~/components/fleet/bot-integrations"
import { BotWorkspaceDocs } from "~/components/fleet/bot-workspace-docs"
import { authClient } from "~/lib/auth-client"
import { useProjectBySlug } from "~/lib/project-data"
import { clawdletsConfigQueryOptions, projectGetQueryOptions, projectsListQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/$projectSlug/hosts/$host/agents/$botId/settings")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    await context.queryClient.ensureQueryData(projectGetQueryOptions(projectId as Id<"projects">))
    await context.queryClient.ensureQueryData(clawdletsConfigQueryOptions(projectId))
  },
  component: AgentSettings,
})

function AgentSettings() {
  const { projectSlug, host, botId } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const { data: session, isPending } = authClient.useSession()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const canQuery = Boolean(session?.user?.id) && isAuthenticated && !isPending && !isLoading

  const project = useQuery({
    ...projectGetQueryOptions(projectId as Id<"projects">),
    enabled: Boolean(projectId) && canQuery,
  })
  const canEdit = project.data?.role === "admin"

  const cfg = useQuery({
    ...clawdletsConfigQueryOptions(projectId as Id<"projects"> | null),
    enabled: Boolean(projectId) && canQuery,
  })

  const config = cfg.data?.config
  const botCfg = config?.fleet?.bots?.[botId] as any
  const clawdbotCfg = botCfg?.clawdbot ?? {}
  const profile = botCfg?.profile ?? {}
  const fleetSecretEnv = (config?.fleet as any)?.secretEnv

  if (projectQuery.isPending) return <div className="text-muted-foreground">Loading…</div>
  if (projectQuery.error) return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  if (!projectId) return <div className="text-muted-foreground">Project not found.</div>
  if (cfg.isPending) return <div className="text-muted-foreground">Loading…</div>
  if (cfg.error) return <div className="text-sm text-destructive">{String(cfg.error)}</div>
  if (!config) return <div className="text-muted-foreground">Missing config.</div>
  if (!botCfg) return <div className="text-muted-foreground">Agent not found.</div>

  return (
    <div className="space-y-6">
      <BotCapabilities
        projectId={projectId}
        botId={botId}
        host={host}
        clawdbot={clawdbotCfg}
        canEdit={canEdit}
      />

      <BotIntegrations
        projectId={projectId}
        botId={botId}
        host={host}
        clawdbot={clawdbotCfg}
        profile={profile}
        fleetSecretEnv={fleetSecretEnv}
        canEdit={canEdit}
      />

      <BotWorkspaceDocs projectId={projectId} botId={botId} canEdit={canEdit} />

      <BotClawdbotEditor
        projectId={projectId}
        botId={botId}
        host={host}
        initial={clawdbotCfg}
        canEdit={canEdit}
      />
    </div>
  )
}
