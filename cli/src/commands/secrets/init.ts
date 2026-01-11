import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { ageKeygen } from "@clawdbot/clawdlets-core/lib/age-keygen";
import { parseAgeKeyFile } from "@clawdbot/clawdlets-core/lib/age";
import { upsertDotenv } from "@clawdbot/clawdlets-core/lib/dotenv-file";
import { ensureDir, writeFileAtomic } from "@clawdbot/clawdlets-core/lib/fs-safe";
import { mkpasswdYescryptHash } from "@clawdbot/clawdlets-core/lib/mkpasswd";
import { sopsPathRegexForDirFiles, upsertSopsCreationRule } from "@clawdbot/clawdlets-core/lib/sops-config";
import { sopsDecryptYamlFile, sopsEncryptYamlToFile } from "@clawdbot/clawdlets-core/lib/sops";
import { wgGenKey } from "@clawdbot/clawdlets-core/lib/wireguard";
import { loadStack, loadStackEnv } from "@clawdbot/clawdlets-core/stack";
import { assertSafeHostName, loadClawdletsConfig } from "@clawdbot/clawdlets-core/lib/clawdlets-config";
import { readYamlScalarFromMapping } from "@clawdbot/clawdlets-core/lib/yaml-scalar";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../../lib/wizard.js";
import { sanitizeOperatorId, upsertYamlScalarLine } from "./common.js";

function wantsInteractive(flag: boolean | undefined): boolean {
  if (flag) return true;
  const env = String(process.env["CLAWDLETS_INTERACTIVE"] || "").trim();
  return env === "1" || env.toLowerCase() === "true";
}

type SecretsInitJson = {
  adminPasswordHash: string;
  wgPrivateKey?: string;
  zAiApiKey?: string;
  discordTokens: Record<string, string>;
};

function readSecretsInitJson(fromJson: string): SecretsInitJson {
  const src = String(fromJson || "").trim();
  if (!src) throw new Error("missing --from-json");

  let raw: string;
  if (src === "-") {
    raw = fs.readFileSync(0, "utf8");
  } else {
    const jsonPath = path.isAbsolute(src) ? src : path.resolve(process.cwd(), src);
    if (!fs.existsSync(jsonPath)) throw new Error(`missing --from-json file: ${jsonPath}`);
    raw = fs.readFileSync(jsonPath, "utf8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid --from-json (expected valid JSON)");
  }

  if (!parsed || typeof parsed !== "object") throw new Error("invalid --from-json (expected JSON object)");

  const obj = parsed as any;
  const adminPasswordHash = typeof obj.adminPasswordHash === "string" ? obj.adminPasswordHash.trim() : "";
  if (!adminPasswordHash) throw new Error("invalid --from-json (missing adminPasswordHash)");

  const discordTokens: Record<string, string> = {};
  if (!obj.discordTokens || typeof obj.discordTokens !== "object") throw new Error("invalid --from-json (missing discordTokens object)");
  for (const [k, v] of Object.entries(obj.discordTokens)) {
    if (typeof v !== "string") continue;
    const token = v.trim();
    if (!token) continue;
    discordTokens[String(k)] = token;
  }

  const wgPrivateKey = typeof obj.wgPrivateKey === "string" ? obj.wgPrivateKey.trim() : undefined;
  const zAiApiKey = typeof obj.zAiApiKey === "string" ? obj.zAiApiKey.trim() : undefined;

  return { adminPasswordHash, wgPrivateKey, zAiApiKey, discordTokens };
}

