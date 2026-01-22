import * as React from "react"
import { useRouter, useRouterState } from "@tanstack/react-router"

type HostSelectionArgs = {
  hosts: string[]
  defaultHost?: string | null
  mode?: "required" | "optional"
}

type HostSelection = {
  host: string
  hostParam: string
  hosts: string[]
  setHostParam: (next: string | null, opts?: { replace?: boolean }) => void
  isFallback: boolean
}

function normalizeHosts(hosts: string[]) {
  return hosts.map((h) => h.trim()).filter(Boolean).sort()
}

export function useHostSelection({
  hosts,
  defaultHost,
  mode = "required",
}: HostSelectionArgs): HostSelection {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const search = useRouterState({ select: (s) => s.location.search })

  const hostParam = React.useMemo(() => {
    const params = new URLSearchParams(search)
    return params.get("host")?.trim() || ""
  }, [search])

  const normalizedHosts = React.useMemo(() => normalizeHosts(hosts), [hosts])
  const fallback =
    defaultHost && normalizedHosts.includes(defaultHost)
      ? defaultHost
      : normalizedHosts[0] || ""
  const isOptional = mode === "optional"
  const resolvedHost = isOptional
    ? hostParam && normalizedHosts.includes(hostParam)
      ? hostParam
      : ""
    : hostParam && normalizedHosts.includes(hostParam)
      ? hostParam
      : fallback
  const needsCanonicalParam = !isOptional && Boolean(resolvedHost && hostParam !== resolvedHost)

  const setHostParam = React.useCallback(
    (next: string | null, opts?: { replace?: boolean }) => {
      void router.navigate({
        to: pathname,
        search: (prev: Record<string, unknown>) => {
          const nextSearch = { ...(prev || {}) } as Record<string, unknown>
          const value = next?.trim()
          if (value) nextSearch.host = value
          else delete nextSearch.host
          return nextSearch
        },
        replace: opts?.replace ?? false,
      } as any)
    },
    [pathname, router],
  )

  React.useEffect(() => {
    if (!needsCanonicalParam) return
    setHostParam(resolvedHost, { replace: true })
  }, [needsCanonicalParam, resolvedHost, setHostParam])

  return {
    host: resolvedHost,
    hostParam,
    hosts: normalizedHosts,
    setHostParam,
    isFallback: needsCanonicalParam,
  }
}
