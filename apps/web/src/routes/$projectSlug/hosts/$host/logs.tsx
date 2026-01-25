import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { RunLogTail } from "~/components/run-log-tail"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { Switch } from "~/components/ui/switch"
import { useProjectBySlug } from "~/lib/project-data"
import { getClawdletsConfig } from "~/sdk/config"
import { serverLogsExecute, serverLogsStart } from "~/sdk/server-ops"

export const Route = createFileRoute("/$projectSlug/hosts/$host/logs")({
  component: LogsOperate,
})

function LogsOperate() {
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
  const bots = useMemo(() => (config?.fleet?.botOrder || []) as string[], [config])

  const [unit, setUnit] = useState("clawdbot-*.service")
  const [lines, setLines] = useState("200")
  const [since, setSince] = useState("")
  const [follow, setFollow] = useState(false)
  const [targetHost, setTargetHost] = useState("")

  const [runId, setRunId] = useState<Id<"runs"> | null>(null)
  const start = useMutation({
    mutationFn: async () =>
      await serverLogsStart({ data: { projectId: projectId as Id<"projects">, host, unit } }),
    onSuccess: (res) => {
      setRunId(res.runId)
      void serverLogsExecute({
        data: {
          projectId: projectId as Id<"projects">,
          runId: res.runId,
          host,
          unit,
          lines,
          since,
          follow,
          targetHost,
        },
      })
      toast.info("Logs started")
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Logs</h1>
      <p className="text-muted-foreground">
        Browse logs per unit with filters and follow mode.
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
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Host</Label>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {host || "No hosts configured"}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <NativeSelect value={unit} onChange={(e) => setUnit(e.target.value)}>
                  <NativeSelectOption value="clawdbot-*.service">clawdbot-*.service</NativeSelectOption>
                  {bots.map((b) => (
                    <NativeSelectOption key={b} value={`clawdbot-${b}.service`}>
                      clawdbot-{b}.service
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>

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
                  <div className="text-xs text-muted-foreground">
                    Streams logs until you cancel.
                  </div>
                </div>
                <Switch checked={follow} onCheckedChange={setFollow} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Target host override (optional)</Label>
              <Input value={targetHost} onChange={(e) => setTargetHost(e.target.value)} placeholder="admin@100.64.0.1" />
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" disabled={start.isPending || !host} onClick={() => start.mutate()}>
                {follow ? "Start following" : "Fetch logs"}
              </Button>
              <div className="text-xs text-muted-foreground">
                Uses <code>--ssh-tty=false</code>. Ensure passwordless sudo if required.
              </div>
            </div>
          </div>

          {runId ? <RunLogTail runId={runId} /> : null}
        </div>
      )}
    </div>
  )
}
