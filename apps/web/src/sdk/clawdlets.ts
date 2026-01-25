import { createServerFn } from "@tanstack/react-start"

export type { ClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config"
export type { SshExposureMode, TailnetMode } from "@clawdlets/core/lib/clawdlets-config"
export { BotIdSchema, HostNameSchema } from "@clawdlets/shared/lib/identifiers"

export type ValidationIssue = {
  code: string
  path: Array<string | number>
  message: string
}

export const validateClawdletsConfig = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): unknown => data)
  .handler(async ({ data }) => {
    const { ClawdletsConfigSchema } = await import(
      "@clawdlets/core/lib/clawdlets-config"
    )
    const parsed = ClawdletsConfigSchema.safeParse(data)

    if (parsed.success) {
      return { ok: true as const }
    }

    return {
      ok: false as const,
      issues: (parsed.error.issues as unknown[]).map((issue) => {
        const i = issue as { code?: unknown; path?: unknown; message?: unknown }
        return {
          code: String(i.code ?? "invalid"),
          path: Array.isArray(i.path) ? (i.path as Array<string | number>) : [],
          message: String(i.message ?? "Invalid config"),
        } satisfies ValidationIssue
      }),
    }
  })
