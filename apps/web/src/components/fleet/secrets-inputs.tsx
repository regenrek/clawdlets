import { useMemo, useState, type Dispatch, type SetStateAction } from "react"
import { toast } from "sonner"
import { Button } from "~/components/ui/button"
import { HelpTooltip, LabelWithHelp } from "~/components/ui/label-help"
import { Input } from "~/components/ui/input"
import { Switch } from "~/components/ui/switch"
import { Textarea } from "~/components/ui/textarea"
import { setupFieldHelp } from "~/lib/setup-field-help"

export type SecretSpec = {
  name: string
  kind: "env" | "file" | "extra"
  scope: "host" | "bot"
  source: "channel" | "model" | "provider" | "custom"
  envVars?: string[]
  optional?: boolean
  help?: string
}

export type SecretsPlan = {
  required?: SecretSpec[]
  optional?: SecretSpec[]
  missing?: unknown[]
  warnings?: Array<{ kind: string; message: string; path?: string }>
}

type SecretsInputsProps = {
  host: string
  secrets: Record<string, string>
  setSecrets: Dispatch<SetStateAction<Record<string, string>>>
  secretsTemplate: Record<string, string>
  secretsPlan: SecretsPlan | null
  advancedMode: boolean
  setAdvancedMode: Dispatch<SetStateAction<boolean>>
  customSecretNames: string[]
  setCustomSecretNames: Dispatch<SetStateAction<string[]>>
}

