"use client"

import * as React from "react"
import { QuestionMarkCircleIcon } from "@heroicons/react/24/outline"

import { cn } from "~/lib/utils"
import { Button } from "~/components/ui/button"
import { Label } from "~/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip"

type TooltipPlacement = Pick<
  React.ComponentProps<typeof TooltipContent>,
  "side" | "align" | "sideOffset" | "alignOffset"
>

function HelpTooltip({
  title,
  children,
  className,
  side = "top",
  align = "center",
  sideOffset = 6,
  alignOffset = 0,
}: {
  title: string
  children: React.ReactNode
  className?: string
} & TooltipPlacement) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(
              "size-6 text-muted-foreground hover:text-foreground",
              className,
            )}
            aria-label={`${title} help`}
          >
            <QuestionMarkCircleIcon />
          </Button>
        }
      />
      <TooltipContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <div className="space-y-0.5">
          <div className="font-medium">{title}</div>
          <div className="text-background/75">{children}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function LabelWithHelp({
  help,
  helpPlacement,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Label> & {
  help?: React.ReactNode
  helpPlacement?: TooltipPlacement
}) {
  if (!help) {
    return (
      <Label className={className} {...props}>
        {children}
      </Label>
    )
  }

  const title = typeof children === "string" ? children : "Help"

  return (
    <div className="flex items-center gap-1">
      <Label className={className} {...props}>
        {children}
      </Label>
      <HelpTooltip title={title} {...helpPlacement}>
        {help}
      </HelpTooltip>
    </div>
  )
}

export { HelpTooltip, LabelWithHelp }

