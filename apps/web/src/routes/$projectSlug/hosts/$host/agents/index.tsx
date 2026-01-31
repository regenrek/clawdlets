import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { api } from "../../../../../../convex/_generated/api"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { useProjectBySlug } from "~/lib/project-data"
import { BotRoster } from "~/components/fleet/bot-roster"
import { getClawdletsConfig, addBot } from "~/sdk/config"

export const Route = createFileRoute("/$projectSlug/hosts/$host/agents/")({
  component: AgentsSetup,
})

function AgentsSetup() {
  const { projectSlug, host } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const queryClient = useQueryClient()

  const project = useQuery({
    ...convexQuery(api.projects.get, { projectId: projectId as Id<"projects"> }),
    gcTime: 5_000,
    enabled: Boolean(projectId),
  })
  const canEdit = project.data?.role === "admin"

  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
    enabled: Boolean(projectId),
  })
  const config = cfg.data?.config
  const bots = useMemo(() => (config?.fleet?.botOrder as string[]) || [], [config])

  const [newBot, setNewBot] = useState("")
  const addBotMutation = useMutation({
    mutationFn: async () => await addBot({ data: { projectId: projectId as Id<"projects">, bot: newBot } }),
    onSuccess: () => {
      toast.success("Agent added")
      setNewBot("")
      void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Agents</h1>
      <p className="text-muted-foreground">
        Add/remove agents and configure per-agent settings.
      </p>

      {projectQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : projectQuery.error ? (
        <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
      ) : !projectId ? (
        <div className="text-muted-foreground">Project not found.</div>
      ) : cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-3">
            <div className="font-medium">Add agent</div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <LabelWithHelp htmlFor="newBot" help={setupFieldHelp.bots.botId}>
                  Agent id
                </LabelWithHelp>
                <Input
                  id="newBot"
                  value={newBot}
                  onChange={(e) => setNewBot(e.target.value)}
                  placeholder="maren"
                  disabled={!canEdit}
                />
              </div>
              <Button
                type="button"
                disabled={!canEdit || addBotMutation.isPending || !newBot.trim()}
                onClick={() => addBotMutation.mutate()}
              >
                Add
              </Button>
            </div>
              <div className="text-xs text-muted-foreground">
                Stored in <code>fleet.botOrder</code> and <code>fleet.bots</code>.
              </div>
            {!canEdit ? (
              <div className="text-xs text-muted-foreground">
                Read-only: project role <code>{project.data?.role || "…"}</code>.
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Agent roster</div>
                <div className="text-xs text-muted-foreground">{bots.length} agents</div>
              </div>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    to="/$projectSlug/hosts/$host/secrets"
                    params={{ projectSlug, host }}
                  />
                }
              >
                Secrets
              </Button>
            </div>

            <BotRoster
              projectSlug={projectSlug}
              host={host}
              projectId={projectId}
              bots={bots}
              config={config}
              canEdit={canEdit}
            />
          </div>
        </div>
      )}
    </div>
  )
}
