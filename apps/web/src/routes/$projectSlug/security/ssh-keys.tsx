import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { Label } from "~/components/ui/label"
import { Input } from "~/components/ui/input"
import { Textarea } from "~/components/ui/textarea"
import { SettingsSection } from "~/components/ui/settings-section"
import { useProjectBySlug } from "~/lib/project-data"
import { setupFieldHelp } from "~/lib/setup-field-help"
import {
  addHostSshKeys,
  getClawdletsConfig,
  removeHostSshAuthorizedKey,
  removeHostSshKnownHost,
} from "~/sdk/config"

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
  const hosts = useMemo(() => Object.keys(config?.hosts ?? {}).sort(), [config])

  const [selectedHost, setSelectedHost] = useState("")

  useEffect(() => {
    if (selectedHost) return
    if (hosts.length) setSelectedHost(hosts[0]!)
  }, [hosts, selectedHost])

  const hostCfg = selectedHost && config ? config.hosts[selectedHost] : null

  const [keyText, setKeyText] = useState("")
  const [knownHostsText, setKnownHostsText] = useState("")

  async function importTextFile(file: File, opts: { maxBytes: number }): Promise<string> {
    if (file.size > opts.maxBytes) throw new Error(`file too large (> ${Math.ceil(opts.maxBytes / 1024)}KB)`)
    return await file.text()
  }

  const addSsh = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("missing project")
      if (!selectedHost) throw new Error("select a host")
      return await addHostSshKeys({
        data: {
          projectId: projectId as Id<"projects">,
          host: selectedHost,
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
      if (!selectedHost) throw new Error("select a host")
      return await removeHostSshAuthorizedKey({
        data: { projectId: projectId as Id<"projects">, host: selectedHost, key },
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
      if (!selectedHost) throw new Error("select a host")
      return await removeHostSshKnownHost({
        data: { projectId: projectId as Id<"projects">, host: selectedHost, entry },
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
  if (!hosts.length) {
    return <div className="text-muted-foreground">No hosts found in this project.</div>
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Host selection"
        description="SSH keys are stored per host, but managed from this project Security page."
      >
        <div className="space-y-2 max-w-sm">
          <Label htmlFor="security-host">Host</Label>
          <NativeSelect
            id="security-host"
            value={selectedHost}
            onChange={(e) => setSelectedHost(e.target.value)}
          >
            {hosts.map((h) => (
              <NativeSelectOption key={h} value={h}>
                {h}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </SettingsSection>

      <SettingsSection
        title="SSH Keys"
        description={
          <>
            Manage authorized keys and known hosts for{" "}
            <code className="text-xs">hosts.{selectedHost}</code>.
          </>
        }
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

          <div className="border-t pt-4 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs font-medium">Authorized keys</div>
              {hostCfg?.sshAuthorizedKeys?.length ? (
                <div className="max-h-44 overflow-auto pr-1 space-y-2">
                  {hostCfg.sshAuthorizedKeys.map((key: string) => (
                    <div key={key} className="flex items-start gap-2 rounded-md border bg-background/30 p-2">
                      <code className="flex-1 text-xs font-mono break-all">{key}</code>
                      <Button
                        type="button"
                        size="xs"
                        variant="destructive"
                        disabled={removeAuthorizedKey.isPending}
                        onClick={() => removeAuthorizedKey.mutate(key)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">None.</div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium">Known hosts</div>
              {hostCfg?.sshKnownHosts?.length ? (
                <div className="max-h-44 overflow-auto pr-1 space-y-2">
                  {hostCfg.sshKnownHosts.map((entry: string) => (
                    <div key={entry} className="flex items-start gap-2 rounded-md border bg-background/30 p-2">
                      <code className="flex-1 text-xs font-mono break-all">{entry}</code>
                      <Button
                        type="button"
                        size="xs"
                        variant="destructive"
                        disabled={removeKnownHost.isPending}
                        onClick={() => removeKnownHost.mutate(entry)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">None.</div>
              )}
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}

