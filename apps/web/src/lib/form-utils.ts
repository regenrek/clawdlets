export function looksLikeSshPublicKeyText(value: string): boolean {
  const s = String(value || "").trim()
  if (!s) return false
  const firstLine = s.split(/\r?\n/)[0] || ""
  const tokens = firstLine.trim().split(/\s+/)
  if (tokens.length < 2) return false
  const [type, base64] = tokens
  if (!type) return false
  if (!type.startsWith("ssh-") && !type.includes("ssh")) return false
  if (!base64) return false
  if (!/^[A-Za-z0-9+/]+={0,3}$/.test(base64)) return false
  return true
}

export function looksLikeSshPrivateKeyText(value: string): boolean {
  const s = String(value || "").trimStart()
  if (!s.startsWith("-----BEGIN ")) return false
  return (
    s.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")
    || s.startsWith("-----BEGIN RSA PRIVATE KEY-----")
    || s.startsWith("-----BEGIN PRIVATE KEY-----")
  )
}

export function parseLineList(value: string): string[] {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return Array.from(new Set(lines))
}

