import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import * as React from "react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { slugifyProjectName } from "~/lib/project-routing"

export type ProjectDoc = (typeof api.projects.list)["_returnType"][number]

export function useProjectsList() {
  return useQuery({
    ...convexQuery(api.projects.list, {}),
    gcTime: 5_000,
  })
}

export function useProjectBySlug(projectSlug: string | null) {
  const projectsQuery = useProjectsList()

  const project = React.useMemo(() => {
    if (!projectsQuery.data || !projectSlug) return null
    return projectsQuery.data.find(
      (item) => slugifyProjectName(item.name) === projectSlug,
    ) || null
  }, [projectSlug, projectsQuery.data])

  return {
    ...projectsQuery,
    project,
    projectId: (project?._id as Id<"projects"> | null) ?? null,
  }
}
