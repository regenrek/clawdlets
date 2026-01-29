import { createServerFn } from "@tanstack/react-start"
import type { ClawdbotSchemaLiveResult, ClawdbotSchemaStatusResult } from "~/server/clawdbot-schema.server"
import { parseProjectHostBotInput, parseProjectIdInput } from "~/sdk/serverfn-validators"
import { sanitizeErrorMessage } from "@clawdlets/core/lib/safe-error"

export const getClawdbotSchemaLive = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostBotInput)
  .handler(async ({ data }) => {
    try {
      const { fetchClawdbotSchemaLive } = await import("~/server/clawdbot-schema.server")
      return await fetchClawdbotSchemaLive({ projectId: data.projectId, host: data.host, botId: data.botId })
    } catch (err) {
      const message = sanitizeErrorMessage(err, "Unable to fetch schema. Check logs.")
      return { ok: false as const, message } satisfies ClawdbotSchemaLiveResult
    }
  })

export const getClawdbotSchemaStatus = createServerFn({ method: "POST" })
  .inputValidator(parseProjectIdInput)
  .handler(async ({ data }) => {
    try {
      const { fetchClawdbotSchemaStatus } = await import("~/server/clawdbot-schema.server")
      return await fetchClawdbotSchemaStatus({ projectId: data.projectId })
    } catch (err) {
      const message = sanitizeErrorMessage(err, "Unable to fetch schema status. Check logs.")
      return { ok: false as const, message } satisfies ClawdbotSchemaStatusResult
    }
  })

export type { ClawdbotSchemaLiveResult, ClawdbotSchemaStatusResult }
