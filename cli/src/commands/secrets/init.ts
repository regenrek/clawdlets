import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { ageKeygen } from "@clawdbot/clawdlets-core/lib/age-keygen";
import { parseAgeKeyFile } from "@clawdbot/clawdlets-core/lib/age";
import { ensureDir, writeFileAtomic } from "@clawdbot/clawdlets-core/lib/fs-safe";
import { mkpasswdYescryptHash } from "@clawdbot/clawdlets-core/lib/mkpasswd";
import { upsertSopsCreationRule } from "@clawdbot/clawdlets-core/lib/sops-config";
import { sopsDecryptYamlFile, sopsEncryptYamlToFile } from "@clawdbot/clawdlets-core/lib/sops";
import { getHostAgeKeySopsCreationRulePathRegex, getHostSecretsSopsCreationRulePathRegex } from "@clawdbot/clawdlets-core/lib/sops-rules";
import { sanitizeOperatorId } from "@clawdbot/clawdlets-core/lib/identifiers";
import { buildFleetEnvSecretsPlan } from "@clawdbot/clawdlets-core/lib/fleet-env-secrets";
import { getRecommendedSecretNameForEnvVar } from "@clawdbot/clawdlets-core/lib/llm-provider-env";
import { buildSecretsInitTemplate, isPlaceholderSecretValue, listSecretsInitPlaceholders, parseSecretsInitJson, resolveSecretsInitFromJsonArg, validateSecretsInitNonInteractive, type SecretsInitJson } from "@clawdbot/clawdlets-core/lib/secrets-init";
import { readYamlScalarFromMapping } from "@clawdbot/clawdlets-core/lib/yaml-scalar";
import { getHostEncryptedAgeKeyFile, getHostExtraFilesKeyPath, getHostExtraFilesSecretsDir, getHostSecretsDir, getLocalOperatorAgeKeyPath } from "@clawdbot/clawdlets-core/repo-layout";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../../lib/wizard.js";
import { loadHostContextOrExit } from "../../lib/context.js";
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
    description: "Create/update secrets in /secrets (sops+age) and generate .clawdlets/extra-files/<host>/...",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
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
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { layout, config: clawdletsConfig, hostName, hostCfg } = ctx;

    const hasTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    let interactive = wantsInteractive(Boolean(args.interactive));
    if (!interactive && hasTty && !args.fromJson) interactive = true;
    if (interactive && !hasTty) throw new Error("--interactive requires a TTY");

    const operatorId = sanitizeOperatorId(String(args.operator || process.env.USER || "operator"));

    const sopsConfigPath = layout.sopsConfigPath;
    const operatorKeyPath = getLocalOperatorAgeKeyPath(layout, operatorId);
    const operatorPubPath = path.join(layout.localOperatorKeysDir, `${operatorId}.age.pub`);
    const hostKeyFile = getHostEncryptedAgeKeyFile(layout, hostName);
    const extraFilesKeyPath = getHostExtraFilesKeyPath(layout, hostName);
    const extraFilesSecretsDir = getHostExtraFilesSecretsDir(layout, hostName);

    const localSecretsDir = getHostSecretsDir(layout, hostName);

    const bots = clawdletsConfig.fleet.bots;
    if (bots.length === 0) throw new Error("fleet.bots is empty (set bots in infra/configs/clawdlets.json)");

    const tailnetMode = String(hostCfg.tailnet?.mode || "none");
    const requiresTailscaleAuthKey = tailnetMode === "tailscale";

    const envPlan = buildFleetEnvSecretsPlan({ config: clawdletsConfig, hostName });
    if (envPlan.missingEnvSecretMappings.length > 0) {
      const first = envPlan.missingEnvSecretMappings[0]!;
      const rec = getRecommendedSecretNameForEnvVar(first.envVar);
      throw new Error(
        `missing envSecrets mapping for ${first.envVar} (bot=${first.bot}); set: clawdlets config set --path fleet.envSecrets.${first.envVar} --value ${rec || "<secret_name>"} (or per-bot override under fleet.botOverrides.${first.bot}.envSecrets.${first.envVar})`,
      );
    }

    const requiredEnvSecretNames = new Set<string>(envPlan.secretNamesRequired);
    const envVarsBySecretName = envPlan.envVarsBySecretName;

    const templateExtraSecrets: Record<string, string> = {};
    for (const secretName of envPlan.secretNamesAll) {
      templateExtraSecrets[secretName] = requiredEnvSecretNames.has(secretName) ? "<REPLACE_WITH_API_KEY>" : "<OPTIONAL>";
    }

    const defaultSecretsJsonPath = path.join(layout.runtimeDir, "secrets.json");
    const defaultSecretsJsonDisplay = path.relative(process.cwd(), defaultSecretsJsonPath) || defaultSecretsJsonPath;

    let fromJson = resolveSecretsInitFromJsonArg({
      fromJsonRaw: (args as any).fromJson,
      argv: process.argv,
      stdinIsTTY: Boolean(process.stdin.isTTY),
    });
    if (!interactive && !fromJson) {
      if (fs.existsSync(defaultSecretsJsonPath)) {
        fromJson = defaultSecretsJsonPath;
        if (!args.allowPlaceholders) {
          const raw = fs.readFileSync(defaultSecretsJsonPath, "utf8");
          const parsed = parseSecretsInitJson(raw);
          const placeholders = listSecretsInitPlaceholders({ input: parsed, bots, requiresTailscaleAuthKey });
          if (placeholders.length > 0) {
            console.error(`error: placeholders found in ${defaultSecretsJsonDisplay} (fill it or pass --allow-placeholders)`);
            for (const p0 of placeholders) console.error(`- ${p0}`);
            process.exitCode = 1;
            return;
          }
        }
      } else {
        const template = buildSecretsInitTemplate({ bots, requiresTailscaleAuthKey, secrets: templateExtraSecrets });

        if (!args.dryRun) {
          await ensureDir(path.dirname(defaultSecretsJsonPath));
          await writeFileAtomic(defaultSecretsJsonPath, `${JSON.stringify(template, null, 2)}\n`, { mode: 0o600 });
        }

        console.error(`${args.dryRun ? "would write" : "wrote"} secrets template: ${defaultSecretsJsonDisplay}`);
        if (args.dryRun) console.error("run without --dry-run to write it");
        else console.error(`fill it, then run: clawdlets secrets init --from-json ${defaultSecretsJsonDisplay}`);
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

    const nix = { nixBin: String(process.env.NIX_BIN || "nix").trim() || "nix", cwd: layout.repoRoot, dryRun: Boolean(args.dryRun) } as const;

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

    const existingSops = fs.existsSync(sopsConfigPath) ? fs.readFileSync(sopsConfigPath, "utf8") : undefined;
    const hostKeyPathRegex = getHostAgeKeySopsCreationRulePathRegex(layout, hostName);

    const withHostKeyRule = upsertSopsCreationRule({
      existingYaml: existingSops,
      pathRegex: hostKeyPathRegex,
      ageRecipients: [operatorKeys.publicKey],
    });

    let hostKeys: { secretKey: string; publicKey: string };
    if (fs.existsSync(hostKeyFile)) {
      if (args.dryRun) {
        hostKeys = {
          publicKey: "age1dryrundryrundryrundryrundryrundryrundryrundryrundryrun0l9p4",
          secretKey: "AGE-SECRET-KEY-DRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUN",
        };
      } else {
        const decrypted = await sopsDecryptYamlFile({
          filePath: hostKeyFile,
          ageKeyFile: operatorKeyPath,
          nix,
        });
        const secretKey = readYamlScalarFromMapping({ yamlText: decrypted, key: "age_secret_key" })?.trim() || "";
        const publicKey = readYamlScalarFromMapping({ yamlText: decrypted, key: "age_public_key" })?.trim() || "";
        if (!secretKey || !publicKey) throw new Error(`invalid host age key file: ${hostKeyFile}`);
        hostKeys = { secretKey, publicKey };
      }
    } else {
      const pair = await ageKeygen(nix);
      hostKeys = { secretKey: pair.secretKey, publicKey: pair.publicKey };

      const plaintextYaml =
        upsertYamlScalarLine({
          text: upsertYamlScalarLine({ text: "\n", key: "age_public_key", value: pair.publicKey }),
          key: "age_secret_key",
          value: pair.secretKey,
        }) + "\n";

      if (!args.dryRun) {
        await ensureDir(path.dirname(sopsConfigPath));
        await writeFileAtomic(sopsConfigPath, withHostKeyRule, { mode: 0o644 });
        await sopsEncryptYamlToFile({ plaintextYaml, outPath: hostKeyFile, configPath: sopsConfigPath, nix });
      }
    }

    const hostSecretsPathRegex = getHostSecretsSopsCreationRulePathRegex(layout, hostName);
    const nextSops = upsertSopsCreationRule({
      existingYaml: withHostKeyRule,
      pathRegex: hostSecretsPathRegex,
      ageRecipients: [hostKeys.publicKey, operatorKeys.publicKey],
    });

    if (!args.dryRun) {
      await ensureDir(path.dirname(sopsConfigPath));
      await writeFileAtomic(sopsConfigPath, nextSops, { mode: 0o644 });
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
      secrets: Record<string, string>;
      discordTokens: Record<string, string>;
    } = { adminPassword: "", adminPasswordHash: "", tailscaleAuthKey: "", secrets: {}, discordTokens: {} };

    if (interactive) {
      type Step =
        | { kind: "adminPassword" }
        | { kind: "tailscaleAuthKey" }
        | { kind: "secret"; secretName: string }
        | { kind: "discordToken"; bot: string };

      const requiredExtraSecrets = Array.from(requiredEnvSecretNames).sort();

      const allSteps: Step[] = [
        { kind: "adminPassword" },
        ...(requiresTailscaleAuthKey ? ([{ kind: "tailscaleAuthKey" }] as const) : []),
        ...requiredExtraSecrets.map((secretName) => ({ kind: "secret", secretName }) as const),
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
        } else if (step.kind === "secret") {
          const envVars = envVarsBySecretName[step.secretName] || [];
          const hint = envVars.length > 0 ? ` (env: ${envVars.join(", ")})` : "";
          v = await p.password({ message: `Secret value (${step.secretName})${hint} (required by configured models)` });
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
        else if (step.kind === "secret") values.secrets[step.secretName] = s;
        else values.discordTokens[step.bot] = s;
        i += 1;
      }
    } else {
      const input = readSecretsInitJson(String(fromJson));
      values.adminPasswordHash = input.adminPasswordHash;
      values.tailscaleAuthKey = input.tailscaleAuthKey || "";
      values.secrets = input.secrets || {};
      values.discordTokens = input.discordTokens || {};
    }

    const envSecretsToWrite = envPlan.secretNamesAll;
    const requiredSecrets = Array.from(new Set([
      ...(requiresTailscaleAuthKey ? ["tailscale_auth_key"] : []),
      "admin_password_hash",
      ...envSecretsToWrite,
      ...bots.map((b) => `discord_token_${b}`),
    ]));

    const isOptionalMarker = (v: string): boolean => String(v || "").trim() === "<OPTIONAL>";

    const resolvedValues: Record<string, string> = {};
    for (const secretName of requiredSecrets) {
      const existing = await readExistingScalar(secretName);
      if (secretName === "tailscale_auth_key") {
        if (values.tailscaleAuthKey.trim()) resolvedValues[secretName] = values.tailscaleAuthKey.trim();
        else if (existing && !isPlaceholderSecretValue(existing)) resolvedValues[secretName] = existing;
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

      if (secretName.startsWith("discord_token_")) {
        const bot = secretName.slice("discord_token_".length);
        const vv = values.discordTokens[bot]?.trim() || "";
        if (vv) resolvedValues[secretName] = vv;
        else if (existing) resolvedValues[secretName] = existing;
        else if (args.allowPlaceholders) resolvedValues[secretName] = "<FILL_ME>";
        else throw new Error(`missing discord token for ${bot} (provide it in --from-json.discordTokens or pass --allow-placeholders)`);
        continue;
      }

      const vv = values.secrets?.[secretName]?.trim() || "";
      const required = requiredEnvSecretNames.has(secretName);
      if (vv && !(required && isOptionalMarker(vv))) {
        resolvedValues[secretName] = vv;
        continue;
      }
      if (existing && (!required || (!isPlaceholderSecretValue(existing) && !isOptionalMarker(existing) && existing.trim()))) {
        resolvedValues[secretName] = existing;
        continue;
      }
      if (required) {
        const envVars = envVarsBySecretName[secretName] || [];
        const envHint = envVars.length > 0 ? ` (env: ${envVars.join(", ")})` : "";
        if (args.allowPlaceholders) resolvedValues[secretName] = "<FILL_ME>";
        else throw new Error(`missing required secret: ${secretName}${envHint} (set it in --from-json.secrets or via interactive prompts)`);
        continue;
      }
      resolvedValues[secretName] = "<OPTIONAL>";
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

    console.log(`ok: secrets ready at ${localSecretsDir}`);
    console.log(`ok: sops config at ${sopsConfigPath}`);
    console.log(`ok: operator age key at ${operatorKeyPath}`);
    console.log(`ok: host age key (encrypted) at ${hostKeyFile}`);
    console.log(`ok: extra-files key at ${extraFilesKeyPath}`);
    console.log(`ok: extra-files secrets at ${extraFilesSecretsDir}`);
  },
});
