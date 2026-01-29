export type IdleDebounceHandle = {
  schedule: () => void
  cancel: () => void
}

type IdleCallback = () => void

type IdleWindow = Window & {
  requestIdleCallback?: (cb: IdleCallback, opts?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

export function createDebouncedIdleRunner(params: {
  fn: IdleCallback
  delayMs?: number
  timeoutMs?: number
}): IdleDebounceHandle {
  let handle: { cancel: () => void } | null = null
  const delayMs = params.delayMs ?? 400
  const timeoutMs = params.timeoutMs ?? 1000

  const schedule = () => {
    const w = window as IdleWindow
    if (handle) handle.cancel()
    const timer = window.setTimeout(() => {
      if (typeof w.requestIdleCallback === "function") {
        const id = w.requestIdleCallback(params.fn, { timeout: timeoutMs })
        handle = { cancel: () => w.cancelIdleCallback?.(id) }
        return
      }
      params.fn()
    }, delayMs)
    handle = { cancel: () => window.clearTimeout(timer) }
  }

  const cancel = () => {
    if (handle) handle.cancel()
    handle = null
  }

  return { schedule, cancel }
}
