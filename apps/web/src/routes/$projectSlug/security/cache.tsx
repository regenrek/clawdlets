import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { HostCacheSettingsSection } from "~/components/hosts/cache-settings-section"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { parseLineList } from "~/lib/form-utils"
import { useProjectBySlug } from "~/lib/project-data"
import { clawdletsConfigQueryOptions, projectsListQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"
import { writeClawdletsConfigFile } from "~/sdk/config"

function normalizeCache(cache: any): {
  substituters: string[]
  trustedPublicKeys: string[]
  netrc: { enable: boolean; secretName: string; path: string; narinfoCachePositiveTtl: number }
} {
  const c = cache && typeof cache === "object" ? cache : {}
  const netrc = c.netrc && typeof c.netrc === "object" ? c.netrc : {}
  return {
    substituters: Array.isArray(c.substituters) ? c.substituters.map(String) : [],
    trustedPublicKeys: Array.isArray(c.trustedPublicKeys) ? c.trustedPublicKeys.map(String) : [],
    netrc: {
      enable: Boolean(netrc.enable),
      secretName: typeof netrc.secretName === "string" ? netrc.secretName : "garnix_netrc",
      path: typeof netrc.path === "string" ? netrc.path : "/etc/nix/netrc",
      narinfoCachePositiveTtl: typeof netrc.narinfoCachePositiveTtl === "number" ? netrc.narinfoCachePositiveTtl : 3600,
    },
  }
}

export const Route = createFileRoute("/$projectSlug/security/cache")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    await context.queryClient.ensureQueryData(clawdletsConfigQueryOptions(projectId))
  },
  component: SecurityCache,
})

function SecurityCache() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const queryClient = useQueryClient()

  const cfg = useQuery({
    ...clawdletsConfigQueryOptions((projectId as Id<"projects"> | null) ?? null),
    enabled: Boolean(projectId),
  })

  const config = cfg.data?.config

  const hostCaches = useMemo(() => {
    const hosts = Object.entries(config?.hosts ?? {}).sort(([a], [b]) => a.localeCompare(b))
    return hosts.map(([host, hostCfg]) => ({
      host,
      cache: normalizeCache((hostCfg as any)?.cache),
    }))
  }, [config])

  const cacheDivergedHosts = useMemo(() => {
    const [first] = hostCaches
    if (!first) return []
    const base = JSON.stringify(first.cache)
    return hostCaches
      .filter((h) => JSON.stringify(h.cache) !== base)
      .map((h) => h.host)
      .filter((h) => h !== first.host)
  }, [hostCaches])

  const [cacheSubstitutersText, setCacheSubstitutersText] = useState("")
  const [cacheTrustedKeysText, setCacheTrustedKeysText] = useState("")
  const [cacheNetrcEnable, setCacheNetrcEnable] = useState(false)
  const [cacheNetrcSecretName, setCacheNetrcSecretName] = useState("garnix_netrc")
  const [cacheNetrcPath, setCacheNetrcPath] = useState("/etc/nix/netrc")
  const [cacheNarinfoCachePositiveTtl, setCacheNarinfoCachePositiveTtl] = useState("3600")

  useEffect(() => {
    const hosts = Object.entries(config?.hosts ?? {}).sort(([a], [b]) => a.localeCompare(b))
    const firstHostCfg = hosts[0]?.[1] ?? null
    if (!firstHostCfg) return
    const cache = normalizeCache((firstHostCfg as any).cache)
    setCacheSubstitutersText((cache.substituters || []).join("\n"))
    setCacheTrustedKeysText((cache.trustedPublicKeys || []).join("\n"))
    setCacheNetrcEnable(Boolean(cache.netrc.enable))
    setCacheNetrcSecretName(cache.netrc.secretName || "garnix_netrc")
    setCacheNetrcPath(cache.netrc.path || "/etc/nix/netrc")
    setCacheNarinfoCachePositiveTtl(String(cache.netrc.narinfoCachePositiveTtl || 3600))
  }, [config])

  const save = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("missing project")
      if (!config) throw new Error("config not loaded")

      const hostNames = Object.keys(config.hosts ?? {})
      if (hostNames.length === 0) throw new Error("no hosts found (add a host first)")

      const cacheSubstituters = parseLineList(cacheSubstitutersText)
      const cacheTrustedPublicKeys = parseLineList(cacheTrustedKeysText)
      if (cacheSubstituters.length === 0) throw new Error("Cache substituters must not be empty.")
      if (cacheTrustedPublicKeys.length === 0) throw new Error("Cache trusted public keys must not be empty.")

      const narinfoTtlRaw = cacheNarinfoCachePositiveTtl.trim()
      const narinfoTtl = Number(narinfoTtlRaw)
      if (!Number.isInteger(narinfoTtl) || narinfoTtl <= 0) throw new Error("Cache narinfo TTL must be a positive integer.")

      const netrcSecretName = cacheNetrcSecretName.trim()
      const netrcPath = cacheNetrcPath.trim()
      if (cacheNetrcEnable && !netrcSecretName) throw new Error("Cache netrc secret name is required when enabled.")
      if (cacheNetrcEnable && !netrcPath) throw new Error("Cache netrc path is required when enabled.")

      const cacheNext = {
        substituters: cacheSubstituters,
        trustedPublicKeys: cacheTrustedPublicKeys,
        netrc: {
          enable: cacheNetrcEnable,
          secretName: netrcSecretName,
          path: netrcPath,
          narinfoCachePositiveTtl: narinfoTtl,
        },
      }

      const nextHosts = { ...config.hosts }
      for (const host of hostNames) {
        nextHosts[host] = {
          ...nextHosts[host],
          cache: cacheNext,
        }
      }

      const next = {
        ...config,
        hosts: nextHosts,
      }

      return await writeClawdletsConfigFile({
        data: { projectId: projectId as Id<"projects">, next, title: "Update cache policy" },
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

  const hasHosts = Object.keys(config.hosts ?? {}).length > 0

  if (!hasHosts) {
    return <div className="text-muted-foreground">Add a host first to configure cache policy.</div>
  }

  return (
    <div className="space-y-6">
      {cacheDivergedHosts.length > 0 ? (
        <Alert className="border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-100">
          <AlertTitle>Hosts have different cache settings</AlertTitle>
          <AlertDescription>
            Saving here overwrites <code className="text-xs">hosts.*.cache</code> for all hosts. Diverged:{" "}
            <code className="text-xs">{cacheDivergedHosts.join(", ")}</code>
          </AlertDescription>
        </Alert>
      ) : null}

      <HostCacheSettingsSection
        host="*"
        saving={save.isPending}
        onSave={() => save.mutate()}
        substitutersText={cacheSubstitutersText}
        setSubstitutersText={setCacheSubstitutersText}
        trustedKeysText={cacheTrustedKeysText}
        setTrustedKeysText={setCacheTrustedKeysText}
        netrcEnable={cacheNetrcEnable}
        setNetrcEnable={setCacheNetrcEnable}
        netrcSecretName={cacheNetrcSecretName}
        setNetrcSecretName={setCacheNetrcSecretName}
        netrcPath={cacheNetrcPath}
        setNetrcPath={setCacheNetrcPath}
        narinfoCachePositiveTtl={cacheNarinfoCachePositiveTtl}
        setNarinfoCachePositiveTtl={setCacheNarinfoCachePositiveTtl}
      />
    </div>
  )
}
