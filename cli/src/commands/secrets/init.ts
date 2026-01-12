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
import { sanitizeOperatorId } from "@clawdbot/clawdlets-core/lib/identifiers";
import { buildSecretsInitTemplate, parseSecretsInitJson, validateSecretsInitNonInteractive, type SecretsInitJson } from "@clawdbot/clawdlets-core/lib/secrets-init";
import { loadStack, loadStackEnv } from "@clawdbot/clawdlets-core/stack";
import { assertSafeHostName, loadClawdletsConfig } from "@clawdbot/clawdlets-core/lib/clawdlets-config";
import { readYamlScalarFromMapping } from "@clawdbot/clawdlets-core/lib/yaml-scalar";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../../lib/wizard.js";
import { requireStackHostOrExit, resolveHostNameOrExit } from "../../lib/host-resolve.js";
import { upsertYamlScalarLine } from "./common.js";

function wantsInteractive(flag: boolean | undefined): boolean {
  if (flag) return true;
  const env = String(process.env["CLAWDLETS_INTERACTIVE"] || "").trim();
  return env === "1" || env.toLowerCase() === "true";
}

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

  return parseSecretsInitJson(raw);
}

export const secretsInit = defineCommand({
  meta: {
    name: "init",
    description: "Create or update an encrypted secrets file (sops + age).",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
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
    const hostName = resolveHostNameOrExit({ cwd: process.cwd(), stackDir: args.stackDir, hostArg: args.host });
    if (!hostName) return;
    assertSafeHostName(hostName);
    const host = requireStackHostOrExit(stack, hostName);
    if (!host) return;

    const hasTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    let interactive = wantsInteractive(Boolean(args.interactive));
    if (!interactive && hasTty && !args.fromJson) interactive = true;
    if (interactive && !hasTty) throw new Error("--interactive requires a TTY");

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

    const { config: clawdletsConfig } = loadClawdletsConfig({ repoRoot: layout.repoRoot, stackDir: args.stackDir });
    const bots = clawdletsConfig.fleet.bots;
    if (bots.length === 0) throw new Error("fleet.bots is empty (set bots in infra/configs/clawdlets.json)");

    const clawdletsHostCfg = clawdletsConfig.hosts[hostName];
    if (!clawdletsHostCfg) throw new Error(`missing host in infra/configs/clawdlets.json: ${hostName}`);
    const tailnetMode = String(clawdletsHostCfg.tailnet?.mode || "none");
    const requiresTailscaleAuthKey = tailnetMode === "tailscale";

    const defaultSecretsJsonPath = path.join(layout.stackDir, "secrets.json");
    const defaultSecretsJsonDisplay = path.relative(process.cwd(), defaultSecretsJsonPath) || defaultSecretsJsonPath;

    let fromJson = args.fromJson ? String(args.fromJson) : undefined;
    if (!interactive && !fromJson) {
      if (fs.existsSync(defaultSecretsJsonPath)) {
        fromJson = defaultSecretsJsonPath;
        if (!args.allowPlaceholders) {
          const raw = fs.readFileSync(defaultSecretsJsonPath, "utf8");
          if (raw.includes("<")) {
            console.error(`error: placeholders found in ${defaultSecretsJsonDisplay} (fill it or pass --allow-placeholders)`);
            process.exitCode = 1;
            return;
          }
        }
      } else {
        const template = buildSecretsInitTemplate({ bots, requiresTailscaleAuthKey });

        if (!args.dryRun) {
          await ensureDir(path.dirname(defaultSecretsJsonPath));
          await writeFileAtomic(defaultSecretsJsonPath, `${JSON.stringify(template, null, 2)}\n`, { mode: 0o600 });
        }

        console.error(`${args.dryRun ? "would write" : "wrote"} secrets template: ${defaultSecretsJsonDisplay}`);
        if (args.dryRun) console.error("run without --dry-run to write it");
        else console.error(`fill it, then run: clawdlets secrets init --host ${hostName} --from-json ${defaultSecretsJsonDisplay}`);
        process.exitCode = 1;
        return;
      }
    }

    validateSecretsInitNonInteractive({
      interactive,
      fromJson,
      yes: Boolean(args.yes),
      dryRun: Boolean(args.dryRun),
      localSecretsDirExists: fs.existsSync(localSecretsDir),
    });

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

    const flowSecrets = "secrets init";
    const values: {
      adminPassword: string;
      adminPasswordHash: string;
      tailscaleAuthKey: string;
      zAiApiKey: string;
      discordTokens: Record<string, string>;
    } = { adminPassword: "", adminPasswordHash: "", tailscaleAuthKey: "", zAiApiKey: "", discordTokens: {} };

    if (interactive) {
      type Step =
        | { kind: "adminPassword" }
        | { kind: "tailscaleAuthKey" }
        | { kind: "zAiApiKey" }
        | { kind: "discordToken"; bot: string };

      const allSteps: Step[] = [
        { kind: "adminPassword" },
        ...(requiresTailscaleAuthKey ? ([{ kind: "tailscaleAuthKey" }] as const) : []),
        { kind: "zAiApiKey" },
        ...bots.map((b) => ({ kind: "discordToken", bot: b }) as const),
      ];

      for (let i = 0; i < allSteps.length;) {
        const step = allSteps[i]!;
        let v: unknown;
        if (step.kind === "adminPassword") {
          v = await p.password({
            message: "Admin password (used to generate admin_password_hash; leave blank to keep existing/placeholder)",
          });
        } else if (step.kind === "tailscaleAuthKey") {
          v = await p.password({ message: "Tailscale auth key (tailscale_auth_key) (required for non-interactive tailnet bootstrap)" });
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
        else if (step.kind === "tailscaleAuthKey") values.tailscaleAuthKey = s;
        else if (step.kind === "zAiApiKey") values.zAiApiKey = s;
        else values.discordTokens[step.bot] = s;
        i += 1;
      }
    } else {
      const input = readSecretsInitJson(String(fromJson));
      values.adminPasswordHash = input.adminPasswordHash;
      values.tailscaleAuthKey = input.tailscaleAuthKey || "";
      values.zAiApiKey = input.zAiApiKey || "";
      values.discordTokens = input.discordTokens || {};
    }

    const requiredSecrets = [
      ...(requiresTailscaleAuthKey ? ["tailscale_auth_key"] : []),
      "admin_password_hash",
      "z_ai_api_key",
      ...bots.map((b) => `discord_token_${b}`),
    ];

    const resolvedValues: Record<string, string> = {};
    for (const secretName of requiredSecrets) {
      const existing = await readExistingScalar(secretName);
      if (secretName === "tailscale_auth_key") {
        if (values.tailscaleAuthKey.trim()) resolvedValues[secretName] = values.tailscaleAuthKey.trim();
        else if (existing && !existing.includes("<")) resolvedValues[secretName] = existing;
        else if (args.allowPlaceholders) resolvedValues[secretName] = "<FILL_ME>";
        else throw new Error("missing tailscale auth key (tailscale_auth_key); pass --allow-placeholders only if you intend to set it later");
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
        else throw new Error(`missing discord token for ${bot} (provide it in --from-json.discordTokens or pass --allow-placeholders)`);
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
        await sopsEncryptYamlToFile({ plaintextYaml, outPath, configPath: sopsConfigPath, nix });
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
