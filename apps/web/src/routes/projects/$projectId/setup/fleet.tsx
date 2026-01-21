import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { HelpTooltip, LabelWithHelp } from "~/components/ui/label-help"
import { Switch } from "~/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { Textarea } from "~/components/ui/textarea"
import { setupFieldHelp } from "~/lib/setup-field-help"
import {
  configDotGet,
  configDotSet,
  getClawdletsConfig,
  writeClawdletsConfigFile,
} from "~/sdk/config"

export const Route = createFileRoute("/projects/$projectId/setup/fleet")({
  component: FleetSetup,
})

function FleetSetup() {
  const { projectId } = Route.useParams()
  const queryClient = useQueryClient()

  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })

  const config = cfg.data?.config
  const repoRoot = cfg.data?.repoRoot

  const [codexEnable, setCodexEnable] = useState(false)
  const [resticEnable, setResticEnable] = useState(false)
  const [resticRepo, setResticRepo] = useState("")

  const [jsonText, setJsonText] = useState("")

  useEffect(() => {
    if (!config) return
    setCodexEnable(Boolean(config.fleet.codex?.enable))
    setResticEnable(Boolean(config.fleet.backups?.restic?.enable))
    setResticRepo(config.fleet.backups?.restic?.repository || "")
    setJsonText(JSON.stringify(config, null, 2))
  }, [config])

  const saveVisual = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("config not loaded")
      const next = {
        ...config,
        fleet: {
          ...config.fleet,
          codex: { ...config.fleet.codex, enable: codexEnable },
          backups: {
            ...config.fleet.backups,
            restic: {
              ...config.fleet.backups.restic,
              enable: resticEnable,
              repository: resticRepo.trim(),
            },
          },
        },
      }
      return await writeClawdletsConfigFile({
        data: {
          projectId: projectId as Id<"projects">,
          next,
          title: "Update fleet settings",
        },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else {
        toast.error("Validation failed")
      }
    },
  })

  const saveJson = useMutation({
    mutationFn: async () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(jsonText)
      } catch {
        return { ok: false as const, issues: [{ code: "json", path: [], message: "Invalid JSON" }] }
      }
      return await writeClawdletsConfigFile({
        data: { projectId: projectId as Id<"projects">, next: parsed, title: "Update config (JSON)" },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else {
        toast.error("Validation failed")
      }
    },
  })

  const [dotPath, setDotPath] = useState("fleet.codex.enable")
  const [dotValueJson, setDotValueJson] = useState("")
  const [dotValue, setDotValue] = useState("")
  const [dotResult, setDotResult] = useState<null | { path: string; value: unknown }>(null)

  const dotGet = useMutation({
    mutationFn: async () =>
      await configDotGet({
        data: { projectId: projectId as Id<"projects">, path: dotPath },
      }),
    onSuccess: (res) => setDotResult(res),
  })

  const dotSet = useMutation({
    mutationFn: async (del: boolean) =>
      await configDotSet({
        data: {
          projectId: projectId as Id<"projects">,
          path: dotPath,
          value: dotValue || undefined,
          valueJson: dotValueJson || undefined,
          del,
        },
      }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Updated")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else toast.error("Validation failed")
    },
  })

  const lastIssues = useMemo(() => {
    const r = (saveVisual.data && !saveVisual.data.ok ? saveVisual.data : null) ||
      (saveJson.data && !saveJson.data.ok ? saveJson.data : null) ||
      (dotSet.data && !dotSet.data.ok ? dotSet.data : null)
    return r?.issues ?? null
  }, [saveJson.data, saveVisual.data, dotSet.data])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Fleet</h1>
      <p className="text-muted-foreground">
        Configure `fleet/clawdlets.json` for <span className="font-medium">{projectId}</span>.
      </p>

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <Tabs defaultValue="visual" className="w-full">
          <TabsList>
            <TabsTrigger value="visual">Visual</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
            <TabsTrigger value="dot">Dot-path</TabsTrigger>
          </TabsList>

          <TabsContent value="visual">
            <div className="rounded-lg border bg-card p-6 space-y-6">
              <div className="text-xs text-muted-foreground">
                {repoRoot ? repoRoot : ""} · fleet/clawdlets.json
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithHelp>Codex</LabelWithHelp>
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 text-sm font-medium">
                        <span>Enable Codex</span>
                        <HelpTooltip title="Enable Codex" side="top">
                          {setupFieldHelp.fleet.codexEnable}
                        </HelpTooltip>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Stored as <code>fleet.codex.enable</code>.
                      </div>
                    </div>
                    <Switch checked={codexEnable} onCheckedChange={setCodexEnable} />
                  </div>
                </div>

                <div className="space-y-2">
                  <LabelWithHelp>Backups (restic)</LabelWithHelp>
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 text-sm font-medium">
                        <span>Enable restic</span>
                        <HelpTooltip title="Enable restic" side="top">
                          {setupFieldHelp.fleet.resticEnable}
                        </HelpTooltip>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Stored as <code>fleet.backups.restic.enable</code>.
                      </div>
                    </div>
                    <Switch checked={resticEnable} onCheckedChange={setResticEnable} />
                  </div>
                  <div className="mt-3 space-y-2">
                    <LabelWithHelp htmlFor="resticRepo" help={setupFieldHelp.fleet.resticRepo}>
                      Repository
                    </LabelWithHelp>
                    <Input
                      id="resticRepo"
                      value={resticRepo}
                      disabled={!resticEnable}
                      onChange={(e) => setResticRepo(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {lastIssues ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <div className="font-medium">Validation errors</div>
                  <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                    {lastIssues.slice(0, 20).map((i) => (
                      <li key={`${i.code}:${i.path.join(".")}:${i.message}`}>
                        {i.path.length ? i.path.join(".") : "(root)"}: {i.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                <Button type="button" disabled={saveVisual.isPending} onClick={() => saveVisual.mutate()}>
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={cfg.isPending}
                  onClick={() => void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })}
                >
                  Reload
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="json">
            <div className="rounded-lg border bg-card p-6 space-y-4">
              <div className="text-xs text-muted-foreground">Edit full config. Saved atomically.</div>
              <LabelWithHelp htmlFor="configJson" help={setupFieldHelp.fleet.jsonEditor}>
                Config JSON
              </LabelWithHelp>
              <Textarea
                id="configJson"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                className="font-mono min-h-[360px]"
              />
              {lastIssues ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <div className="font-medium">Validation errors</div>
                  <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                    {lastIssues.slice(0, 20).map((i) => (
                      <li key={`${i.code}:${i.path.join(".")}:${i.message}`}>
                        {i.path.length ? i.path.join(".") : "(root)"}: {i.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <Button type="button" disabled={saveJson.isPending} onClick={() => saveJson.mutate()}>
                  Save JSON
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(jsonText)
                      setJsonText(`${JSON.stringify(parsed, null, 2)}\n`)
                    } catch {
                      toast.error("Invalid JSON")
                    }
                  }}
                >
                  Format
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="dot">
            <div className="rounded-lg border bg-card p-6 space-y-4">
              <div className="text-xs text-muted-foreground">
                Mirrors <code>clawdlets config get/set</code>.
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithHelp htmlFor="dotPath" help={setupFieldHelp.fleet.dotPath}>
                    Path
                  </LabelWithHelp>
                  <Input id="dotPath" value={dotPath} onChange={(e) => setDotPath(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <LabelWithHelp htmlFor="dotValue" help={setupFieldHelp.fleet.dotValue}>
                    Value (string)
                  </LabelWithHelp>
                  <Input id="dotValue" value={dotValue} onChange={(e) => setDotValue(e.target.value)} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <LabelWithHelp htmlFor="dotJson" help={setupFieldHelp.fleet.dotValueJson}>
                    Value (JSON)
                  </LabelWithHelp>
                  <Textarea
                    id="dotJson"
                    value={dotValueJson}
                    onChange={(e) => setDotValueJson(e.target.value)}
                    className="font-mono min-h-[120px]"
                    placeholder='{"example":true}'
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" disabled={dotGet.isPending} onClick={() => dotGet.mutate()}>
                  Get
                </Button>
                <Button type="button" disabled={dotSet.isPending} onClick={() => dotSet.mutate(false)}>
                  Set
                </Button>
                <Button type="button" variant="destructive" disabled={dotSet.isPending} onClick={() => dotSet.mutate(true)}>
                  Delete
                </Button>
              </div>
              {dotResult ? (
                <pre className="rounded-md bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words">
                  {JSON.stringify(dotResult, null, 2)}
                </pre>
              ) : null}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
