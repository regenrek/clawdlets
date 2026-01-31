import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SettingsSection } from "~/components/ui/settings-section"
import { Switch } from "~/components/ui/switch"
import { Textarea } from "~/components/ui/textarea"
import { setupFieldHelp } from "~/lib/setup-field-help"

export function HostCacheSettingsSection(props: {
  host: string
  saving: boolean
  onSave: () => void
  substitutersText: string
  setSubstitutersText: (v: string) => void
  trustedKeysText: string
  setTrustedKeysText: (v: string) => void
  netrcEnable: boolean
  setNetrcEnable: (v: boolean) => void
  netrcSecretName: string
  setNetrcSecretName: (v: string) => void
  netrcPath: string
  setNetrcPath: (v: string) => void
  narinfoCachePositiveTtl: string
  setNarinfoCachePositiveTtl: (v: string) => void
}) {
  const cachePath = props.host === "*" ? "hosts.*.cache" : `hosts.${props.host}.cache`
  return (
    <SettingsSection
      title="Nix Cache"
      description={
        <>
          Stored in <code className="text-xs">{cachePath}</code>
          {props.host === "*" ? " (applies to all hosts)" : null}
        </>
      }
      actions={<Button disabled={props.saving} onClick={props.onSave}>Save</Button>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <LabelWithHelp htmlFor="cacheSubstituters" help={setupFieldHelp.hosts.cacheSubstituters}>
            Substituters (one per line)
          </LabelWithHelp>
          <Textarea
            id="cacheSubstituters"
            value={props.substitutersText}
            onChange={(e) => props.setSubstitutersText(e.target.value)}
            placeholder={"https://cache.nixos.org\nhttps://cache.garnix.io"}
          />
        </div>
        <div className="space-y-2">
          <LabelWithHelp htmlFor="cacheTrustedKeys" help={setupFieldHelp.hosts.cacheTrustedPublicKeys}>
            Trusted public keys (one per line)
          </LabelWithHelp>
          <Textarea
            id="cacheTrustedKeys"
            value={props.trustedKeysText}
            onChange={(e) => props.setTrustedKeysText(e.target.value)}
            placeholder={"cache.nixos.org-1:...\ncache.garnix.io:..."}
          />
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">Authenticated cache (netrc)</div>
            <div className="text-sm text-muted-foreground">
              Enables <code className="text-xs">netrc-file</code> and <code className="text-xs">narinfo-cache-positive-ttl</code>.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LabelWithHelp htmlFor="cacheNetrcEnable" help={setupFieldHelp.hosts.cacheNetrcEnable}>
              Enabled
            </LabelWithHelp>
            <Switch id="cacheNetrcEnable" checked={props.netrcEnable} onCheckedChange={props.setNetrcEnable} />
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <LabelWithHelp htmlFor="cacheNetrcSecretName" help={setupFieldHelp.hosts.cacheNetrcSecretName}>
              netrc secret name
            </LabelWithHelp>
            <Input
              id="cacheNetrcSecretName"
              value={props.netrcSecretName}
              onChange={(e) => props.setNetrcSecretName(e.target.value)}
              placeholder="garnix_netrc"
              disabled={!props.netrcEnable}
            />
          </div>
          <div className="space-y-2">
            <LabelWithHelp htmlFor="cacheNetrcPath" help={setupFieldHelp.hosts.cacheNetrcPath}>
              netrc path
            </LabelWithHelp>
            <Input
              id="cacheNetrcPath"
              value={props.netrcPath}
              onChange={(e) => props.setNetrcPath(e.target.value)}
              placeholder="/etc/nix/netrc"
              disabled={!props.netrcEnable}
            />
          </div>
          <div className="space-y-2">
            <LabelWithHelp htmlFor="cacheNarinfoTtl" help={setupFieldHelp.hosts.cacheNarinfoCachePositiveTtl}>
              narinfo TTL (seconds)
            </LabelWithHelp>
            <Input
              id="cacheNarinfoTtl"
              value={props.narinfoCachePositiveTtl}
              onChange={(e) => props.setNarinfoCachePositiveTtl(e.target.value)}
              placeholder="3600"
              disabled={!props.netrcEnable}
            />
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}
