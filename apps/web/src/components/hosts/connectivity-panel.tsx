import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { Badge } from "~/components/ui/badge"
import { Spinner } from "~/components/ui/spinner"
import { getHostPublicIpv4, probeHostTailscaleIpv4, probeSshReachability } from "~/sdk/host-connectivity"
import { configDotSet } from "~/sdk/config"

type ConnectivityPanelProps = {
  projectId: Id<"projects">
  host: string
  targetHost?: string
}

type ProbeState = {
  ok: boolean
  value?: string
  error?: string
}

export function ConnectivityPanel({ projectId, host, targetHost }: ConnectivityPanelProps) {
  const queryClient = useQueryClient()
  const [tailscaleProbe, setTailscaleProbe] = useState<ProbeState | null>(null)
  const [sshProbe, setSshProbe] = useState<ProbeState | null>(null)

  const publicIpv4Query = useQuery({
    queryKey: ["hostPublicIpv4", projectId, host],
    queryFn: async () => await getHostPublicIpv4({ data: { projectId, host } }),
    enabled: Boolean(projectId && host),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const publicIpv4 = publicIpv4Query.data?.ok ? publicIpv4Query.data.ipv4 : ""
  const publicIpv4Error = publicIpv4Query.data && !publicIpv4Query.data.ok ? publicIpv4Query.data.error : ""

  const setTargetHost = useMutation({
    mutationFn: async (value: string) =>
      await configDotSet({ data: { projectId, path: `hosts.${host}.targetHost`, value } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error("Config update failed")
        return
      }
      toast.success("targetHost updated")
      void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const tailscaleProbeRun = useMutation({
    mutationFn: async () => {
      if (!targetHost?.trim()) throw new Error("missing targetHost")
      return await probeHostTailscaleIpv4({ data: { projectId, host, targetHost } })
    },
    onSuccess: (res) => {
      if (res.ok) setTailscaleProbe({ ok: true, value: res.ipv4 })
      else setTailscaleProbe({ ok: false, error: res.error, value: res.raw })
    },
    onError: (err) => {
      setTailscaleProbe({ ok: false, error: err instanceof Error ? err.message : String(err) })
    },
  })

  const sshProbeRun = useMutation({
    mutationFn: async () => {
      if (!targetHost?.trim()) throw new Error("missing targetHost")
      return await probeSshReachability({ data: { projectId, host, targetHost } })
    },
    onSuccess: (res) => {
      if (res.ok) setSshProbe({ ok: true, value: res.hostname })
      else setSshProbe({ ok: false, error: res.error })
    },
    onError: (err) => {
      setSshProbe({ ok: false, error: err instanceof Error ? err.message : String(err) })
    },
  })

  const sshStatus = useMemo(() => {
    if (!sshProbe) return "unknown"
    return sshProbe.ok ? "reachable" : "unreachable"
  }, [sshProbe])

  const copyValue = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("Clipboard unavailable")
      return
    }
    try {
      await navigator.clipboard.writeText(trimmed)
      toast.success("Copied")
    } catch {
      toast.error("Copy failed")
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">Connectivity</div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">SSH</span>
          <Badge variant={sshStatus === "unreachable" ? "destructive" : "secondary"}>
            {sshStatus}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="text-xs text-muted-foreground">Public IPv4</div>
          {publicIpv4Query.isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3" />
              Loading…
            </div>
          ) : publicIpv4 ? (
            <div className="flex items-center justify-between gap-2">
              <code className="text-sm">{publicIpv4}</code>
              <div className="flex items-center gap-2">
                <Button type="button" size="xs" variant="ghost" onClick={() => void copyValue(publicIpv4)}>
                  Copy
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  onClick={() => setTargetHost.mutate(`admin@${publicIpv4}`)}
                >
                  Use for targetHost
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              {publicIpv4Error || "No IPv4 detected"}
            </div>
          )}
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={publicIpv4Query.isFetching}
            onClick={() => void publicIpv4Query.refetch()}
          >
            {publicIpv4Query.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="text-xs text-muted-foreground">Tailscale IPv4</div>
          {tailscaleProbe?.ok ? (
            <div className="flex items-center justify-between gap-2">
              <code className="text-sm">{tailscaleProbe.value}</code>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => void copyValue(tailscaleProbe.value || "")}
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  onClick={() => setTargetHost.mutate(`admin@${tailscaleProbe.value}`)}
                >
                  Use for targetHost
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              {tailscaleProbe?.error || "Not probed"}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={tailscaleProbeRun.isPending || !targetHost?.trim()}
              onClick={() => tailscaleProbeRun.mutate()}
            >
              {tailscaleProbeRun.isPending ? "Probing…" : "Probe tailscale"}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={sshProbeRun.isPending || !targetHost?.trim()}
              onClick={() => sshProbeRun.mutate()}
            >
              {sshProbeRun.isPending ? "Checking…" : "Check SSH"}
            </Button>
          </div>
          {!targetHost?.trim() ? (
            <div className="text-xs text-muted-foreground">Set targetHost to probe.</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
