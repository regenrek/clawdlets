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
import { useHostSelection } from "~/lib/host-selection"
import { getClawdletsConfig } from "~/sdk/config"
import { serverRestartExecute, serverRestartStart } from "~/sdk/server-ops"

export const Route = createFileRoute("/projects/$projectId/hosts/restart")({
  component: RestartOperate,
})

function RestartOperate() {
  const { projectId } = Route.useParams()
  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })
  const config = cfg.data?.config as any
  const hosts = useMemo(() => Object.keys(config?.hosts || {}).sort(), [config])
  const bots = useMemo(() => (config?.fleet?.botOrder || []) as string[], [config])

  const { host } = useHostSelection({
    hosts,
    defaultHost: config?.defaultHost || null,
  })

  const [unit, setUnit] = useState("clawdbot-*.service")
  const [targetHost, setTargetHost] = useState("")

  const expectedConfirm = `restart ${unit.trim() || "clawdbot-*.service"}`.trim()
  const [confirm, setConfirm] = useState("")

  const [runId, setRunId] = useState<Id<"runs"> | null>(null)
  const start = useMutation({
    mutationFn: async () =>
      await serverRestartStart({ data: { projectId: projectId as Id<"projects">, host, unit } }),
    onSuccess: (res) => {
      setRunId(res.runId)
      void serverRestartExecute({
        data: { projectId: projectId as Id<"projects">, runId: res.runId, host, unit, targetHost, confirm },
      })
      toast.info("Restart started")
    },
  })

  const canRestart = Boolean(host && confirm.trim() === expectedConfirm)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Restart</h1>
      <p className="text-muted-foreground">
        Restart services with typed confirmations and RBAC.
      </p>

      {cfg.isPending ? (
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
                <div className="text-xs text-muted-foreground">
                  Change the active host in the header.
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

            <div className="space-y-2">
              <Label>Target host override (optional)</Label>
              <Input value={targetHost} onChange={(e) => setTargetHost(e.target.value)} placeholder="admin@100.64.0.1" />
            </div>

            <div className="space-y-2">
              <Label>Type to confirm</Label>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={expectedConfirm} />
              <div className="text-xs text-muted-foreground">
                Expected: <code>{expectedConfirm}</code>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" disabled={start.isPending || !canRestart} onClick={() => start.mutate()}>
                Restart
              </Button>
              <div className="text-xs text-muted-foreground">
                Uses <code>--ssh-tty=false</code>.
              </div>
            </div>
          </div>

          {runId ? <RunLogTail runId={runId} /> : null}
        </div>
      )}
    </div>
  )
}
