import type { Stack, StackHost } from "@clawdbot/clawdlets-core/stack";
import { needsSudo, requireTargetHost } from "../ssh-target.js";

export { needsSudo, requireTargetHost };

export function requireHost(stack: Stack, host: string): StackHost {
  const h = stack.hosts[host];
  if (!h) throw new Error(`unknown host: ${host}`);
  return h;
}
