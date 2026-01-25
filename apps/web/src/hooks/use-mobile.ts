import * as React from "react"

const MOBILE_BREAKPOINT = 768

const getSnapshot = () => {
  if (typeof window === "undefined") {
    return false
  }

  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches
}

const subscribe = (callback: () => void) => {
  if (typeof window === "undefined") {
    return () => {}
  }

  const mediaQuery = window.matchMedia(
    `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
  )
  const handler = () => callback()

  mediaQuery.addEventListener("change", handler)
  return () => mediaQuery.removeEventListener("change", handler)
}

function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export { useIsMobile }
