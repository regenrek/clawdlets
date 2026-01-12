import process from "node:process";
import { defineCommand } from "citty";
import { collectDoctorChecks } from "@clawdbot/clawdlets-core/doctor";
import { resolveHostNameOrExit } from "../lib/host-resolve.js";

export const doctor = defineCommand({
  meta: {
    name: "doctor",
    description: "Validate repo + runtime inputs for deploying a host.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    scope: {
      type: "string",
      description: "Which checks to run: repo | deploy | all (default: all).",
      default: "all",
    },
    json: { type: "boolean", description: "Output JSON.", default: false },
    strict: { type: "boolean", description: "Fail on warn too (deploy gating).", default: false },
  },
  async run({ args }) {
    const hostName = resolveHostNameOrExit({ cwd: process.cwd(), runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!hostName) return;
    const scopeRaw = String(args.scope || "all").trim();
    if (scopeRaw !== "repo" && scopeRaw !== "deploy" && scopeRaw !== "all") {
      throw new Error(`invalid --scope: ${scopeRaw} (expected repo|deploy|all)`);
    }

    const checks = await collectDoctorChecks({
      cwd: process.cwd(),
      runtimeDir: (args as any).runtimeDir,
      host: hostName,
      scope: scopeRaw,
    });

    if (args.json) {
      console.log(JSON.stringify({ scope: scopeRaw, host: hostName, checks }, null, 2));
    } else {
      for (const c of checks) {
        console.log(`${c.scope} ${c.status}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`);
      }
    }

    if (checks.some((c) => c.status === "missing")) process.exitCode = 1;
    if (args.strict && checks.some((c) => c.status === "warn")) process.exitCode = 1;
  },
});
