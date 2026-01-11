import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import YAML from "yaml";
import { sopsDecryptYamlFile } from "@clawdbot/clawdlets-core/lib/sops";
import { evalFleetConfig } from "@clawdbot/clawdlets-core/lib/fleet-nix-eval";
import { loadStack } from "@clawdbot/clawdlets-core/stack";
import { isPlaceholder, readDotenvFile, sanitizeOperatorId } from "./common.js";

export const secretsVerify = defineCommand({
  meta: {
    name: "verify",
    description: "Verify secrets decrypt correctly and contain no placeholders.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: clawdbot-fleet-host).", default: "clawdbot-fleet-host" },
    operator: {
      type: "string",
      description: "Operator id for age key name (default: $USER). Used if SOPS_AGE_KEY_FILE is not set.",
    },
    ageKeyFile: { type: "string", description: "Override SOPS_AGE_KEY_FILE path." },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    const host = stack.hosts[hostName];
    if (!host) throw new Error(`unknown host: ${hostName}`);

    const operatorId = sanitizeOperatorId(String(args.operator || process.env.USER || "operator"));

    const envPath = path.join(layout.stackDir, stack.envFile || ".env");
    const env = readDotenvFile(envPath);

    const operatorKeyPath =
      (args.ageKeyFile ? String(args.ageKeyFile).trim() : "") ||
      (env.SOPS_AGE_KEY_FILE ? env.SOPS_AGE_KEY_FILE.trim() : "") ||
      path.join(layout.stackDir, "secrets", "operators", `${operatorId}.agekey`);

    const nix = { nixBin: String(env.NIX_BIN || process.env.NIX_BIN || "nix").trim() || "nix", cwd: layout.repoRoot, dryRun: false } as const;

    const localDir = path.join(layout.stackDir, host.secrets.localDir);
    const fleetPath = path.join(layout.repoRoot, "infra", "configs", "fleet.nix");
    const bots = fs.existsSync(fleetPath) ? (await evalFleetConfig({ repoRoot: layout.repoRoot, fleetFilePath: fleetPath, nixBin: nix.nixBin })).bots : [];

    const requiredSecrets = ["wg_private_key", "admin_password_hash", ...bots.map((b) => `discord_token_${b}`)];
    const optionalSecrets = ["z_ai_api_key", "root_password_hash"];

    type Result = { secret: string; status: "ok" | "missing" | "warn"; detail?: string };
    const results: Result[] = [];

    if (!fs.existsSync(operatorKeyPath)) {
      results.push({ secret: "SOPS_AGE_KEY_FILE", status: "missing", detail: operatorKeyPath });
    }

    const verifyOne = async (secretName: string, optional: boolean) => {
      const filePath = path.join(localDir, `${secretName}.yaml`);
      if (!fs.existsSync(filePath)) {
        results.push({ secret: secretName, status: optional ? "warn" : "missing", detail: `(missing: ${filePath})` });
        return;
      }
      try {
        const decrypted = await sopsDecryptYamlFile({ filePath, ageKeyFile: operatorKeyPath, nix });
        const parsed = (YAML.parse(decrypted) as Record<string, unknown>) || {};
        const keys = Object.keys(parsed).filter((k) => k !== "sops");
        if (keys.length !== 1 || keys[0] !== secretName) {
          results.push({ secret: secretName, status: "missing", detail: "(invalid: expected exactly 1 key matching filename)" });
          return;
        }
        const v = parsed[secretName];
        const value = typeof v === "string" ? v : v == null ? "" : String(v);
        if (!optional && isPlaceholder(value)) {
          results.push({ secret: secretName, status: "missing", detail: `(placeholder: ${value.trim()})` });
          return;
        }
        if (optional && isPlaceholder(value) && value.trim() !== "<OPTIONAL>") {
          results.push({ secret: secretName, status: "missing", detail: `(placeholder: ${value.trim()})` });
          return;
        }
        if (!optional && !value.trim()) {
          results.push({ secret: secretName, status: "missing", detail: "(empty)" });
          return;
        }
        results.push({ secret: secretName, status: "ok" });
      } catch (e) {
        results.push({ secret: secretName, status: "missing", detail: String((e as Error)?.message || e) });
      }
    };

    if (!fs.existsSync(localDir)) {
      results.push({ secret: "secrets.localDir", status: "missing", detail: localDir });
    } else {
      for (const s of requiredSecrets) await verifyOne(s, false);
      for (const s of optionalSecrets) await verifyOne(s, true);
    }

    if (args.json) {
      console.log(JSON.stringify({ host: hostName, localDir, results }, null, 2));
    } else {
      for (const r of results) console.log(`${r.status}: ${r.secret}${r.detail ? ` (${r.detail})` : ""}`);
    }

    if (results.some((r) => r.status === "missing")) process.exitCode = 1;
  },
});
