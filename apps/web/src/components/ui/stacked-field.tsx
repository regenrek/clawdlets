"use client"

import type * as React from "react"
import { cn } from "~/lib/utils"
import { Field } from "~/components/ui/field"
import { LabelWithHelp } from "~/components/ui/label-help"

type StackedFieldProps = {
  id?: string
  label: string
  help?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function StackedField({
  id,
  label,
  help,
  description,
  actions,
  className,
  children,
}: StackedFieldProps) {
  return (
    <Field className={cn("gap-2", className)}>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <LabelWithHelp htmlFor={id} help={help} className="text-sm font-medium">
            {label}
          </LabelWithHelp>
          {actions ? <div className="flex flex-wrap items-center gap-1">{actions}</div> : null}
        </div>
        {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      </div>
      {children}
    </Field>
  )
}
