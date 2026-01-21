import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { Switch } from "~/components/ui/switch"
import { Textarea } from "~/components/ui/textarea"
import { getDeployCredsStatus, updateDeployCreds } from "~/sdk/deploy-creds"

export const Route = createFileRoute("/projects/$projectId/setup/settings")({
  component: ProjectSettings,
})

function ProjectSettings() {
  const { projectId } = Route.useParams()

  const creds = useQuery({
    queryKey: ["deployCreds", projectId],
    queryFn: async () =>
      await getDeployCredsStatus({ data: { projectId: projectId as Id<"projects"> } }),
  })

  const byKey = useMemo(() => {
    const out: Record<string, any> = {}
    for (const k of creds.data?.keys || []) out[k.key] = k
    return out
  }, [creds.data?.keys])

  const [hcloudToken, setHcloudToken] = useState("")
  const [githubToken, setGithubToken] = useState("")
  const [clearHcloudToken, setClearHcloudToken] = useState(false)
  const [clearGithubToken, setClearGithubToken] = useState(false)
  const [nixBin, setNixBin] = useState("nix")
  const [sopsAgeKeyFile, setSopsAgeKeyFile] = useState("")

  useEffect(() => {
    if (!creds.data) return
    const nix = byKey["NIX_BIN"]?.value
    const sops = byKey["SOPS_AGE_KEY_FILE"]?.value
    setNixBin(String(nix || "nix"))
    setSopsAgeKeyFile(String(sops || ""))
  }, [byKey, creds.data])

  const save = useMutation({
    mutationFn: async () => {
      return await updateDeployCreds({
        data: {
          projectId: projectId as Id<"projects">,
          updates: {
            ...(clearHcloudToken ? { HCLOUD_TOKEN: "" } : hcloudToken.trim() ? { HCLOUD_TOKEN: hcloudToken.trim() } : {}),
            ...(clearGithubToken ? { GITHUB_TOKEN: "" } : githubToken.trim() ? { GITHUB_TOKEN: githubToken.trim() } : {}),
            NIX_BIN: nixBin.trim(),
            SOPS_AGE_KEY_FILE: sopsAgeKeyFile.trim(),
          },
        },
      })
    },
    onSuccess: async () => {
      toast.success("Saved")
      setHcloudToken("")
      setGithubToken("")
      setClearHcloudToken(false)
      setClearGithubToken(false)
      await creds.refetch()
    },
    onError: (err) => {
      toast.error(String(err))
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Project Settings</h1>
      <p className="text-muted-foreground">
        Local-only operator settings. Stored in <code>.clawdlets/env</code> (never committed).
      </p>

      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">Deploy credentials</div>
            <div className="text-xs text-muted-foreground">
              Used by bootstrap/infra/doctor. Secrets are never shown after saving.
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={creds.isFetching}
            onClick={() => void creds.refetch()}
          >
            Refresh
          </Button>
        </div>

        {creds.isPending ? (
          <div className="text-muted-foreground text-sm">Loading…</div>
        ) : creds.error ? (
          <div className="text-sm text-destructive">{String(creds.error)}</div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm">
              Env file:{" "}
              {creds.data?.envFile ? (
                <>
                  <code>{creds.data.envFile.path}</code>{" "}
                  <span className="text-muted-foreground">
                    ({creds.data.envFile.status})
                    {creds.data.envFile.error ? ` · ${creds.data.envFile.error}` : ""}
                  </span>
                </>
              ) : (
                <>
                  <code>{creds.data?.defaultEnvPath}</code>{" "}
                  <span className="text-muted-foreground">(missing)</span>
                </>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithHelp htmlFor="hcloudToken" help="Hetzner Cloud API token (HCLOUD_TOKEN).">
                  Hetzner API token
                </LabelWithHelp>
                <Input
                  id="hcloudToken"
                  type="password"
                  value={hcloudToken}
                  onChange={(e) => setHcloudToken(e.target.value)}
                  placeholder={byKey["HCLOUD_TOKEN"]?.status === "set" ? "(leave blank to keep existing)" : "(required)"}
                />
                <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    Status: <span className={byKey["HCLOUD_TOKEN"]?.status === "set" ? "text-emerald-600" : "text-destructive"}>{byKey["HCLOUD_TOKEN"]?.status || "unset"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground">Clear</div>
                    <Switch checked={clearHcloudToken} onCheckedChange={setClearHcloudToken} />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <LabelWithHelp htmlFor="githubToken" help="GitHub token (GITHUB_TOKEN).">
                  GitHub token
                </LabelWithHelp>
                <Input
                  id="githubToken"
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder={byKey["GITHUB_TOKEN"]?.status === "set" ? "(leave blank to keep existing)" : "(recommended)"}
                />
                <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    Status: <span className={byKey["GITHUB_TOKEN"]?.status === "set" ? "text-emerald-600" : "text-destructive"}>{byKey["GITHUB_TOKEN"]?.status || "unset"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground">Clear</div>
                    <Switch checked={clearGithubToken} onCheckedChange={setClearGithubToken} />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <LabelWithHelp htmlFor="nixBin" help="Binary name/path used to invoke Nix (NIX_BIN).">
                  Nix binary
                </LabelWithHelp>
                <Input id="nixBin" value={nixBin} onChange={(e) => setNixBin(e.target.value)} placeholder="nix" />
              </div>

              <div className="space-y-2">
                <LabelWithHelp htmlFor="sopsAgeKeyFile" help="Path to your operator age key file (SOPS_AGE_KEY_FILE).">
                  SOPS age key file
                </LabelWithHelp>
                <Input
                  id="sopsAgeKeyFile"
                  value={sopsAgeKeyFile}
                  onChange={(e) => setSopsAgeKeyFile(e.target.value)}
                  placeholder="~/.config/sops/age/keys.txt"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
                Save settings
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={() => {
                  setHcloudToken("")
                  setGithubToken("")
                  setClearHcloudToken(false)
                  setClearGithubToken(false)
                  setNixBin(String(byKey["NIX_BIN"]?.value || "nix"))
                  setSopsAgeKeyFile(String(byKey["SOPS_AGE_KEY_FILE"]?.value || ""))
                }}
              >
                Reset
              </Button>
            </div>

            <div className="pt-2">
              <div className="text-xs text-muted-foreground mb-2">Template</div>
              <Textarea readOnly className="font-mono min-h-[140px]" value={creds.data?.template || ""} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