export function SecretsInputs(props: SecretsInputsProps) {
  const [customSecretName, setCustomSecretName] = useState("")
  const skipSecretNames = useMemo(() => new Set(["admin_password_hash", "tailscale_auth_key"]), [])
  const requiredSpecs = useMemo(
    () => (props.secretsPlan?.required || []).filter((spec) => !skipSecretNames.has(spec.name)),
    [props.secretsPlan, skipSecretNames],
  )
  const optionalSpecs = useMemo(
    () => (props.secretsPlan?.optional || []).filter((spec) => !skipSecretNames.has(spec.name)),
    [props.secretsPlan, skipSecretNames],
  )
  const allowedSecretNames = useMemo(() => {
    const names = new Set<string>()
    for (const spec of requiredSpecs) names.add(spec.name)
    for (const spec of optionalSpecs) names.add(spec.name)
    return names
  }, [requiredSpecs, optionalSpecs])
  const specsByName = useMemo(() => {
    const map = new Map<string, SecretSpec>()
    for (const spec of [...requiredSpecs, ...optionalSpecs]) map.set(spec.name, spec)
    return map
  }, [requiredSpecs, optionalSpecs])
  const groupedRequired = useMemo(() => {
    const channel: SecretSpec[] = []
    const model: SecretSpec[] = []
    const host: SecretSpec[] = []
    const custom: SecretSpec[] = []
    for (const spec of requiredSpecs) {
      if (spec.scope === "host") host.push(spec)
      else if (spec.source === "channel") channel.push(spec)
      else if (spec.source === "model" || spec.source === "provider") model.push(spec)
      else custom.push(spec)
    }
    const byName = (a: SecretSpec, b: SecretSpec) => a.name.localeCompare(b.name)
    return {
      channel: channel.sort(byName),
      model: model.sort(byName),
      host: host.sort(byName),
      custom: custom.sort(byName),
    }
  }, [requiredSpecs])

  const copyEnvVar = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("Clipboard unavailable")
      return
    }
    try {
      await navigator.clipboard.writeText(trimmed)
      toast.success(`Copied ${trimmed}`)
    } catch {
      toast.error("Copy failed")
    }
  }

  const addCustomSecret = () => {
    const name = customSecretName.trim()
    if (!name) return
    if (allowedSecretNames.has(name)) {
      toast.info("Secret already in plan")
      setCustomSecretName("")
      return
    }
    if (props.customSecretNames.includes(name)) {
      toast.info("Custom secret already added")
      setCustomSecretName("")
      return
    }
    const next = [...props.customSecretNames, name].sort()
    props.setCustomSecretNames(next)
    props.setSecrets((prev) => ({ ...prev, [name]: prev[name] || "" }))
    setCustomSecretName("")
  }

  const SecretRow = ({ name }: { name: string }) => {
    const spec = specsByName.get(name)
    const placeholder = props.secretsTemplate[name] || "<REPLACE_WITH_SECRET>"
    const isMultiline = placeholder === "<REPLACE_WITH_NETRC>" || name.includes("netrc")
    return (
      <div key={name} className="grid gap-2 md:grid-cols-[220px_1fr] items-center">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="truncate max-w-[180px]">{name}</span>
          {spec?.envVars?.length ? (
            <div className="flex flex-wrap items-center gap-1">
              {spec.envVars.map((envVar) => (
                <Button
                  key={envVar}
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => void copyEnvVar(envVar)}
                  title={`Copy ${envVar}`}
                >
                  {envVar}
                </Button>
              ))}
            </div>
          ) : null}
          {spec?.help ? (
            <HelpTooltip title={name} side="top">
              {spec.help}
            </HelpTooltip>
          ) : (
            <HelpTooltip title={name} side="top">
              {setupFieldHelp.secrets.extraSecret}
            </HelpTooltip>
          )}
        </div>
        {isMultiline ? (
          <Textarea
            value={props.secrets[name] || ""}
            onChange={(e) => props.setSecrets((prev) => ({ ...prev, [name]: e.target.value }))}
            aria-label={`secret ${name}`}
            placeholder={placeholder}
            rows={3}
            className="font-mono text-xs"
          />
        ) : (
          <Input
            type="password"
            value={props.secrets[name] || ""}
            onChange={(e) => props.setSecrets((prev) => ({ ...prev, [name]: e.target.value }))}
            aria-label={`secret ${name}`}
            placeholder={placeholder}
          />
        )}
      </div>
    )
  }

  const renderGroup = (label: string, specs: SecretSpec[]) => {
    if (!specs.length) return null
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="grid gap-3">
          {specs.map((spec) => (
            <SecretRow key={spec.name} name={spec.name} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <LabelWithHelp help={setupFieldHelp.secrets.extraSecret}>
          Secrets
        </LabelWithHelp>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Advanced</span>
          <Switch checked={props.advancedMode} onCheckedChange={props.setAdvancedMode} />
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Values are written to encrypted YAML in <code>secrets/hosts/{props.host}</code>.
      </div>
      <div className="grid gap-4">
        {!requiredSpecs.length && !optionalSpecs.length && !props.customSecretNames.length ? (
          <div className="text-muted-foreground text-sm">No secrets.</div>
        ) : (
          <>
            {renderGroup("Host", groupedRequired.host)}
            {renderGroup("Channel", groupedRequired.channel)}
            {renderGroup("Model Provider", groupedRequired.model)}
            {renderGroup("Custom", groupedRequired.custom)}
          </>
        )}

        {optionalSpecs.length && !props.advancedMode ? (
          <div className="text-xs text-muted-foreground">
            Optional secrets available in Advanced mode.
          </div>
        ) : null}

        {props.advancedMode ? (
          <>
            {renderGroup("Advanced", optionalSpecs)}
            {props.customSecretNames.length ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom secrets</div>
                <div className="grid gap-3">
                  {props.customSecretNames.map((name) => (
                    <SecretRow key={name} name={name} />
                  ))}
                </div>
              </div>
            ) : null}
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add custom secret</div>
              <div className="grid gap-2 md:grid-cols-[220px_1fr] items-center">
                <Input
                  value={customSecretName}
                  onChange={(e) => setCustomSecretName(e.target.value)}
                  placeholder="CUSTOM_SECRET"
                />
                <Button type="button" variant="outline" onClick={addCustomSecret}>
                  Add secret
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Custom secrets are allowed only in Advanced mode and must be wired in fleet.secretEnv/secretFiles.
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
