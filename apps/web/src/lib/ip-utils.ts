import { z } from "zod"

const ipv4 = z.ipv4()
const ipv6 = z.ipv6()

export function singleHostCidrFromIp(input: string): string {
  const ip = input.trim()
  if (!ip) throw new Error("missing ip")
  if (ipv4.safeParse(ip).success) return `${ip}/32`
  if (ipv6.safeParse(ip).success) return `${ip}/128`
  throw new Error("invalid ip")
}
