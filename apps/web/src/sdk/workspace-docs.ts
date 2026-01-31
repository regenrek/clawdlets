import { createServerFn } from "@tanstack/react-start"
import type {
  WorkspaceDocReadResult,
  WorkspaceDocScope,
  WorkspaceDocWriteResult,
  WorkspaceDocWriteScope,
} from "~/sdk/workspace-docs-model"
import { parseProjectIdInput } from "~/sdk/serverfn-validators"

export const listWorkspaceDocs = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      botId: String(d["botId"] || ""),
    }
  })
  .handler(async ({ data }) => {
    const { listWorkspaceDocsServer } = await import("~/server/workspace-docs.server")
    return await listWorkspaceDocsServer(data)
  })

export const readWorkspaceDoc = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const scope = String(d["scope"] || "")
    if (scope !== "common" && scope !== "bot" && scope !== "effective") throw new Error("invalid scope")
    return {
      ...base,
      botId: typeof d["botId"] === "string" ? d["botId"] : "",
      scope: scope as WorkspaceDocScope,
      name: String(d["name"] || ""),
    }
  })
  .handler(async ({ data }): Promise<WorkspaceDocReadResult> => {
    const { readWorkspaceDocServer } = await import("~/server/workspace-docs.server")
    return await readWorkspaceDocServer(data)
  })

export const writeWorkspaceDoc = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const scope = String(d["scope"] || "")
    if (scope !== "common" && scope !== "bot") throw new Error("invalid scope")
    return {
      ...base,
      botId: typeof d["botId"] === "string" ? d["botId"] : "",
      scope: scope as WorkspaceDocWriteScope,
      name: String(d["name"] || ""),
      content: typeof d["content"] === "string" ? d["content"] : "",
      expectedSha256: typeof d["expectedSha256"] === "string" ? d["expectedSha256"] : "",
    }
  })
  .handler(async ({ data }): Promise<WorkspaceDocWriteResult> => {
    const { writeWorkspaceDocServer } = await import("~/server/workspace-docs.server")
    return await writeWorkspaceDocServer(data)
  })

export const resetWorkspaceDocOverride = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      botId: String(d["botId"] || ""),
      name: String(d["name"] || ""),
      expectedSha256: typeof d["expectedSha256"] === "string" ? d["expectedSha256"] : "",
    }
  })
  .handler(async ({ data }): Promise<WorkspaceDocWriteResult> => {
    const { resetWorkspaceDocOverrideServer } = await import("~/server/workspace-docs.server")
    return await resetWorkspaceDocOverrideServer(data)
  })
