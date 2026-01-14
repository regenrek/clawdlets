import process from "node:process";
import { collectDoctorChecks } from "@clawdbot/clawdlets-core/doctor";
import { renderDoctorGateFailure } from "./doctor-render.js";

export async function requireDeployGate(params: {
  runtimeDir?: string;
  envFile?: string;
  host: string;
  scope: "deploy" | "repo";
  strict: boolean;
  skipGithubTokenCheck?: boolean;
}): Promise<void> {
  const checks = await collectDoctorChecks({
    cwd: process.cwd(),
    runtimeDir: params.runtimeDir,
    envFile: params.envFile,
    host: params.host,
    scope: params.scope,
    skipGithubTokenCheck: params.skipGithubTokenCheck,
  });

  const missing = checks.filter((c) => c.status === "missing");
  const warn = checks.filter((c) => c.status === "warn");

  const failed = missing.length > 0 || (params.strict && warn.length > 0);
  if (!failed) return;

  throw new Error(renderDoctorGateFailure({ checks, scope: params.scope, strict: params.strict }));
}
