import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import YAML from "yaml";
import { sopsDecryptYamlFile } from "@clawdbot/clawdlets-core/lib/sops";
import { sanitizeOperatorId } from "@clawdbot/clawdlets-core/lib/identifiers";
import { buildFleetEnvSecretsPlan } from "@clawdbot/clawdlets-core/lib/fleet-env-secrets";
import { isPlaceholderSecretValue } from "@clawdbot/clawdlets-core/lib/secrets-init";
import { getHostSecretsDir, getLocalOperatorAgeKeyPath } from "@clawdbot/clawdlets-core/repo-layout";
import { loadHostContextOrExit } from "../../lib/context.js";

export const secretsVerify = defineCommand({
  meta: {
    name: "verify",
    description: "Verify secrets decrypt correctly and contain no placeholders.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    operator: {
      type: "string",
      description: "Operator id for age key name (default: $USER). Used if SOPS_AGE_KEY_FILE is not set.",
    },
    ageKeyFile: { type: "string", description: "Override SOPS_AGE_KEY_FILE path." },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { layout, config, hostName, hostCfg } = ctx;

    const operatorId = sanitizeOperatorId(String(args.operator || process.env.USER || "operator"));

    const operatorKeyPath =
      (args.ageKeyFile ? String(args.ageKeyFile).trim() : "") ||
      (process.env.SOPS_AGE_KEY_FILE ? String(process.env.SOPS_AGE_KEY_FILE).trim() : "") ||
      getLocalOperatorAgeKeyPath(layout, operatorId);

    const nix = { nixBin: String(process.env.NIX_BIN || "nix").trim() || "nix", cwd: layout.repoRoot, dryRun: false } as const;

    const localDir = getHostSecretsDir(layout, hostName);
    const bots = config.fleet.bots;

    const envPlan = buildFleetEnvSecretsPlan({ config, hostName });
    const requiredEnvSecretNames = new Set<string>(envPlan.secretNamesRequired);

    const tailnetMode = String(hostCfg.tailnet?.mode || "none");
    const requiredSecrets = Array.from(new Set([
      ...(tailnetMode === "tailscale" ? ["tailscale_auth_key"] : []),
      "admin_password_hash",
      ...bots.map((b) => `discord_token_${b}`),
    ]));
    const envSecrets = envPlan.secretNamesAll;
    const optionalSecrets = ["root_password_hash"];

    type Result = { secret: string; status: "ok" | "missing" | "warn"; detail?: string };
    const results: Result[] = [];

    if (!fs.existsSync(operatorKeyPath)) {
      results.push({ secret: "SOPS_AGE_KEY_FILE", status: "missing", detail: operatorKeyPath });
    }

    const verifyOne = async (secretName: string, optional: boolean, allowOptionalMarker: boolean) => {
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
        if (!allowOptionalMarker && value.trim() === "<OPTIONAL>") {
          results.push({ secret: secretName, status: "missing", detail: "(placeholder: <OPTIONAL>)" });
          return;
        }
        if (!optional && isPlaceholderSecretValue(value)) {
          results.push({ secret: secretName, status: "missing", detail: `(placeholder: ${value.trim()})` });
          return;
        }
        if (optional && isPlaceholderSecretValue(value)) {
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
      for (const s of requiredSecrets) await verifyOne(s, false, false);
      for (const s of envSecrets) await verifyOne(s, false, !requiredEnvSecretNames.has(s));
      for (const s of optionalSecrets) await verifyOne(s, true, true);
    }

    if (args.json) {
      console.log(JSON.stringify({ host: hostName, localDir, results }, null, 2));
    } else {
      for (const r of results) console.log(`${r.status}: ${r.secret}${r.detail ? ` (${r.detail})` : ""}`);
    }

    if (results.some((r) => r.status === "missing")) process.exitCode = 1;
  },
});
