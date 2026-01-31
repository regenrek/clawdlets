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
import { SettingsSection } from "~/components/ui/settings-section"
import { Switch } from "~/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip"
import { looksLikeSshPrivateKeyText, looksLikeSshPublicKeyText } from "~/lib/form-utils"
import { singleHostCidrFromIp } from "~/lib/ip-utils"
import { useProjectBySlug } from "~/lib/project-data"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { ConnectivityPanel } from "~/components/hosts/connectivity-panel"
import { getClawdletsConfig, writeClawdletsConfigFile } from "~/sdk/config"

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
  const [sshPubkeyFile, setSshPubkeyFile] = useState("")
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
    setSshPubkeyFile(hostCfg.provisioning?.sshPubkeyFile || "")
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
      const sshPubkeyFileTrimmed = sshPubkeyFile.trim()
      if (looksLikeSshPrivateKeyText(sshPubkeyFileTrimmed) || looksLikeSshPublicKeyText(sshPubkeyFileTrimmed)) {
        throw new Error("SSH pubkey file must be a local file path (not key contents). Use Security → SSH Keys to paste keys.")
      }
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
              sshPubkeyFile: sshPubkeyFileTrimmed,
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
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Host Settings</h1>
        <p className="text-muted-foreground">
          Manage hosts, SSH targets, and access settings.
        </p>
      </div>

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
      ) : hostCfg ? (
        <div className="space-y-6">
          <ConnectivityPanel
            projectId={projectId as Id<"projects">}
            host={selectedHost}
            targetHost={targetHost}
          />

          <SettingsSection
            title="Host Status"
            description={<>Stored in <code className="text-xs">hosts.{selectedHost}</code></>}
            actions={
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <span>Enabled</span>
                  <HelpTooltip title="Enabled" side="top">
                    {setupFieldHelp.hosts.enabled}
                  </HelpTooltip>
                </div>
                <Switch checked={enable} onCheckedChange={setEnable} />
              </div>
            }
          >
            <div className="text-lg font-semibold">{selectedHost}</div>
          </SettingsSection>

          <SettingsSection
            title="Connection"
            description="SSH target and admin access settings."
            statusText="Used for provisioning access."
            actions={<Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>}
          >
            <div className="grid gap-4 md:grid-cols-2">
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
            </div>
          </SettingsSection>

          <SettingsSection
            title="SSH Connectivity"
            description="Controls how operators reach this host via SSH (network exposure + which local public key file to use during provisioning)."
            actions={<Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>}
          >
            <div className="grid gap-4 md:grid-cols-2">
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
                <LabelWithHelp htmlFor="pubkeyFile" help={setupFieldHelp.hosts.sshPubkeyFile}>
                  Operator public key file (local path)
                </LabelWithHelp>
                <Input
                  id="pubkeyFile"
                  value={sshPubkeyFile}
                  onChange={(e) => setSshPubkeyFile(e.target.value)}
                  placeholder="~/.ssh/id_ed25519.pub"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setSshPubkeyFile("~/.ssh/id_ed25519.pub")}
                  >
                    Use ~/.ssh/id_ed25519.pub
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setSshPubkeyFile("~/.ssh/id_rsa.pub")}
                  >
                    Use ~/.ssh/id_rsa.pub
                  </Button>
                </div>
                {(() => {
                  const v = sshPubkeyFile.trim()
                  if (!v) {
                    return (
                      <div className="text-xs text-destructive">
                        Required for provisioning. This is a local path on the machine running bootstrap.
                      </div>
                    )
                  }
                  if (looksLikeSshPrivateKeyText(v)) {
                    return (
                      <div className="text-xs text-destructive">
                        Private key detected. Do not paste secrets here.
                      </div>
                    )
                  }
                  if (looksLikeSshPublicKeyText(v)) {
                    return (
                      <div className="text-xs text-destructive">
                        Looks like SSH key contents. This field expects a file path.
                      </div>
                    )
                  }
                  if (!v.endsWith(".pub")) {
                    return (
                      <div className="text-xs text-muted-foreground">
                        Warning: does not end with <code>.pub</code>. Double-check this is a public key file path.
                      </div>
                    )
                  }
                  return (
                    <div className="text-xs text-muted-foreground">
                      The dashboard can’t read your filesystem; the CLI validates this path when you run bootstrap/infra.
                    </div>
                  )
                })()}
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            title="Network"
            description="VPN and tailnet configuration."
            actions={<Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>}
          >
            <div className="space-y-2 max-w-xs">
              <LabelWithHelp htmlFor="tailnetMode" help={setupFieldHelp.hosts.tailnet}>
                Tailnet mode
              </LabelWithHelp>
              <NativeSelect id="tailnetMode" value={tailnetMode} onChange={(e) => setTailnetMode(e.target.value as any)}>
                <NativeSelectOption value="tailscale">tailscale</NativeSelectOption>
                <NativeSelectOption value="none">none</NativeSelectOption>
              </NativeSelect>
            </div>
          </SettingsSection>

          <SettingsSection
            title="Hetzner Cloud"
            description="Cloud provider configuration for this host."
            actions={<Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithHelp htmlFor="serverType" help={setupFieldHelp.hosts.hetznerServerType}>
                  Server type
                </LabelWithHelp>
                <Input id="serverType" value={serverType} onChange={(e) => setServerType(e.target.value)} />
              </div>
              <div className="space-y-2">
                <LabelWithHelp htmlFor="location" help={setupFieldHelp.hosts.hetznerLocation}>
                  Location
                </LabelWithHelp>
                <Input id="location" value={hetznerLocation} onChange={(e) => setHetznerLocation(e.target.value)} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <LabelWithHelp htmlFor="image" help={setupFieldHelp.hosts.hetznerImage}>
                  Image
                </LabelWithHelp>
                <Input id="image" value={hetznerImage} onChange={(e) => setHetznerImage(e.target.value)} />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            title="NixOS Configuration"
            description="System-level NixOS settings."
            actions={<Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <LabelWithHelp htmlFor="disk" help={setupFieldHelp.hosts.diskDevice}>
                  Disk device
                </LabelWithHelp>
                <Input id="disk" value={diskDevice} onChange={(e) => setDiskDevice(e.target.value)} />
              </div>
              <div className="space-y-2">
                <LabelWithHelp htmlFor="flakeHost" help={setupFieldHelp.hosts.flakeHost}>
                  Flake host override
                </LabelWithHelp>
                <Input id="flakeHost" value={flakeHost} onChange={(e) => setFlakeHost(e.target.value)} />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            title="Agent"
            description="AI agent model configuration."
            statusText="Format: provider/model"
            actions={<Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>}
          >
            <div className="space-y-2 max-w-md">
              <LabelWithHelp htmlFor="model" help={setupFieldHelp.hosts.agentModelPrimary}>
                Primary model
              </LabelWithHelp>
              <Input id="model" value={agentModelPrimary} onChange={(e) => setAgentModelPrimary(e.target.value)} placeholder="provider/model" />
            </div>
          </SettingsSection>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm font-medium">Unknown host: {selectedHost}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Add it in the fleet config or go back to hosts.
            </div>
          </div>
          <Button
            variant="secondary"
            nativeButton={false}
            render={<Link to="/$projectSlug/hosts" params={{ projectSlug }} />}
          >
            Back to hosts
          </Button>
        </div>
      )}
    </div>
  )
}
