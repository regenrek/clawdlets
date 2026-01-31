import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { LabelWithHelp } from "~/components/ui/label-help"
import { Input } from "~/components/ui/input"
import { Textarea } from "~/components/ui/textarea"
import { SettingsSection } from "~/components/ui/settings-section"
import { useProjectBySlug } from "~/lib/project-data"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { addProjectSshKeys, getClawdletsConfig, removeProjectSshAuthorizedKey, removeProjectSshKnownHost } from "~/sdk/config"

export const Route = createFileRoute("/$projectSlug/security/ssh-keys")({
  component: SecuritySshKeys,
})

function SecuritySshKeys() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const queryClient = useQueryClient()

  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
    enabled: Boolean(projectId),
  })

  const config = cfg.data?.config
  const fleetSshKeys = useMemo(
    () => ({
      authorized: config?.fleet?.sshAuthorizedKeys ?? [],
      knownHosts: config?.fleet?.sshKnownHosts ?? [],
    }),
    [config],
  )

  const [keyText, setKeyText] = useState("")
  const [knownHostsText, setKnownHostsText] = useState("")

  async function importTextFile(file: File, opts: { maxBytes: number }): Promise<string> {
    if (file.size > opts.maxBytes) throw new Error(`file too large (> ${Math.ceil(opts.maxBytes / 1024)}KB)`)
    return await file.text()
  }

  const addSsh = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("missing project")
      return await addProjectSshKeys({
        data: {
          projectId: projectId as Id<"projects">,
          keyText,
          knownHostsText,
        },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Updated SSH settings")
        setKeyText("")
        setKnownHostsText("")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else toast.error("Failed")
    },
  })

  const removeAuthorizedKey = useMutation({
    mutationFn: async (key: string) => {
      if (!projectId) throw new Error("missing project")
      return await removeProjectSshAuthorizedKey({
        data: { projectId: projectId as Id<"projects">, key },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Removed SSH key")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else toast.error("Failed")
    },
  })

  const removeKnownHost = useMutation({
    mutationFn: async (entry: string) => {
      if (!projectId) throw new Error("missing project")
      return await removeProjectSshKnownHost({
        data: { projectId: projectId as Id<"projects">, entry },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Removed known_hosts entry")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else toast.error("Failed")
    },
  })

  if (projectQuery.isPending || cfg.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }
  if (cfg.error) {
    return <div className="text-sm text-destructive">{String(cfg.error)}</div>
  }
  if (!config) {
    return <div className="text-muted-foreground">Missing config.</div>
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="SSH Keys"
        description={<>Manage project-level authorized keys and known hosts shared across all hosts.</>}
        actions={
          <Button disabled={addSsh.isPending} onClick={() => addSsh.mutate()}>
            Add SSH Keys
          </Button>
        }
      >
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <LabelWithHelp htmlFor="keyText" help={setupFieldHelp.hosts.sshKeyPaste}>
                Paste public keys
              </LabelWithHelp>
              <Textarea
                id="keyText"
                value={keyText}
                onChange={(e) => setKeyText(e.target.value)}
                className="font-mono min-h-[100px]"
                placeholder="ssh-ed25519 AAAA... user@host"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <LabelWithHelp htmlFor="knownHostsText" help={setupFieldHelp.hosts.knownHostsFile}>
                Paste known_hosts entries (optional)
              </LabelWithHelp>
              <Textarea
                id="knownHostsText"
                value={knownHostsText}
                onChange={(e) => setKnownHostsText(e.target.value)}
                className="font-mono min-h-[80px]"
                placeholder="github.com ssh-ed25519 AAAA..."
              />
            </div>

            <div className="space-y-2">
              <LabelWithHelp htmlFor="keyFile" help={setupFieldHelp.hosts.sshKeyFile}>
                Upload public key file (.pub)
              </LabelWithHelp>
              <Input
                id="keyFile"
                type="file"
                accept=".pub,text/plain"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0]
                  if (!file) return
                  void (async () => {
                    try {
                      const text = await importTextFile(file, { maxBytes: 64 * 1024 })
                      setKeyText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}\n` : `${text}\n`))
                      toast.success(`Imported ${file.name}`)
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : String(err))
                    } finally {
                      e.currentTarget.value = ""
                    }
                  })()
                }}
              />
              <div className="text-xs text-muted-foreground">
                Reads locally in your browser; server never reads <code>~/.ssh</code>.
              </div>
            </div>

            <div className="space-y-2">
              <LabelWithHelp htmlFor="knownHosts" help={setupFieldHelp.hosts.knownHostsFile}>
                Upload known_hosts file
              </LabelWithHelp>
              <Input
                id="knownHosts"
                type="file"
                accept="text/plain"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0]
                  if (!file) return
                  void (async () => {
                    try {
                      const text = await importTextFile(file, { maxBytes: 256 * 1024 })
                      setKnownHostsText((prev) =>
                        prev.trim() ? `${prev.trimEnd()}\n${text}\n` : `${text}\n`,
                      )
                      toast.success(`Imported ${file.name}`)
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : String(err))
                    } finally {
                      e.currentTarget.value = ""
                    }
                  })()
                }}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">Authorized keys</div>
              <div className="rounded-md border bg-card p-3">
                {fleetSshKeys.authorized.length === 0 ? (
                  <div className="text-sm text-muted-foreground">None</div>
                ) : (
                  <div className="space-y-2">
                    {fleetSshKeys.authorized.map((k) => (
                      <div key={k} className="flex items-center justify-between gap-2">
                        <code className="text-xs break-all">{k}</code>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => removeAuthorizedKey.mutate(k)}
                          disabled={removeAuthorizedKey.isPending}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">known_hosts</div>
              <div className="rounded-md border bg-card p-3">
                {fleetSshKeys.knownHosts.length === 0 ? (
                  <div className="text-sm text-muted-foreground">None</div>
                ) : (
                  <div className="space-y-2">
                    {fleetSshKeys.knownHosts.map((entry) => (
                      <div key={entry} className="flex items-center justify-between gap-2">
                        <code className="text-xs break-all">{entry}</code>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => removeKnownHost.mutate(entry)}
                          disabled={removeKnownHost.isPending}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}

