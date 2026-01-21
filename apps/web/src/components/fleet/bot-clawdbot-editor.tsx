import { useEffect, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { Textarea } from "~/components/ui/textarea"
import { setBotClawdbotConfig } from "~/sdk/bots"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function BotClawdbotEditor(props: {
  projectId: string
  botId: string
  initial: unknown
  canEdit: boolean
}) {
  const queryClient = useQueryClient()

  const initialText = useMemo(() => JSON.stringify(props.initial ?? {}, null, 2), [props.initial])
  const [text, setText] = useState(initialText)
  const [issues, setIssues] = useState<null | Array<{ path: string; message: string }>>(null)

  useEffect(() => {
    setText(initialText)
    setIssues(null)
  }, [initialText, props.botId])

  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(text)
      if (!isPlainObject(value)) return { ok: false as const, message: "Must be a JSON object (not array/string/number)." }
      return { ok: true as const, value }
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "Invalid JSON" }
    }
  }, [text])

  const save = useMutation({
    mutationFn: async () => {
      setIssues(null)
      if (!parsed.ok) throw new Error(parsed.message)
      return await setBotClawdbotConfig({
        data: {
          projectId: props.projectId as Id<"projects">,
          botId: props.botId,
          clawdbot: parsed.value,
        },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved clawdbot config")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", props.projectId] })
      } else {
        setIssues(
          (res.issues || []).map((i) => ({
            path: (i.path || []).map(String).join(".") || "(root)",
            message: i.message,
          })),
        )
        toast.error("Validation failed")
      }
    },
  })

  const format = () => {
    try {
      const value = JSON.parse(text)
      setText(`${JSON.stringify(value, null, 2)}\n`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid JSON")
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">Clawdbot config (JSON)</div>
          <div className="text-xs text-muted-foreground">
            Stored as <code>fleet.bots.{props.botId}.clawdbot</code>.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={format}>
            Format
          </Button>
          <Button type="button" disabled={!props.canEdit || save.isPending || !parsed.ok} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        spellCheck={false}
        className="font-mono text-xs"
        aria-label={`clawdbot config for ${props.botId}`}
        disabled={!props.canEdit}
      />

      {!parsed.ok ? <div className="text-sm text-destructive">{parsed.message}</div> : null}

      {issues && issues.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">Validation issues</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {issues.map((i, idx) => (
              <li key={`${idx}-${i.path}`}>
                <code>{i.path}</code>: {i.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

