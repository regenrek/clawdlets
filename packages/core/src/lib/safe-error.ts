const SAFE_ERROR_PATTERNS: RegExp[] = [
  /^invalid projectid$/i,
  /^sign-in required$/i,
  /^project access denied$/i,
  /^admin required$/i,
  /^too many requests$/i,
  /^run not running$/i,
  /^run kind mismatch/i,
  /^missing host$/i,
  /^unknown host:/i,
  /^unknown bot:/i,
  /^invalid target host:/i,
  /^missing targethost /i,
  /^invalid gateway port /i,
  /^schema payload missing required fields$/i,
  /^missing schema markers in output$/i,
  /^empty schema payload in output$/i,
  /^schema payload too large$/i,
  /^detached head/i,
  /^unknown branch/i,
  /^missing origin remote/i,
  /^cannot push/i,
  /^git push failed$/i,
]

export function sanitizeErrorMessage(err: unknown, fallback: string): string {
  const candidates: string[] = []

  if (err && typeof err === "object") {
    const data = (err as any).data
    const dataMessage = data && typeof data === "object" ? (data as any).message : null
    if (typeof dataMessage === "string") candidates.push(dataMessage)
  }

  if (err instanceof Error && typeof err.message === "string") candidates.push(err.message)
  candidates.push(String(err))

  for (const candidate of candidates) {
    const raw = candidate.trim()
    if (!raw) continue
    for (const re of SAFE_ERROR_PATTERNS) {
      if (re.test(raw)) return raw
    }
  }
  return fallback
}
