import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Link } from "@tanstack/react-router"

import type { Id } from "../../../convex/_generated/dataModel"
import { Trash2Icon } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "~/components/ui/alert-dialog"
import { Avatar, AvatarFallback } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "~/components/ui/item"
import { removeBot } from "~/sdk/config"

export function BotRoster(props: {
  projectSlug: string
  host: string
  projectId: string
  bots: string[]
  config: any
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const rmBotMutation = useMutation({
    mutationFn: async (bot: string) =>
      await removeBot({ data: { projectId: props.projectId as Id<"projects">, bot } }),
    onSuccess: () => {
      toast.success("Bot removed")
      void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", props.projectId] })
    },
  })

  if (props.bots.length === 0) {
    return <div className="text-muted-foreground">No bots yet.</div>
  }

  return (
    <div className="w-full rounded-lg border bg-card">
      <ItemGroup className="gap-0">
        {props.bots.map((botId) => {
          const botCfg = (props.config?.fleet?.bots as any)?.[botId] || {}
          const clawdbotCfg = botCfg?.clawdbot || {}
          const channels =
            clawdbotCfg?.channels && typeof clawdbotCfg.channels === "object" && !Array.isArray(clawdbotCfg.channels)
              ? Object.keys(clawdbotCfg.channels).sort()
              : []
          const channelsLabel =
            channels.length === 0
              ? "(none)"
              : channels.length <= 4
                ? channels.join(", ")
                : `${channels.slice(0, 4).join(", ")} (+${channels.length - 4})`

          return (
            <div key={botId} className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0">
              <Item variant="default" className="border-0 rounded-none px-0 py-0 flex-1">
                <ItemMedia>
                  <Avatar>
                    <AvatarFallback>{botId.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent className="gap-0">
                  <ItemTitle className="text-base">
                    <Link
                      to="/$projectSlug/hosts/$host/agents/$botId/overview"
                      params={{ projectSlug: props.projectSlug, host: props.host, botId }}
                      className="hover:underline"
                    >
                      {botId}
                    </Link>
                  </ItemTitle>
                  <ItemDescription className="text-xs">
                    channels: <code>{channelsLabel}</code>
                  </ItemDescription>
                </ItemContent>
              </Item>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button size="sm" variant="destructive" type="button" disabled={!props.canEdit}>
                      <Trash2Icon />
                      Remove
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove bot?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes <code>{botId}</code> from the roster and config.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => rmBotMutation.mutate(botId)}>
                      <Trash2Icon />
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )
        })}
      </ItemGroup>
    </div>
  )
}
