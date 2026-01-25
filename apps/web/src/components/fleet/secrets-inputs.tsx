import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react"
import { toast } from "sonner"
import type { SecretsPlanWarning } from "@clawdlets/core/lib/secrets-plan"
import { Button } from "~/components/ui/button"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SecretInput } from "~/components/ui/secret-input"
import { StackedField } from "~/components/ui/stacked-field"
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
  warnings?: SecretsPlanWarning[]
}

export type SecretStatus = {
  status: "ok" | "missing" | "warn"
  detail?: string
}

type SecretsInputsProps = {
  host: string
  secrets: Record<string, string>
  setSecrets: Dispatch<SetStateAction<Record<string, string>>>
  secretsTemplate: Record<string, string>
  secretsPlan: SecretsPlan | null
  secretStatusByName?: Record<string, SecretStatus>
}

export function SecretsInputs(props: SecretsInputsProps) {
  const [unlockedSecrets, setUnlockedSecrets] = useState<Record<string, boolean>>({})
  const skipSecretNames = useMemo(() => new Set(["admin_password_hash", "tailscale_auth_key"]), [])
  const requiredSpecs = useMemo(
    () => (props.secretsPlan?.required || []).filter((spec) => !skipSecretNames.has(spec.name)),
    [props.secretsPlan, skipSecretNames],
  )
  const optionalSpecs = useMemo(
    () => (props.secretsPlan?.optional || []).filter((spec) => !skipSecretNames.has(spec.name)),
    [props.secretsPlan, skipSecretNames],
  )
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

  useEffect(() => {
    setUnlockedSecrets({})
  }, [props.host])

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

  const SecretRow = ({ name }: { name: string }) => {
    const spec = specsByName.get(name)
    const placeholder = props.secretsTemplate[name] || "<REPLACE_WITH_SECRET>"
    const isMultiline = placeholder === "<REPLACE_WITH_NETRC>" || name.includes("netrc")
    const status = props.secretStatusByName?.[name]
    const isLocked = status?.status === "ok" && !unlockedSecrets[name]
    const effectivePlaceholder = isLocked ? "set (click Remove to edit)" : placeholder
    const help = spec?.help ?? setupFieldHelp.secrets.extraSecret
    return (
      <StackedField
        id={name}
        label={name}
        help={help}
        actions={
          spec?.envVars?.length ? (
            <>
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
            </>
          ) : null
        }
      >
        <SecretInput
          id={name}
          value={props.secrets[name] || ""}
          onValueChange={(value) => props.setSecrets((prev) => ({ ...prev, [name]: value }))}
          ariaLabel={`secret ${name}`}
          placeholder={effectivePlaceholder}
          locked={isLocked}
          onUnlock={() => setUnlockedSecrets((prev) => ({ ...prev, [name]: true }))}
          multiline={isMultiline}
          rows={isMultiline ? 3 : undefined}
          inputClassName={isMultiline ? "font-mono text-xs" : undefined}
        />
      </StackedField>
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
      </div>
      <div className="text-xs text-muted-foreground">
        Values are written to encrypted YAML in <code>secrets/hosts/{props.host}</code>.
      </div>
      <div className="grid gap-4">
        {!requiredSpecs.length && !optionalSpecs.length ? (
          <div className="text-muted-foreground text-sm">No secrets.</div>
        ) : (
          <>
            {renderGroup("Host", groupedRequired.host)}
            {renderGroup("Channel", groupedRequired.channel)}
            {renderGroup("Model Provider", groupedRequired.model)}
            {renderGroup("Custom", groupedRequired.custom)}
            {renderGroup("Optional", optionalSpecs)}
          </>
        )}
      </div>
    </div>
  )
}
