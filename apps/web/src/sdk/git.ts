import { createServerFn } from "@tanstack/react-start"
import { parseProjectIdInput } from "~/sdk/serverfn-validators"

export const gitRepoStatus = createServerFn({ method: "POST" })
  .inputValidator(parseProjectIdInput)
  .handler(async ({ data }) => {
    const { fetchGitRepoStatus } = await import("~/server/git.server")
    return await fetchGitRepoStatus({ projectId: data.projectId })
  })

export const gitPushExecute = createServerFn({ method: "POST" })
  .inputValidator(parseProjectIdInput)
  .handler(async ({ data }) => {
    const { executeGitPush } = await import("~/server/git.server")
    return await executeGitPush({ projectId: data.projectId })
  })
