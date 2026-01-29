import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { ArrowPathIcon } from "@heroicons/react/24/outline"
import { Button } from "~/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { Input } from "~/components/ui/input"
import { HelpTooltip, LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { Switch } from "~/components/ui/switch"
import { Textarea } from "~/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip"
import { singleHostCidrFromIp } from "~/lib/ip-utils"
import { useProjectBySlug } from "~/lib/project-data"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { ConnectivityPanel } from "~/components/hosts/connectivity-panel"
import { addHostSshKeys, getClawdletsConfig, removeHostSshAuthorizedKey, removeHostSshKnownHost, writeClawdletsConfigFile } from "~/sdk/config"

export const Route = createFileRoute("/$projectSlug/hosts/$host/settings")({
  component: HostsSetup,
})

function HostsSetup() {
  const { projectSlug, host: selectedHost } = Route.useParams()
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
  const hostCfg = selectedHost && config ? config.hosts[selectedHost] : null

  const [enable, setEnable] = useState(false)
  const [diskDevice, setDiskDevice] = useState("/dev/sda")
  const [targetHost, setTargetHost] = useState("")
  const [adminCidr, setAdminCidr] = useState("")
  const [sshPubkeyFile, setSshPubkeyFile] = useState("~/.ssh/id_ed25519.pub")
  const [sshExposure, setSshExposure] = useState<"tailnet" | "bootstrap" | "public">("bootstrap")
  const [tailnetMode, setTailnetMode] = useState<"tailscale" | "none">("tailscale")
  const [serverType, setServerType] = useState("cx43")
  const [hetznerImage, setHetznerImage] = useState("")
  const [hetznerLocation, setHetznerLocation] = useState("nbg1")
  const [flakeHost, setFlakeHost] = useState("")
  const [agentModelPrimary, setAgentModelPrimary] = useState("")

  const [detectingAdminCidr, setDetectingAdminCidr] = useState(false)

  async function detectAdminCidr() {
    setDetectingAdminCidr(true)
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 6000)
    try {
      const res = await fetch("https://api.ipify.org?format=json", { signal: ctrl.signal })
      if (!res.ok) throw new Error(`ip lookup failed (${res.status})`)
      const json = (await res.json()) as { ip?: unknown }
      const ip = typeof json.ip === "string" ? json.ip : ""
      const cidr = singleHostCidrFromIp(ip)
      setAdminCidr(cidr)
      toast.success(`Admin CIDR set to ${cidr}`)
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? "timed out"
          : err instanceof Error
            ? err.message
            : String(err)
      toast.error(`Admin CIDR detect failed: ${msg}`)
    } finally {
      clearTimeout(timeout)
      setDetectingAdminCidr(false)
    }
  }

  useEffect(() => {
    if (!hostCfg) return
    setEnable(Boolean(hostCfg.enable))
    setDiskDevice(hostCfg.diskDevice || "/dev/sda")
    setTargetHost(hostCfg.targetHost || "")
    setAdminCidr(hostCfg.provisioning?.adminCidr || "")
    setSshPubkeyFile(hostCfg.provisioning?.sshPubkeyFile || "~/.ssh/id_ed25519.pub")
    setSshExposure((hostCfg.sshExposure?.mode as any) || "bootstrap")
    setTailnetMode((hostCfg.tailnet?.mode as any) || "tailscale")
    setServerType(hostCfg.hetzner?.serverType || "cx43")
    setHetznerImage(hostCfg.hetzner?.image || "")
    setHetznerLocation(hostCfg.hetzner?.location || "nbg1")
    setFlakeHost(hostCfg.flakeHost || "")
    setAgentModelPrimary((hostCfg as any).agentModelPrimary || "")
  }, [hostCfg, selectedHost])

  const save = useMutation({
    mutationFn: async () => {
      if (!config || !hostCfg) throw new Error("missing host")
      const next = {
        ...config,
        hosts: {
          ...config.hosts,
          [selectedHost]: {
            ...hostCfg,
            enable,
            diskDevice: diskDevice.trim(),
            targetHost: targetHost.trim() || undefined,
            flakeHost: flakeHost.trim(),
            provisioning: {
              ...hostCfg.provisioning,
              adminCidr: adminCidr.trim(),
              sshPubkeyFile: sshPubkeyFile.trim(),
            },
            sshExposure: { ...hostCfg.sshExposure, mode: sshExposure },
            tailnet: { ...hostCfg.tailnet, mode: tailnetMode },
            hetzner: {
              ...hostCfg.hetzner,
              serverType: serverType.trim(),
              image: hetznerImage.trim(),
              location: hetznerLocation.trim(),
            },
            agentModelPrimary: agentModelPrimary.trim(),
          },
        },
      }
      return await writeClawdletsConfigFile({
        data: { projectId: projectId as Id<"projects">, next, title: `Update host ${selectedHost}` },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else toast.error("Validation failed")
    },
  })

  const [keyText, setKeyText] = useState("")
  const [knownHostsText, setKnownHostsText] = useState("")

  async function importTextFile(file: File, opts: { maxBytes: number }): Promise<string> {
    if (file.size > opts.maxBytes) throw new Error(`file too large (> ${Math.ceil(opts.maxBytes / 1024)}KB)`)
    return await file.text()
  }

  const addSsh = useMutation({
    mutationFn: async () => {
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
    mutationFn: async (key: string) =>
      await removeHostSshAuthorizedKey({ data: { projectId: projectId as Id<"projects">, host: selectedHost, key } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Removed SSH key")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else toast.error("Failed")
    },
  })

  const removeKnownHost = useMutation({
    mutationFn: async (entry: string) =>
      await removeHostSshKnownHost({ data: { projectId: projectId as Id<"projects">, host: selectedHost, entry } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Removed known_hosts entry")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else toast.error("Failed")
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Host Settings</h1>
      <p className="text-muted-foreground">
        Manage hosts, SSH targets, and access settings.
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
        <div className="rounded-lg border bg-card p-6 space-y-6">
          {hostCfg ? (
            <>
              <ConnectivityPanel
                projectId={projectId as Id<"projects">}
                host={selectedHost}
                targetHost={targetHost}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-semibold truncate">{selectedHost}</div>
                  <div className="text-xs text-muted-foreground">
                    Stored in <code>hosts.{selectedHost}</code>.
                  </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <span>Enabled</span>
                      <HelpTooltip title="Enabled" side="top">
                        {setupFieldHelp.hosts.enabled}
                      </HelpTooltip>
                    </div>
                    <Switch checked={enable} onCheckedChange={setEnable} />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <LabelWithHelp htmlFor="disk" help={setupFieldHelp.hosts.diskDevice}>
                      Disk device
                    </LabelWithHelp>
                    <Input id="disk" value={diskDevice} onChange={(e) => setDiskDevice(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <LabelWithHelp htmlFor="target" help={setupFieldHelp.hosts.targetHost}>
                      SSH targetHost
                    </LabelWithHelp>
                    <Input id="target" value={targetHost} onChange={(e) => setTargetHost(e.target.value)} placeholder="ssh-alias or user@host" />
                  </div>
                  <div className="space-y-2">
                    <LabelWithHelp htmlFor="adminCidr" help={setupFieldHelp.hosts.adminCidr}>
                      Admin CIDR
                    </LabelWithHelp>
                    <InputGroup>
                      <InputGroupInput
                        id="adminCidr"
                        value={adminCidr}
                        onChange={(e) => setAdminCidr(e.target.value)}
                        placeholder="203.0.113.10/32"
                      />
                      <InputGroupAddon align="inline-end">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <InputGroupButton
                                type="button"
                                variant="secondary"
                                disabled={detectingAdminCidr}
                                onClick={() => void detectAdminCidr()}
                              >
                                <ArrowPathIcon className={detectingAdminCidr ? "animate-spin" : ""} />
                                Detect
                              </InputGroupButton>
                            }
                          />
                          <TooltipContent side="top" align="end">
                            Detect from your current public IP (via ipify).
                          </TooltipContent>
                        </Tooltip>
                      </InputGroupAddon>
                    </InputGroup>
                  </div>
                  <div className="space-y-2">
                    <LabelWithHelp htmlFor="pubkeyFile" help={setupFieldHelp.hosts.sshPubkeyFile}>
                      SSH pubkey file
                    </LabelWithHelp>
                    <Input id="pubkeyFile" value={sshPubkeyFile} onChange={(e) => setSshPubkeyFile(e.target.value)} />
                  </div>

                  <div className="space-y-2">
                    <LabelWithHelp htmlFor="sshExposure" help={setupFieldHelp.hosts.sshExposure}>
                      SSH exposure
                    </LabelWithHelp>
                    <NativeSelect id="sshExposure" value={sshExposure} onChange={(e) => setSshExposure(e.target.value as any)}>
                      <NativeSelectOption value="tailnet">tailnet</NativeSelectOption>
                      <NativeSelectOption value="bootstrap">bootstrap</NativeSelectOption>
                      <NativeSelectOption value="public">public</NativeSelectOption>
                    </NativeSelect>
                  </div>
                  <div className="space-y-2">
                    <LabelWithHelp htmlFor="tailnetMode" help={setupFieldHelp.hosts.tailnet}>
                      Tailnet
                    </LabelWithHelp>
                    <NativeSelect id="tailnetMode" value={tailnetMode} onChange={(e) => setTailnetMode(e.target.value as any)}>
                      <NativeSelectOption value="tailscale">tailscale</NativeSelectOption>
                      <NativeSelectOption value="none">none</NativeSelectOption>
                    </NativeSelect>
                  </div>

                  <div className="space-y-2">
                    <LabelWithHelp htmlFor="serverType" help={setupFieldHelp.hosts.hetznerServerType}>
                      Hetzner serverType
                    </LabelWithHelp>
                    <Input id="serverType" value={serverType} onChange={(e) => setServerType(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <LabelWithHelp htmlFor="location" help={setupFieldHelp.hosts.hetznerLocation}>
                      Hetzner location
                    </LabelWithHelp>
                    <Input id="location" value={hetznerLocation} onChange={(e) => setHetznerLocation(e.target.value)} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <LabelWithHelp htmlFor="image" help={setupFieldHelp.hosts.hetznerImage}>
                      Hetzner image
                    </LabelWithHelp>
                    <Input id="image" value={hetznerImage} onChange={(e) => setHetznerImage(e.target.value)} />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <LabelWithHelp htmlFor="flakeHost" help={setupFieldHelp.hosts.flakeHost}>
                      Flake host override
                    </LabelWithHelp>
                    <Input id="flakeHost" value={flakeHost} onChange={(e) => setFlakeHost(e.target.value)} />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <LabelWithHelp htmlFor="model" help={setupFieldHelp.hosts.agentModelPrimary}>
                      Agent model (primary)
                    </LabelWithHelp>
                    <Input id="model" value={agentModelPrimary} onChange={(e) => setAgentModelPrimary(e.target.value)} placeholder="provider/model" />
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <div className="font-medium text-sm">SSH key import</div>
                  <div className="text-xs text-muted-foreground">
                    Adds to <code>hosts.{selectedHost}.sshAuthorizedKeys</code> and optionally imports known_hosts entries.
                  </div>
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
                      <div className="text-xs text-muted-foreground">Reads locally in your browser; server never reads `~/.ssh`.</div>
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
                              setKnownHostsText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}\n` : `${text}\n`))
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
                  <Button type="button" disabled={addSsh.isPending} onClick={() => addSsh.mutate()}>
                    Add SSH settings
                  </Button>

                  <div className="border-t pt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-xs font-medium">Authorized keys</div>
                      {hostCfg.sshAuthorizedKeys?.length ? (
                        <div className="max-h-44 overflow-auto pr-1 space-y-2">
                          {hostCfg.sshAuthorizedKeys.map((key: string) => (
                            <div key={key} className="flex items-start gap-2 rounded-md border bg-background/30 p-2">
                              <code className="flex-1 text-xs font-mono break-all">{key}</code>
                              <Button type="button" size="xs" variant="destructive" disabled={removeAuthorizedKey.isPending} onClick={() => removeAuthorizedKey.mutate(key)}>Remove</Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">None.</div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium">Known hosts</div>
                      {hostCfg.sshKnownHosts?.length ? (
                        <div className="max-h-44 overflow-auto pr-1 space-y-2">
                          {hostCfg.sshKnownHosts.map((entry: string) => (
                            <div key={entry} className="flex items-start gap-2 rounded-md border bg-background/30 p-2">
                              <code className="flex-1 text-xs font-mono break-all">{entry}</code>
                              <Button type="button" size="xs" variant="destructive" disabled={removeKnownHost.isPending} onClick={() => removeKnownHost.mutate(entry)}>Remove</Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">None.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
                    Save host
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })}
                  >
                    Reload
                  </Button>
                </div>
            </>
          ) : (
            <div className="flex flex-col gap-3 text-muted-foreground">
              <div>Select a host from Hosts overview.</div>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/$projectSlug/hosts" params={{ projectSlug }} />}
                className="w-fit"
              >
                View hosts
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
