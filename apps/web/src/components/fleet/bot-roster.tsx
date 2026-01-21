import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { Id } from "../../../convex/_generated/dataModel"
import { Trash2Icon } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "~/components/ui/alert-dialog"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { Avatar, AvatarFallback } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "~/components/ui/item"
import { removeBot } from "~/sdk/config"
import { BotClawdbotEditor } from "./bot-clawdbot-editor"
import { BotWorkspaceDocs } from "./bot-workspace-docs"

export function BotRoster(props: {
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
    <Accordion multiple className="w-full rounded-lg border bg-card">
      <ItemGroup className="gap-0">
        {props.bots.map((botId) => {
          const botCfg = (props.config?.fleet?.bots as any)?.[botId] || {}
          const discordSecret = botCfg?.profile?.discordTokenSecret || ""
          const clawdbotCfg = botCfg?.clawdbot || {}

          return (
            <AccordionItem
              key={botId}
              value={botId}
              className="px-4"
            >
              <AccordionTrigger
                className="rounded-none border-0 px-0 py-0 hover:no-underline items-center"
              >
                <Item variant="default" className="border-0 rounded-none px-0 py-3 flex-1">
                  <ItemMedia>
                    <Avatar>
                      <AvatarFallback>{botId.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  </ItemMedia>
                  <ItemContent className="gap-0">
	                    <ItemTitle className="text-base">{botId}</ItemTitle>
	                    <ItemDescription className="text-xs">
	                      discordTokenSecret: <code>{discordSecret || "(unset)"}</code>
	                    </ItemDescription>
                  </ItemContent>
                </Item>
              </AccordionTrigger>

              <AccordionContent className="pb-4">
                <div className="space-y-6">
                  <BotClawdbotEditor
                    projectId={props.projectId}
                    botId={botId}
                    initial={clawdbotCfg}
                    canEdit={props.canEdit}
                  />
	                  <BotWorkspaceDocs
	                    projectId={props.projectId}
	                    botId={botId}
	                    canEdit={props.canEdit}
	                  />
	                  <div className="flex items-center justify-end border-t pt-4">
	                    <AlertDialog>
	                      <AlertDialogTrigger
	                        render={
	                          <Button size="sm" variant="destructive" type="button" disabled={!props.canEdit}>
	                            <Trash2Icon />
	                            Remove bot
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
	                </div>
	              </AccordionContent>
	            </AccordionItem>
	          )
	        })}
      </ItemGroup>
    </Accordion>
  )
}