export const secretsInit = defineCommand({
  meta: {
    name: "init",
    description: "Create or update an encrypted secrets file (sops + age).",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: clawdbot-fleet-host).", default: "clawdbot-fleet-host" },
    interactive: { type: "boolean", description: "Prompt for secret values (requires TTY).", default: false },
    fromJson: { type: "string", description: "Read secret values from JSON file (or '-' for stdin) (non-interactive)." },
    allowPlaceholders: { type: "boolean", description: "Allow placeholders for missing tokens.", default: false },
    operator: {
      type: "string",
      description: "Operator id for local age key name (default: $USER).",
    },
    yes: { type: "boolean", description: "Overwrite without prompt.", default: false },
    dryRun: { type: "boolean", description: "Print actions without writing.", default: false },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    assertSafeHostName(hostName);
    const host = stack.hosts[hostName];
    if (!host) throw new Error(`unknown host: ${hostName}`);

    const interactive = wantsInteractive(Boolean(args.interactive));
    if (interactive && !process.stdout.isTTY) throw new Error("--interactive requires a TTY");

    const operatorId = sanitizeOperatorId(String(args.operator || process.env.USER || "operator"));

    const secretsDir = path.join(layout.stackDir, "secrets");
    const sopsConfigPath = path.join(secretsDir, ".sops.yaml");
    const operatorKeyPath = path.join(secretsDir, "operators", `${operatorId}.agekey`);
    const operatorPubPath = path.join(secretsDir, "operators", `${operatorId}.age.pub`);
    const hostKeyPath = path.join(secretsDir, "hosts", `${hostName}.agekey`);
    const hostPubPath = path.join(secretsDir, "hosts", `${hostName}.age.pub`);
    const extraFilesKeyPath = path.join(layout.stackDir, "extra-files", hostName, "var/lib/sops-nix/key.txt");
    const extraFilesSecretsDir = path.join(layout.stackDir, "extra-files", hostName, "var/lib/clawdlets/secrets/hosts", hostName);

    const localSecretsDir = path.join(layout.stackDir, host.secrets.localDir);

    if (interactive && fs.existsSync(localSecretsDir) && !args.yes) {
      const ok = await p.confirm({ message: `Update existing secrets dir? (${localSecretsDir})`, initialValue: true });
      if (p.isCancel(ok)) {
        const nav = await navOnCancel({ flow: "secrets init", canBack: false });
        if (nav === NAV_EXIT) cancelFlow();
        return;
      }
      if (!ok) return;
    }

    const envLoaded = loadStackEnv({ cwd: process.cwd(), stackDir: args.stackDir, envFile: stack.envFile });
    const nix = { nixBin: envLoaded.env.NIX_BIN || "nix", cwd: layout.repoRoot, dryRun: Boolean(args.dryRun) } as const;

    const ensureAgePair = async (keyPath: string, pubPath: string) => {
      if (fs.existsSync(keyPath) && fs.existsSync(pubPath)) {
        const keyText = fs.readFileSync(keyPath, "utf8");
        const parsed = parseAgeKeyFile(keyText);
        const publicKey = fs.readFileSync(pubPath, "utf8").trim();
        if (!parsed.secretKey) throw new Error(`invalid age key: ${keyPath}`);
        if (!publicKey) throw new Error(`invalid age public key: ${pubPath}`);
        return { secretKey: parsed.secretKey, publicKey };
      }
      const pair = await ageKeygen(nix);
      if (!args.dryRun) {
        await ensureDir(path.dirname(keyPath));
        await writeFileAtomic(keyPath, pair.fileText, { mode: 0o600 });
        await writeFileAtomic(pubPath, `${pair.publicKey}\n`, { mode: 0o644 });
      }
      return { secretKey: pair.secretKey, publicKey: pair.publicKey };
    };

    const operatorKeys = await ensureAgePair(operatorKeyPath, operatorPubPath);
    const hostKeys = await ensureAgePair(hostKeyPath, hostPubPath);

    const existingSops = fs.existsSync(sopsConfigPath) ? fs.readFileSync(sopsConfigPath, "utf8") : undefined;
    const nextSops = upsertSopsCreationRule({
      existingYaml: existingSops,
      pathRegex: sopsPathRegexForDirFiles(`secrets/hosts/${hostName}`, "yaml"),
      ageRecipients: [hostKeys.publicKey, operatorKeys.publicKey],
    });
    if (!args.dryRun) {
      await ensureDir(path.dirname(sopsConfigPath));
      await writeFileAtomic(sopsConfigPath, nextSops, { mode: 0o644 });
    }

    if (!args.dryRun) {
      await ensureDir(path.dirname(extraFilesKeyPath));
      await writeFileAtomic(extraFilesKeyPath, `${hostKeys.secretKey}\n`, { mode: 0o600 });
    }

	    const readExistingScalar = async (secretName: string): Promise<string | null> => {
	      const p0 = path.join(localSecretsDir, `${secretName}.yaml`);
	      if (!fs.existsSync(p0)) return null;
	      try {
	        const decrypted = await sopsDecryptYamlFile({
	          filePath: p0,
	          ageKeyFile: operatorKeyPath,
	          nix,
	        });
	        return readYamlScalarFromMapping({ yamlText: decrypted, key: secretName });
	      } catch {
	        return null;
	      }
	    };

    const { config: clawdletsConfig } = loadClawdletsConfig({ repoRoot: layout.repoRoot, stackDir: args.stackDir });
    const bots = clawdletsConfig.fleet.bots;
    if (bots.length === 0) throw new Error("fleet.bots is empty (set bots in infra/configs/clawdlets.json)");

    const flowSecrets = "secrets init";
    const values: {
      adminPassword: string;
      adminPasswordHash: string;
      wgPrivateKey: string;
      zAiApiKey: string;
      discordTokens: Record<string, string>;
    } = { adminPassword: "", adminPasswordHash: "", wgPrivateKey: "", zAiApiKey: "", discordTokens: {} };

    if (interactive) {
      type Step =
        | { kind: "adminPassword" }
        | { kind: "zAiApiKey" }
        | { kind: "discordToken"; bot: string };

      const allSteps: Step[] = [{ kind: "adminPassword" }, { kind: "zAiApiKey" }, ...bots.map((b) => ({ kind: "discordToken", bot: b }) as const)];

      for (let i = 0; i < allSteps.length;) {
        const step = allSteps[i]!;
        let v: unknown;
        if (step.kind === "adminPassword") {
          v = await p.password({
            message: "Admin password (used to generate admin_password_hash; leave blank to keep existing/placeholder)",
          });
        } else if (step.kind === "zAiApiKey") {
          v = await p.password({ message: "ZAI API key (z_ai_api_key) (optional)" });
        } else {
          v = await p.password({ message: `Discord token for ${step.bot} (discord_token_${step.bot}) (optional now, required to run)` });
        }

        if (p.isCancel(v)) {
          const nav = await navOnCancel({ flow: flowSecrets, canBack: i > 0 });
          if (nav === NAV_EXIT) {
            cancelFlow();
            return;
          }
          i = Math.max(0, i - 1);
          continue;
        }

        const s = String(v ?? "");
        if (step.kind === "adminPassword") values.adminPassword = s;
        else if (step.kind === "zAiApiKey") values.zAiApiKey = s;
        else values.discordTokens[step.bot] = s;
        i += 1;
      }
    } else {
      if (!args.fromJson) {
        throw new Error("non-interactive secrets init requires --from-json <path|->");
      }
      const input = readSecretsInitJson(String(args.fromJson));
      values.adminPasswordHash = input.adminPasswordHash;
      values.wgPrivateKey = input.wgPrivateKey || "";
      values.zAiApiKey = input.zAiApiKey || "";
      values.discordTokens = input.discordTokens || {};
    }

    const requiredSecrets = ["wg_private_key", "admin_password_hash", "z_ai_api_key", ...bots.map((b) => `discord_token_${b}`)];

    const resolvedValues: Record<string, string> = {};
    for (const secretName of requiredSecrets) {
      const existing = await readExistingScalar(secretName);
      if (secretName === "wg_private_key") {
        if (values.wgPrivateKey.trim()) resolvedValues[secretName] = values.wgPrivateKey.trim();
        else resolvedValues[secretName] = existing ?? (args.dryRun ? "<wg_private_key>" : await wgGenKey(nix));
        continue;
      }

      if (secretName === "admin_password_hash") {
        if (values.adminPasswordHash.trim()) {
          resolvedValues[secretName] = values.adminPasswordHash.trim();
        } else if (values.adminPassword.trim()) {
          resolvedValues[secretName] = args.dryRun ? "<admin_password_hash>" : await mkpasswdYescryptHash(String(values.adminPassword), nix);
        } else {
          resolvedValues[secretName] = existing ?? "<FILL_ME>";
        }
        continue;
      }

      if (secretName === "z_ai_api_key") {
        resolvedValues[secretName] = values.zAiApiKey.trim() ? values.zAiApiKey.trim() : existing ?? "<OPTIONAL>";
        continue;
      }

      if (secretName.startsWith("discord_token_")) {
        const bot = secretName.slice("discord_token_".length);
        const vv = values.discordTokens[bot]?.trim() || "";
        if (vv) resolvedValues[secretName] = vv;
        else if (existing) resolvedValues[secretName] = existing;
        else if (args.allowPlaceholders) resolvedValues[secretName] = "<FILL_ME>";
        else throw new Error(`missing discord token for ${bot} (use --discord-token ${bot}=... or --allow-placeholders)`);
        continue;
      }

      resolvedValues[secretName] = existing ?? "<FILL_ME>";
    }

    if (!args.dryRun) {
      await ensureDir(localSecretsDir);
      await ensureDir(extraFilesSecretsDir);

      for (const secretName of requiredSecrets) {
        const outPath = path.join(localSecretsDir, `${secretName}.yaml`);
        const plaintextYaml = upsertYamlScalarLine({ text: "\n", key: secretName, value: resolvedValues[secretName] ?? "" });
        await sopsEncryptYamlToFile({ plaintextYaml, outPath, nix });
        const encrypted = fs.readFileSync(outPath, "utf8");
        await writeFileAtomic(path.join(extraFilesSecretsDir, `${secretName}.yaml`), encrypted, { mode: 0o400 });
      }
    }

    const stackEnvPath = path.join(layout.stackDir, stack.envFile || ".env");
    const envText = fs.existsSync(stackEnvPath) ? fs.readFileSync(stackEnvPath, "utf8") : "";
    const nextEnvText = upsertDotenv(envText, { SOPS_AGE_KEY_FILE: operatorKeyPath });
    if (!args.dryRun) {
      await writeFileAtomic(stackEnvPath, nextEnvText, { mode: 0o600 });
    }

    console.log(`ok: secrets ready at ${localSecretsDir}`);
    console.log(`ok: sops config at ${sopsConfigPath}`);
    console.log(`ok: extra-files key at ${extraFilesKeyPath}`);
    console.log(`ok: extra-files secrets at ${extraFilesSecretsDir}`);
  },
});
