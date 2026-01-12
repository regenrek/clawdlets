import { validateTargetHost } from "@clawdbot/clawdlets-core/lib/ssh-remote";

export function needsSudo(targetHost: string): boolean {
  return !/^root@/i.test(targetHost.trim());
}

export function requireTargetHost(targetHost: string, hostName: string): string {
  const v = targetHost.trim();
  if (v) return validateTargetHost(v);
  throw new Error(
    [
      `missing target host for ${hostName}`,
      "set it in .clawdlets/stack.json (hosts.<host>.targetHost) or pass --target-host",
      "recommended: use an SSH config alias (e.g. botsmj)",
    ].join("; "),
  );
}
