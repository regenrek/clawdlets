export type DoctorGateResult = { ok: boolean } | null | undefined

export function canBootstrapFromDoctorGate(params: {
  host: string
  force: boolean
  doctor: DoctorGateResult
}): boolean {
  if (!params.host.trim()) return false
  if (params.force) return true
  return Boolean(params.doctor?.ok)
}

