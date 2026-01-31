import type { Id } from "../../convex/_generated/dataModel"

export type WorkspaceDocScope = "common" | "bot" | "effective"

export type WorkspaceDocWriteScope = Exclude<WorkspaceDocScope, "effective">

export type WorkspaceDocListItem = {
  name: string
  hasDefault: boolean
  hasOverride: boolean
  effective: "default" | "override" | "missing"
}

export type WorkspaceDocReadResult = {
  ok: true
  exists: boolean
  content: string
  sha256: string
  pathRel: string
}

export type WorkspaceDocWriteResult =
  | { ok: true; runId?: Id<"runs"> }
  | { ok: false; code: "invalid" | "conflict"; message: string }
