import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import YAML from "yaml";
import { agePublicKeyFromIdentityFile } from "@clawdlets/core/lib/age-keygen";
import { sopsDecryptYamlFile } from "@clawdlets/core/lib/sops";
import { sanitizeOperatorId } from "@clawdlets/core/lib/identifiers";
import { buildFleetSecretsPlan } from "@clawdlets/core/lib/fleet-secrets-plan";
import { isPlaceholderSecretValue } from "@clawdlets/core/lib/secrets-init";
import { loadDeployCreds } from "@clawdlets/core/lib/deploy-creds";
import { getHostSecretsDir, getLocalOperatorAgeKeyPath } from "@clawdlets/core/repo-layout";
import { loadHostContextOrExit } from "@clawdlets/core/lib/context";
import { getHostAgeKeySopsCreationRulePathRegex, getHostSecretsSopsCreationRulePathRegex } from "@clawdlets/core/lib/sops-rules";
import { getSopsCreationRuleAgeRecipients } from "@clawdlets/core/lib/sops-config";
import { mapWithConcurrency } from "@clawdlets/core/lib/concurrency";

export const secretsVerify = defineCommand({
  meta: {
    name: "verify",
    description: "Verify secrets decrypt correctly and contain no placeholders.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
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
    const { layout, config, hostName } = ctx;

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.origin === "explicit" && deployCreds.envFile.status !== "ok") {
      throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || deployCreds.envFile.status})`);
    }

    const operatorId = sanitizeOperatorId(String(args.operator || process.env.USER || "operator"));

    const operatorKeyPath =
      (args.ageKeyFile ? String(args.ageKeyFile).trim() : "") ||
      (deployCreds.values.SOPS_AGE_KEY_FILE ? String(deployCreds.values.SOPS_AGE_KEY_FILE).trim() : "") ||
      getLocalOperatorAgeKeyPath(layout, operatorId);

    const nix = { nixBin: String(deployCreds.values.NIX_BIN || "nix").trim() || "nix", cwd: layout.repoRoot, dryRun: false } as const;

    const localDir = getHostSecretsDir(layout, hostName);
    const secretsPlan = buildFleetSecretsPlan({ config, hostName });
    const requiredSecretNames = new Set<string>([
      ...secretsPlan.hostSecretNamesRequired,
      ...secretsPlan.secretNamesRequired,
    ]);
    const requiredSecrets = secretsPlan.hostSecretNamesRequired;
    const secretNames = secretsPlan.secretNamesAll;
    const optionalSecrets = ["root_password_hash"];

    type Result = { secret: string; status: "ok" | "missing" | "warn"; detail?: string };
    const preflight: Result[] = [];

    if (!fs.existsSync(operatorKeyPath)) {
      preflight.push({ secret: "SOPS_AGE_KEY_FILE", status: "missing", detail: operatorKeyPath });
    }

    const formatRecipients = (recipients: string[]) => (recipients.length ? recipients.join(", ") : "(none)");
    let operatorPublicKey = "";
    if (fs.existsSync(operatorKeyPath)) {
      try {
        operatorPublicKey = await agePublicKeyFromIdentityFile(operatorKeyPath, nix);
      } catch (e) {
        preflight.push({
          secret: "SOPS_AGE_KEY_FILE",
          status: "missing",
          detail: `failed to derive operator public key: ${String((e as Error)?.message || e)}`,
        });
      }
    }

    if (operatorPublicKey && fs.existsSync(layout.sopsConfigPath)) {
      const sopsText = fs.readFileSync(layout.sopsConfigPath, "utf8");
      const hostSecretsRule = getHostSecretsSopsCreationRulePathRegex(layout, hostName);
      const hostKeyRule = getHostAgeKeySopsCreationRulePathRegex(layout, hostName);
      const hostSecretsRecipients = getSopsCreationRuleAgeRecipients({ existingYaml: sopsText, pathRegex: hostSecretsRule });
      const hostKeyRecipients = getSopsCreationRuleAgeRecipients({ existingYaml: sopsText, pathRegex: hostKeyRule });

      if (hostSecretsRecipients.length > 0 && !hostSecretsRecipients.includes(operatorPublicKey)) {
        preflight.push({
          secret: "sops recipients (host secrets)",
          status: "missing",
          detail: `operator key ${operatorPublicKey} not in recipients: ${formatRecipients(hostSecretsRecipients)}; run: clawdlets secrets init --yes (or set SOPS_AGE_KEY_FILE to the matching key)`,
        });
      }
      if (hostKeyRecipients.length > 0 && !hostKeyRecipients.includes(operatorPublicKey)) {
        preflight.push({
          secret: "sops recipients (host age key)",
          status: "missing",
          detail: `operator key ${operatorPublicKey} not in recipients: ${formatRecipients(hostKeyRecipients)}; run: clawdlets secrets init --yes (or set SOPS_AGE_KEY_FILE to the matching key)`,
        });
      }
    }

    if (preflight.length > 0) {
      if (args.json) {
        console.log(JSON.stringify({ host: hostName, localDir, results: preflight }, null, 2));
      } else {
        for (const r of preflight) console.log(`${r.status}: ${r.secret}${r.detail ? ` (${r.detail})` : ""}`);
      }
      process.exitCode = 1;
      return;
    }

    const results: Result[] = [];

    const verifyOne = async (secretName: string, optional: boolean, allowOptionalMarker: boolean): Promise<Result> => {
      const filePath = path.join(localDir, `${secretName}.yaml`);
      if (!fs.existsSync(filePath)) {
        return { secret: secretName, status: optional ? "warn" : "missing", detail: `(missing: ${filePath})` };
      }
      try {
        const decrypted = await sopsDecryptYamlFile({ filePath, ageKeyFile: operatorKeyPath, nix });
        const parsed = (YAML.parse(decrypted) as Record<string, unknown>) || {};
        const keys = Object.keys(parsed).filter((k) => k !== "sops");
        if (keys.length !== 1 || keys[0] !== secretName) {
          return { secret: secretName, status: "missing", detail: "(invalid: expected exactly 1 key matching filename)" };
        }
        const v = parsed[secretName];
        const value = typeof v === "string" ? v : v == null ? "" : String(v);
        if (!allowOptionalMarker && value.trim() === "<OPTIONAL>") {
          return { secret: secretName, status: "missing", detail: "(placeholder: <OPTIONAL>)" };
        }
        if (!optional && isPlaceholderSecretValue(value)) {
          return { secret: secretName, status: "missing", detail: `(placeholder: ${value.trim()})` };
        }
        if (optional && isPlaceholderSecretValue(value)) {
          return { secret: secretName, status: "missing", detail: `(placeholder: ${value.trim()})` };
        }
        if (!optional && !value.trim()) {
          return { secret: secretName, status: "missing", detail: "(empty)" };
        }
        return { secret: secretName, status: "ok" };
      } catch (e) {
        return { secret: secretName, status: "missing", detail: String((e as Error)?.message || e) };
      }
    };

    if (!fs.existsSync(localDir)) {
      results.push({ secret: "secrets.localDir", status: "missing", detail: localDir });
    } else {
      const checks = [
        ...requiredSecrets.map((s) => ({ secretName: s, optional: false, allowOptionalMarker: false })),
        ...secretNames.map((s) => ({ secretName: s, optional: false, allowOptionalMarker: !requiredSecretNames.has(s) })),
        ...optionalSecrets.map((s) => ({ secretName: s, optional: true, allowOptionalMarker: true })),
      ];

      const checked = await mapWithConcurrency({
        items: checks,
        concurrency: 4,
        fn: async (c) => await verifyOne(c.secretName, c.optional, c.allowOptionalMarker),
      });

      results.push(...checked);
    }

    if (args.json) {
      console.log(JSON.stringify({ host: hostName, localDir, results }, null, 2));
    } else {
      for (const r of results) console.log(`${r.status}: ${r.secret}${r.detail ? ` (${r.detail})` : ""}`);
    }

    if (results.some((r) => r.status === "missing")) process.exitCode = 1;
  },
});
