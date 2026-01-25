import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { SecretInput } from "~/components/ui/secret-input"
import { StackedField } from "~/components/ui/stacked-field"
import { detectSopsAgeKey, generateSopsAgeKey, getDeployCredsStatus, updateDeployCreds } from "~/sdk/deploy-creds"

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
  const [hcloudUnlocked, setHcloudUnlocked] = useState(false)
  const [githubUnlocked, setGithubUnlocked] = useState(false)
  const [nixBin, setNixBin] = useState("nix")
  const [sopsAgeKeyFile, setSopsAgeKeyFile] = useState("")
  const [sopsStatus, setSopsStatus] = useState<{ kind: "ok" | "warn" | "error"; message: string } | null>(null)

  useEffect(() => {
    if (!creds.data) return
    const nix = credsByKey["NIX_BIN"]?.value
    const sops = credsByKey["SOPS_AGE_KEY_FILE"]?.value
    setNixBin(String(nix || "nix"))
    setSopsAgeKeyFile(String(sops || creds.data.defaultSopsAgeKeyPath || ""))
    setHcloudUnlocked(false)
    setGithubUnlocked(false)
    setSopsStatus(null)
  }, [creds.data, credsByKey])

  const save = useMutation({
    mutationFn: async () => {
      return await updateDeployCreds({
        data: {
          projectId,
          updates: {
            ...(hcloudToken.trim() ? { HCLOUD_TOKEN: hcloudToken.trim() } : {}),
            ...(githubToken.trim() ? { GITHUB_TOKEN: githubToken.trim() } : {}),
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
      setHcloudUnlocked(false)
      setGithubUnlocked(false)
      await creds.refetch()
    },
    onError: (err) => {
      toast.error(String(err))
    },
  })

  const detectSops = useMutation({
    mutationFn: async () => await detectSopsAgeKey({ data: { projectId } }),
    onSuccess: (res) => {
      if (res.recommendedPath) {
        setSopsAgeKeyFile(res.recommendedPath)
        setSopsStatus({ kind: "ok", message: `Found key: ${res.recommendedPath}` })
      } else {
        setSopsStatus({ kind: "warn", message: "No valid age key found. Generate one below." })
      }
    },
    onError: (err) => {
      setSopsStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) })
    },
  })

  const generateSops = useMutation({
    mutationFn: async () => await generateSopsAgeKey({ data: { projectId } }),
    onSuccess: async (res) => {
      if (res.ok) {
        setSopsAgeKeyFile(res.keyPath)
        setSopsStatus({ kind: "ok", message: `Generated key: ${res.keyPath}` })
        await creds.refetch()
        toast.success("SOPS key generated")
      } else {
        setSopsStatus({ kind: "warn", message: res.message || "Key already exists." })
      }
    },
    onError: (err) => {
      setSopsStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) })
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

          <div className="space-y-4">
            <StackedField id="hcloudToken" label="Hetzner API token" help="Hetzner Cloud API token (HCLOUD_TOKEN).">
              <SecretInput
                id="hcloudToken"
                value={hcloudToken}
                onValueChange={setHcloudToken}
                placeholder={credsByKey["HCLOUD_TOKEN"]?.status === "set" ? "set (click Remove to edit)" : "(required)"}
                locked={credsByKey["HCLOUD_TOKEN"]?.status === "set" && !hcloudUnlocked}
                onUnlock={() => setHcloudUnlocked(true)}
              />
            </StackedField>

            <StackedField id="githubToken" label="GitHub token" help="GitHub token (GITHUB_TOKEN).">
              <SecretInput
                id="githubToken"
                value={githubToken}
                onValueChange={setGithubToken}
                placeholder={credsByKey["GITHUB_TOKEN"]?.status === "set" ? "set (click Remove to edit)" : "(recommended)"}
                locked={credsByKey["GITHUB_TOKEN"]?.status === "set" && !githubUnlocked}
                onUnlock={() => setGithubUnlocked(true)}
              />
            </StackedField>

            <StackedField id="nixBin" label="Nix binary" help="Binary name/path used to invoke Nix (NIX_BIN).">
              <Input id="nixBin" value={nixBin} onChange={(e) => setNixBin(e.target.value)} placeholder="nix" />
            </StackedField>

            <StackedField
              id="sopsAgeKeyFile"
              label="SOPS age key file"
              help="Path to your operator age key file (SOPS_AGE_KEY_FILE)."
            >
              <InputGroup>
                <InputGroupInput
                  id="sopsAgeKeyFile"
                  value={sopsAgeKeyFile}
                  onChange={(e) => setSopsAgeKeyFile(e.target.value)}
                  placeholder=".clawdlets/keys/operators/<user>.agekey"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton disabled={detectSops.isPending} onClick={() => detectSops.mutate()}>
                    {detectSops.isPending ? "Finding…" : "Find"}
                  </InputGroupButton>
                  <InputGroupButton disabled={generateSops.isPending} onClick={() => generateSops.mutate()}>
                    {generateSops.isPending ? "Generating…" : "Generate"}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {sopsStatus ? (
                <div className={`text-xs ${sopsStatus.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                  {sopsStatus.message}
                </div>
              ) : null}
            </StackedField>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
