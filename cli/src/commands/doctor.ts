import process from "node:process";
import { defineCommand } from "citty";
import { collectDoctorChecks } from "@clawdbot/clawdlets-core/doctor";

export const doctor = defineCommand({
  meta: {
    name: "doctor",
    description: "Validate local stack/env for deploying a host.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: clawdbot-fleet-host).", default: "clawdbot-fleet-host" },
    scope: {
      type: "string",
      description: "Which checks to run: repo | deploy | all (default: all).",
      default: "all",
    },
    json: { type: "boolean", description: "Output JSON.", default: false },
    strict: { type: "boolean", description: "Fail on warn too (deploy gating).", default: false },
  },
  async run({ args }) {
    const hostName = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    const scopeRaw = String(args.scope || "all").trim();
    if (scopeRaw !== "repo" && scopeRaw !== "deploy" && scopeRaw !== "all") {
      throw new Error(`invalid --scope: ${scopeRaw} (expected repo|deploy|all)`);
    }

    const checks = await collectDoctorChecks({
      cwd: process.cwd(),
      stackDir: args.stackDir,
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
