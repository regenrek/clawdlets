import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { createConvexClient } from "~/server/convex"
import { runWithEvents } from "~/server/run-manager"
import { sanitizeErrorMessage } from "@clawdlets/core/lib/safe-error"

export type ValidationIssue = { code: string; path: Array<string | number>; message: string }

export function mapValidationIssues(issues: unknown[]): ValidationIssue[] {
  return issues.map((issue) => {
    const i = issue as { code?: unknown; path?: unknown; message?: unknown }
    return {
      code: String(i.code ?? "invalid"),
      path: Array.isArray(i.path) ? (i.path as Array<string | number>) : [],
      message: String(i.message ?? "Invalid"),
    }
  })
}

export async function runWithEventsAndStatus<T>(params: {
  client: ReturnType<typeof createConvexClient>
  runId: Id<"runs">
  redactTokens: string[]
  fn: (emit: (event: { level: "info" | "warn"; message: string }) => Promise<void>) => Promise<void>
  onSuccess: () => T
  onError?: (message: string) => T
  onAfterEvents?: () => Promise<void> | void
}): Promise<T> {
  try {
    await runWithEvents({
      client: params.client,
      runId: params.runId,
      redactTokens: params.redactTokens,
      fn: params.fn,
    })
    if (params.onAfterEvents) {
      try {
        await params.onAfterEvents()
      } catch (err) {
        const safeMessage = sanitizeErrorMessage(err, "post-run cleanup failed")
        const message = safeMessage === "post-run cleanup failed" ? safeMessage : `post-run cleanup failed: ${safeMessage}`
        try {
          await params.client.mutation(api.runEvents.appendBatch, {
            runId: params.runId,
            events: [{ ts: Date.now(), level: "warn", message }],
          })
        } catch {
          // ignore post-run event failures
        }
      }
    }
    await params.client.mutation(api.runs.setStatus, { runId: params.runId, status: "succeeded" })
    return params.onSuccess()
  } catch (err) {
    const safeMessage = sanitizeErrorMessage(err, "run failed")
    await params.client.mutation(api.runs.setStatus, { runId: params.runId, status: "failed", errorMessage: safeMessage })
    if (params.onError) return params.onError(safeMessage)
    throw new Error(safeMessage)
  }
}
