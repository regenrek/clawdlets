import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { RunLogTail } from "~/components/run-log-tail"
import { PageHeader } from "~/components/ui/page-header"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Switch } from "~/components/ui/switch"
import { Textarea } from "~/components/ui/textarea"
import { useProjectBySlug } from "~/lib/project-data"
import { getClawdletsConfig } from "~/sdk/config"
import { serverUpdateLogsExecute, serverUpdateLogsStart, serverUpdateStatusExecute, serverUpdateStatusStart } from "~/sdk/server-ops"

export const Route = createFileRoute("/$projectSlug/hosts/$host/updates")({
  component: UpdatesOperate,
})

function UpdatesOperate() {
  const { projectSlug, host } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
    enabled: Boolean(projectId),
  })
  const config = cfg.data?.config as any

  const [targetHost, setTargetHost] = useState("")

  const [statusRunId, setStatusRunId] = useState<Id<"runs"> | null>(null)
  const [statusResult, setStatusResult] = useState<any>(null)
  const statusStart = useMutation({
    mutationFn: async () =>
      await serverUpdateStatusStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setStatusRunId(res.runId)
      void serverUpdateStatusExecute({
        data: { projectId: projectId as Id<"projects">, runId: res.runId, host, targetHost },
      }).then((r) => setStatusResult(r))
      toast.info("Fetching updater status…")
    },
  })

  const [logsRunId, setLogsRunId] = useState<Id<"runs"> | null>(null)
  const [lines, setLines] = useState("200")
  const [since, setSince] = useState("")
  const [follow, setFollow] = useState(false)
  const logsStart = useMutation({
    mutationFn: async () =>
      await serverUpdateLogsStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setLogsRunId(res.runId)
      void serverUpdateLogsExecute({
        data: {
          projectId: projectId as Id<"projects">,
          runId: res.runId,
          host,
          lines,
          since,
          follow,
          targetHost,
        },
      })
      toast.info(follow ? "Following updater logs…" : "Fetching updater logs…")
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Updates"
        description="Signed desired-state updater status and logs."
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
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Host</Label>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{host}</div>
              </div>
              <div className="space-y-2">
                <Label>Target host override (optional)</Label>
                <Input
                  value={targetHost}
                  onChange={(e) => setTargetHost(e.target.value)}
                  placeholder="admin@100.64.0.1"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={statusStart.isPending || !host}
                onClick={() => statusStart.mutate()}
              >
                Updater status
              </Button>
              <Button
                type="button"
                disabled={logsStart.isPending || !host}
                onClick={() => logsStart.mutate()}
              >
                {follow ? "Follow logs" : "Fetch logs"}
              </Button>
              <div className="text-xs text-muted-foreground">
                Uses <code>--ssh-tty=false</code>.
              </div>
            </div>
          </div>

          {statusResult?.result ? (
            <div className="rounded-lg border bg-card p-6 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Updater status</div>
              </div>
              <Textarea readOnly className="font-mono min-h-[220px]" value={JSON.stringify(statusResult.result, null, 2)} />
            </div>
          ) : null}

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="font-medium">Updater logs</div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Lines</Label>
                <Input value={lines} onChange={(e) => setLines(e.target.value)} placeholder="200" />
              </div>
              <div className="space-y-2">
                <Label>Since (optional)</Label>
                <Input value={since} onChange={(e) => setSince(e.target.value)} placeholder="1h / 5m / 2d" />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Follow</div>
                  <div className="text-xs text-muted-foreground">Streams logs until you cancel.</div>
                </div>
                <Switch checked={follow} onCheckedChange={setFollow} />
              </div>
            </div>
          </div>

          {statusRunId ? <RunLogTail runId={statusRunId} /> : null}
          {logsRunId ? <RunLogTail runId={logsRunId} /> : null}
        </div>
      )}
    </div>
  )
}

