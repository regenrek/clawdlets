import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { useConvexAuth } from "convex/react"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog"
import { PageHeader } from "~/components/ui/page-header"
import { StackedField } from "~/components/ui/stacked-field"
import { useProjectBySlug } from "~/lib/project-data"
import { BotRoster } from "~/components/fleet/bot-roster"
import { addBot } from "~/sdk/config"
import { authClient } from "~/lib/auth-client"
import { clawdletsConfigQueryOptions, projectGetQueryOptions, projectsListQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/$projectSlug/hosts/$host/agents/")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    await context.queryClient.ensureQueryData(projectGetQueryOptions(projectId as Id<"projects">))
    await context.queryClient.ensureQueryData(clawdletsConfigQueryOptions(projectId))
  },
  component: AgentsSetup,
})

const SAFE_BOT_ID_RE = /^[a-z][a-z0-9_-]*$/

function slugifyBotId(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")

  if (!cleaned) return "agent"
  if (/^[a-z]/.test(cleaned)) return cleaned
  return `agent-${cleaned}`
}

function suggestUniqueBotId(params: { displayName: string; taken: Set<string> }): string {
  const base = slugifyBotId(params.displayName || "agent")
  if (!params.taken.has(base)) return base
  for (let i = 2; i < 1_000; i++) {
    const candidate = `${base}-${i}`
    if (!params.taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

function AgentsSetup() {
  const { projectSlug, host } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const queryClient = useQueryClient()
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
  const bots = useMemo(() => (config?.fleet?.botOrder as string[]) || [], [config])

  const takenIds = useMemo(() => new Set(bots.map((b) => String(b || "").trim()).filter(Boolean)), [bots])

  const [addOpen, setAddOpen] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [botIdOverride, setBotIdOverride] = useState("")
  const [botIdOverrideEnabled, setBotIdOverrideEnabled] = useState(false)

  const suggestedBotId = useMemo(
    () => suggestUniqueBotId({ displayName, taken: takenIds }),
    [displayName, takenIds],
  )
  const effectiveBotId = (botIdOverrideEnabled ? botIdOverride : suggestedBotId).trim()

  const addBotMutation = useMutation({
    mutationFn: async (bot: string) =>
      await addBot({ data: { projectId: projectId as Id<"projects">, bot } }),
    onSuccess: () => {
      toast.success("Agent added")
      setAddOpen(false)
      setDisplayName("")
      setBotIdOverride("")
      setBotIdOverrideEnabled(false)
      void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const addAgentDialog = (
    <Dialog
      open={addOpen}
      onOpenChange={(next) => {
        setAddOpen(next)
        if (!next) {
          setDisplayName("")
          setBotIdOverride("")
          setBotIdOverrideEnabled(false)
        }
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" disabled={!canEdit}>
            Add agent
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add agent</DialogTitle>
          <DialogDescription>
            Pick a display name. We'll generate a safe id you can override in advanced options.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <StackedField id="agentDisplayName" label="Display name">
            <Input
              id="agentDisplayName"
              placeholder="OpenClaw"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
            />
          </StackedField>

          <Accordion className="rounded-lg border bg-muted/20">
            <AccordionItem value="advanced" className="px-4">
              <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 hover:no-underline">
                Advanced options
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="space-y-3">
                  <StackedField
                    id="agentId"
                    label="Agent id"
                    description="Used in config paths and as a stable identifier. Allowed: [a-z][a-z0-9_-]*."
                  >
                    <Input
                      id="agentId"
                      placeholder="openclaw"
                      value={botIdOverrideEnabled ? botIdOverride : suggestedBotId}
                      onChange={(e) => {
                        setBotIdOverrideEnabled(true)
                        setBotIdOverride(e.target.value)
                      }}
                    />
                  </StackedField>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button
            type="button"
            disabled={
              !canEdit ||
              addBotMutation.isPending ||
              !effectiveBotId ||
              !SAFE_BOT_ID_RE.test(effectiveBotId) ||
              takenIds.has(effectiveBotId)
            }
            onClick={() => {
              if (!effectiveBotId) return
              if (!SAFE_BOT_ID_RE.test(effectiveBotId)) {
                toast.error("Invalid agent id (use [a-z][a-z0-9_-]*)")
                return
              }
              if (takenIds.has(effectiveBotId)) {
                toast.error("That agent id already exists")
                return
              }
              addBotMutation.mutate(effectiveBotId)
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Add/remove agents and configure per-agent settings."
        actions={addAgentDialog}
      />

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
      )}
    </div>
  )
}
