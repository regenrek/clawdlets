import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import * as React from "react"
import { useConvexAuth } from "convex/react"
import { api } from "../../convex/_generated/api"
import { pickLastActiveProject, readLastProjectSlug, slugifyProjectName, storeLastProjectSlug } from "~/lib/project-routing"
import { authClient } from "~/lib/auth-client"

export const Route = createFileRoute("/")({
  component: RootIndex,
})

function RootIndex() {
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const canQuery = Boolean(session?.user?.id) && isAuthenticated && !isPending && !isLoading
  const projectsQuery = useQuery({
    ...convexQuery(api.projects.list, {}),
    gcTime: 5_000,
    enabled: canQuery,
  })

  React.useEffect(() => {
    if (!projectsQuery.data || !canQuery) return
    const projects = projectsQuery.data
    const stored = readLastProjectSlug()
    const storedProject = stored
      ? projects.find((project) => slugifyProjectName(project.name) === stored)
      : null
    const next = storedProject || pickLastActiveProject(projects)
    if (!next) {
      void router.navigate({
        to: "/projects",
        replace: true,
      })
      return
    }
    const projectSlug = slugifyProjectName(next.name)
    storeLastProjectSlug(projectSlug)
    void router.navigate({
      to: "/$projectSlug",
      params: { projectSlug },
      replace: true,
    })
  }, [canQuery, projectsQuery.data, router])

  return <div className="text-muted-foreground">Loading…</div>
}
