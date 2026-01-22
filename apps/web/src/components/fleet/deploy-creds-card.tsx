import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { Switch } from "~/components/ui/switch"
import { getDeployCredsStatus, updateDeployCreds } from "~/sdk/deploy-creds"

type DeployCredsCardProps = {
  projectId: Id<"projects">
}

export function DeployCredsCard({ projectId }: DeployCredsCardProps) {
  const creds = useQuery({
    queryKey: ["deployCreds", projectId],
    queryFn: async () => await getDeployCredsStatus({ data: { projectId } }),
  })

  const credsByKey = useMemo(() => {
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
    const nix = credsByKey["NIX_BIN"]?.value
    const sops = credsByKey["SOPS_AGE_KEY_FILE"]?.value
    setNixBin(String(nix || "nix"))
    setSopsAgeKeyFile(String(sops || ""))
  }, [creds.data, credsByKey])

  const save = useMutation({
    mutationFn: async () => {
      return await updateDeployCreds({
        data: {
          projectId,
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
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium">Deploy credentials</div>
          <div className="text-xs text-muted-foreground">
            Local-only operator tokens used by bootstrap/infra/doctor. Stored in <code>.clawdlets/env</code>.
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
                placeholder={credsByKey["HCLOUD_TOKEN"]?.status === "set" ? "(leave blank to keep existing)" : "(required)"}
              />
              <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground">
                  Status: <span className={credsByKey["HCLOUD_TOKEN"]?.status === "set" ? "text-emerald-600" : "text-destructive"}>{credsByKey["HCLOUD_TOKEN"]?.status || "unset"}</span>
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
                placeholder={credsByKey["GITHUB_TOKEN"]?.status === "set" ? "(leave blank to keep existing)" : "(recommended)"}
              />
              <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground">
                  Status: <span className={credsByKey["GITHUB_TOKEN"]?.status === "set" ? "text-emerald-600" : "text-destructive"}>{credsByKey["GITHUB_TOKEN"]?.status || "unset"}</span>
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
                setNixBin(String(credsByKey["NIX_BIN"]?.value || "nix"))
                setSopsAgeKeyFile(String(credsByKey["SOPS_AGE_KEY_FILE"]?.value || ""))
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
