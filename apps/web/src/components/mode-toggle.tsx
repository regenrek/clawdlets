import { ClientOnly } from "@tanstack/react-router"
import { useTheme } from "~/components/theme-provider"
import { Sun01Icon, Moon02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

function ModeToggleInner() {
  const { theme, setTheme } = useTheme()
  const next = theme === "light" ? "dark" : "light"

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="inline-flex items-center justify-center size-9 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
      aria-label={`Switch to ${next} mode`}
    >
      {theme === "light" ? (
        <HugeiconsIcon icon={Sun01Icon} className="size-5" />
      ) : (
        <HugeiconsIcon icon={Moon02Icon} className="size-5" />
      )}
    </button>
  )
}

export function ModeToggle() {
  return (
    <ClientOnly
      fallback={
        <button
          type="button"
          className="inline-flex items-center justify-center size-9 rounded-md"
        >
          <HugeiconsIcon icon={Sun01Icon} className="size-5" />
        </button>
      }
    >
      <ModeToggleInner />
    </ClientOnly>
  )
}
