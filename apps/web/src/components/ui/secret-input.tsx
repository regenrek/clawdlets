"use client"

import type * as React from "react"
import { cn } from "~/lib/utils"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupTextarea } from "~/components/ui/input-group"

type SecretInputProps = {
  id?: string
  value: string
  onValueChange: (value: string) => void
  locked?: boolean
  placeholder?: string
  type?: React.ComponentProps<"input">["type"]
  multiline?: boolean
  rows?: number
  ariaLabel?: string
  className?: string
  inputClassName?: string
  onUnlock?: () => void
  unlockLabel?: string
}

export function SecretInput({
  id,
  value,
  onValueChange,
  locked = false,
  placeholder,
  type = "password",
  multiline = false,
  rows,
  ariaLabel,
  className,
  inputClassName,
  onUnlock,
  unlockLabel = "Remove",
}: SecretInputProps) {
  const showUnlock = locked && onUnlock
  return (
    <InputGroup className={cn(multiline ? "h-auto" : undefined, className)}>
      {multiline ? (
        <InputGroupTextarea
          id={id}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          aria-label={ariaLabel}
          className={inputClassName}
          disabled={locked}
        />
      ) : (
        <InputGroupInput
          id={id}
          type={type}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={inputClassName}
          disabled={locked}
        />
      )}
      {showUnlock ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton onClick={onUnlock}>
            {unlockLabel}
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}
