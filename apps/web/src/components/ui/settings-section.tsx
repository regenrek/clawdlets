import type { ReactNode } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "~/components/ui/card"
import { cn } from "~/lib/utils"

interface SettingsSectionProps {
  title: string
  description?: ReactNode
  children: ReactNode
  statusText?: ReactNode
  actions?: ReactNode
  className?: string
}

export function SettingsSection({
  title,
  description,
  children,
  statusText,
  actions,
  className,
}: SettingsSectionProps) {
  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
      {(statusText || actions) && (
        <CardFooter className="justify-between gap-4">
          <div className="text-sm text-muted-foreground">{statusText}</div>
          <div className="flex items-center gap-2">{actions}</div>
        </CardFooter>
      )}
    </Card>
  )
}
