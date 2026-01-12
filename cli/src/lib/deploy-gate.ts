import process from "node:process";
import { collectDoctorChecks } from "@clawdbot/clawdlets-core/doctor";

export async function requireDeployGate(params: {
  runtimeDir?: string;
  host: string;
  scope: "deploy" | "repo";
  strict: boolean;
}): Promise<void> {
  const checks = await collectDoctorChecks({
    cwd: process.cwd(),
    runtimeDir: params.runtimeDir,
    host: params.host,
    scope: params.scope,
  });

  const missing = checks.filter((c) => c.status === "missing");
  const warn = checks.filter((c) => c.status === "warn");

  const failed = missing.length > 0 || (params.strict && warn.length > 0);
  if (!failed) return;

  const summarize = (xs: typeof checks, limit = 6) =>
    xs.slice(0, limit).map((c) => `${c.scope} ${c.status}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`);

  const lines = [
    `doctor gate failed (${params.scope}${params.strict ? ", strict" : ""})`,
    ...summarize(missing),
    ...(params.strict ? summarize(warn).map((l) => `warn: ${l}`) : []),
    `hint: run clawdlets doctor --scope ${params.scope}${params.strict ? " --strict" : ""}`,
  ];

  throw new Error(lines.join("\n"));
}
