import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { ArrowPathIcon } from "@heroicons/react/24/outline"
import { Button } from "~/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { Input } from "~/components/ui/input"
import { HelpTooltip, LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { PageHeader } from "~/components/ui/page-header"
import { SettingsSection } from "~/components/ui/settings-section"
import { Switch } from "~/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip"
import { singleHostCidrFromIp } from "~/lib/ip-utils"
import { useProjectBySlug } from "~/lib/project-data"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { ConnectivityPanel } from "~/components/hosts/connectivity-panel"
import { writeClawdletsConfigFile } from "~/sdk/config"
import { clawdletsConfigQueryOptions, projectsListQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/$projectSlug/hosts/$host/settings")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    await context.queryClient.ensureQueryData(clawdletsConfigQueryOptions(projectId))
  },
  component: HostsSetup,
})

function looksLikeSshPublicKeyText(value: string): boolean {
  const s = String(value || "").trim()
  if (!s) return false
  const firstLine = s.split(/\r?\n/)[0] || ""
  const tokens = firstLine.trim().split(/\s+/)
  if (tokens.length < 2) return false
  const [type, base64] = tokens
  if (!type) return false
  if (!type.startsWith("ssh-") && !type.includes("ssh")) return false
  if (!base64) return false
  if (!/^[A-Za-z0-9+/]+={0,3}$/.test(base64)) return false
  return true
}

function looksLikeSshPrivateKeyText(value: string): boolean {
  const s = String(value || "").trimStart()
  if (!s.startsWith("-----BEGIN ")) return false
  return (
    s.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")
    || s.startsWith("-----BEGIN RSA PRIVATE KEY-----")
    || s.startsWith("-----BEGIN PRIVATE KEY-----")
  )
}

function HostSettingsForm(props: {
  projectId: Id<"projects">
  selectedHost: string
  config: any
  hostCfg: any
}) {
  const queryClient = useQueryClient()

  const [enable, setEnable] = useState(Boolean(props.hostCfg.enable))
  const [diskDevice, setDiskDevice] = useState(props.hostCfg.diskDevice || "/dev/sda")
  const [targetHost, setTargetHost] = useState(props.hostCfg.targetHost || "")
  const [adminCidr, setAdminCidr] = useState(props.hostCfg.provisioning?.adminCidr || "")
  const [sshPubkeyFile, setSshPubkeyFile] = useState(props.hostCfg.provisioning?.sshPubkeyFile || "")
  const [sshExposure, setSshExposure] = useState<"tailnet" | "bootstrap" | "public">(
    (props.hostCfg.sshExposure?.mode as any) || "bootstrap",
  )
  const [tailnetMode, setTailnetMode] = useState<"tailscale" | "none">((props.hostCfg.tailnet?.mode as any) || "tailscale")
  const [serverType, setServerType] = useState(props.hostCfg.hetzner?.serverType || "cx43")
  const [hetznerImage, setHetznerImage] = useState(props.hostCfg.hetzner?.image || "")
  const [hetznerLocation, setHetznerLocation] = useState(props.hostCfg.hetzner?.location || "nbg1")
  const [flakeHost, setFlakeHost] = useState(props.hostCfg.flakeHost || "")
  const [agentModelPrimary, setAgentModelPrimary] = useState((props.hostCfg as any).agentModelPrimary || "")

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

  const save = useMutation({
    mutationFn: async () => {
      const sshPubkeyFileTrimmed = sshPubkeyFile.trim()
      if (looksLikeSshPrivateKeyText(sshPubkeyFileTrimmed) || looksLikeSshPublicKeyText(sshPubkeyFileTrimmed)) {
        throw new Error("SSH pubkey file must be a local file path (not key contents). Use Security → SSH Keys to paste keys.")
      }
      const next = {
        ...props.config,
        hosts: {
          ...props.config.hosts,
          [props.selectedHost]: {
            ...props.hostCfg,
            enable,
            diskDevice: diskDevice.trim(),
            targetHost: targetHost.trim() || undefined,
            flakeHost: flakeHost.trim(),
            provisioning: {
              ...props.hostCfg.provisioning,
              adminCidr: adminCidr.trim(),
              sshPubkeyFile: sshPubkeyFileTrimmed,
            },
            sshExposure: { ...props.hostCfg.sshExposure, mode: sshExposure },
            tailnet: { ...props.hostCfg.tailnet, mode: tailnetMode },
            hetzner: {
              ...props.hostCfg.hetzner,
              serverType: serverType.trim(),
              image: hetznerImage.trim(),
              location: hetznerLocation.trim(),
            },
            agentModelPrimary: agentModelPrimary.trim(),
          },
        },
      }
      return await writeClawdletsConfigFile({
        data: { projectId: props.projectId, next, title: `Update host ${props.selectedHost}` },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", props.projectId] })
      } else toast.error("Validation failed")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  return (
    <div className="space-y-6">
      {/* Connectivity Panel */}
      <ConnectivityPanel
        projectId={props.projectId}
        host={props.selectedHost}
        targetHost={targetHost}
      />

      {/* Host Status */}
      <SettingsSection
        title="Host Status"
        description={<>Stored in <code className="text-xs">hosts.{props.selectedHost}</code></>}
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
        <div className="text-lg font-semibold">{props.selectedHost}</div>
      </SettingsSection>

      {/* Connection */}
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

      {/* SSH Access */}
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

      {/* Network */}
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

      {/* Hetzner Cloud */}
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

      {/* NixOS Configuration */}
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

      {/* Agent */}
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
  )
}

function HostsSetup() {
  const { projectSlug, host: selectedHost } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId

  const cfg = useQuery({
    ...clawdletsConfigQueryOptions((projectId as Id<"projects"> | null) ?? null),
    enabled: Boolean(projectId),
  })

  const config = cfg.data?.config
  const hostCfg = selectedHost && config ? config.hosts[selectedHost] : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Host Settings"
        description="Manage hosts, SSH targets, and access settings."
      />

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
        <HostSettingsForm
          key={selectedHost}
          projectId={projectId as Id<"projects">}
          selectedHost={selectedHost}
          config={config}
          hostCfg={hostCfg}
        />
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
  )
}
