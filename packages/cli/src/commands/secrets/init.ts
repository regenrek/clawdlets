import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { ageKeygen, agePublicKeyFromIdentityFile } from "@clawdlets/core/lib/age-keygen";
import { parseAgeKeyFile } from "@clawdlets/core/lib/age";
import { ensureDir, writeFileAtomic } from "@clawdlets/core/lib/fs-safe";
import { mkpasswdYescryptHash } from "@clawdlets/core/lib/mkpasswd";
import { upsertSopsCreationRule } from "@clawdlets/core/lib/sops-config";
import { sopsDecryptYamlFile, sopsEncryptYamlToFile } from "@clawdlets/core/lib/sops";
import { getHostAgeKeySopsCreationRulePathRegex, getHostSecretsSopsCreationRulePathRegex } from "@clawdlets/core/lib/sops-rules";
import { sanitizeOperatorId } from "@clawdlets/shared/lib/identifiers";
import { buildFleetSecretsPlan } from "@clawdlets/core/lib/fleet-secrets-plan";
import { applySecretsAutowire, planSecretsAutowire } from "@clawdlets/core/lib/secrets-autowire";
import { buildSecretsInitTemplate, isPlaceholderSecretValue, listSecretsInitPlaceholders, parseSecretsInitJson, resolveSecretsInitFromJsonArg, validateSecretsInitNonInteractive, type SecretsInitJson } from "@clawdlets/core/lib/secrets-init";
import { buildSecretsInitTemplateSets } from "@clawdlets/core/lib/secrets-init-template";
import { readYamlScalarFromMapping } from "@clawdlets/core/lib/yaml-scalar";
import { getHostEncryptedAgeKeyFile, getHostExtraFilesKeyPath, getHostExtraFilesSecretsDir, getHostSecretsDir, getLocalOperatorAgeKeyPath } from "@clawdlets/core/repo-layout";
import { expandPath } from "@clawdlets/core/lib/path-expand";
import { mapWithConcurrency } from "@clawdlets/core/lib/concurrency";
import { assertSecretsAreManaged, buildManagedHostSecretNameAllowlist } from "@clawdlets/core/lib/secrets-allowlist";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../../lib/wizard.js";
import { loadHostContextOrExit } from "@clawdlets/core/lib/context";
import { upsertYamlScalarLine } from "./common.js";
import { writeClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config";

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
    autowire: { type: "boolean", description: "Autowire missing secretEnv mappings before init.", default: false },
  },
  async run({ args }) {
    type SecretsInitArgs = {
      runtimeDir?: string;
      host?: string;
      interactive?: boolean;
      fromJson?: string | boolean;
      allowPlaceholders?: boolean;
      operator?: string;
      yes?: boolean;
      dryRun?: boolean;
      autowire?: boolean;
    };

    const a = args as unknown as SecretsInitArgs;
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: a.runtimeDir, hostArg: a.host });
    if (!ctx) return;
    let { layout, config: clawdletsConfig, hostName, hostCfg } = ctx;

    const hasTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    let interactive = wantsInteractive(Boolean(a.interactive));
    if (!interactive && hasTty && !a.fromJson) interactive = true;
    if (interactive && !hasTty) throw new Error("--interactive requires a TTY");

    const operatorId = sanitizeOperatorId(String(a.operator || process.env.USER || "operator"));

    const sopsConfigPath = layout.sopsConfigPath;
    const operatorKeyPath = getLocalOperatorAgeKeyPath(layout, operatorId);
    const operatorPubPath = path.join(layout.localOperatorKeysDir, `${operatorId}.age.pub`);
    const hostKeyFile = getHostEncryptedAgeKeyFile(layout, hostName);
    const extraFilesKeyPath = getHostExtraFilesKeyPath(layout, hostName);
    const extraFilesSecretsDir = getHostExtraFilesSecretsDir(layout, hostName);

    const localSecretsDir = getHostSecretsDir(layout, hostName);

	    const bots = clawdletsConfig.fleet.botOrder;
	    if (bots.length === 0) throw new Error("fleet.botOrder is empty (set bots in fleet/clawdlets.json)");

	    const garnixPrivate = hostCfg.cache?.garnix?.private;
	    const garnixPrivateEnabled = Boolean(garnixPrivate?.enable);
	    const garnixNetrcPath = garnixPrivateEnabled ? String(garnixPrivate?.netrcPath || "/etc/nix/netrc").trim() : "";

	    let secretsPlan = buildFleetSecretsPlan({ config: clawdletsConfig, hostName });
	    if (secretsPlan.missingSecretConfig.length > 0) {
	      if (a.autowire) {
	        const plan = planSecretsAutowire({ config: clawdletsConfig, hostName });
        if (plan.updates.length === 0) {
          const first = secretsPlan.missingSecretConfig[0]!;
          throw new Error(
            first.kind === "envVar"
              ? `missing secretEnv mapping for envVar=${first.envVar} (bot=${first.bot}); run: clawdlets config wire-secrets --write`
              : `invalid secret file config: scope=${first.scope} id=${first.fileId} targetPath=${first.targetPath} (${first.message})`,
          );
        }
        const nextConfig = applySecretsAutowire({ config: clawdletsConfig, plan });
	        await writeClawdletsConfig({ configPath: layout.clawdletsConfigPath, config: nextConfig });
	        clawdletsConfig = nextConfig;
	        secretsPlan = buildFleetSecretsPlan({ config: clawdletsConfig, hostName });
	      } else {
        const first = secretsPlan.missingSecretConfig[0]!;
        if (first.kind === "envVar") {
          throw new Error(
            `missing secretEnv mapping for envVar=${first.envVar} (bot=${first.bot}); set fleet.secretEnv.${first.envVar} or fleet.bots.${first.bot}.profile.secretEnv.${first.envVar} (or run: clawdlets config wire-secrets --write)`,
          );
        }
	        throw new Error(`invalid secret file config: scope=${first.scope} id=${first.fileId} targetPath=${first.targetPath} (${first.message})`);
	      }
	    }

	    hostCfg = (clawdletsConfig.hosts as any)?.[hostName] || hostCfg;
	    const sets = buildSecretsInitTemplateSets({ secretsPlan, hostCfg });
	    const garnixNetrcSecretName = sets.garnixNetrcSecretName;

	    const defaultSecretsJsonPath = path.join(layout.runtimeDir, "secrets.json");
	    const defaultSecretsJsonDisplay = path.relative(process.cwd(), defaultSecretsJsonPath) || defaultSecretsJsonPath;

    let fromJson = resolveSecretsInitFromJsonArg({
      fromJsonRaw: a.fromJson,
      argv: process.argv,
      stdinIsTTY: Boolean(process.stdin.isTTY),
    });
    if (!interactive && !fromJson) {
      if (fs.existsSync(defaultSecretsJsonPath)) {
        fromJson = defaultSecretsJsonPath;
        if (!a.allowPlaceholders) {
	          const raw = fs.readFileSync(defaultSecretsJsonPath, "utf8");
	          const parsed = parseSecretsInitJson(raw);
	          const placeholders = listSecretsInitPlaceholders({ input: parsed, requiresTailscaleAuthKey: sets.requiresTailscaleAuthKey });
	          if (placeholders.length > 0) {
	            console.error(`error: placeholders found in ${defaultSecretsJsonDisplay} (fill it or pass --allow-placeholders)`);
	            for (const p0 of placeholders) console.error(`- ${p0}`);
	            process.exitCode = 1;
            return;
          }
	        }
	      } else {
	        const template = buildSecretsInitTemplate({ requiresTailscaleAuthKey: sets.requiresTailscaleAuthKey, secrets: sets.templateSecrets });

	        if (!a.dryRun) {
	          await ensureDir(path.dirname(defaultSecretsJsonPath));
	          await writeFileAtomic(defaultSecretsJsonPath, `${JSON.stringify(template, null, 2)}\n`, { mode: 0o600 });
        }

        console.error(`${a.dryRun ? "would write" : "wrote"} secrets template: ${defaultSecretsJsonDisplay}`);
        if (a.dryRun) console.error("run without --dry-run to write it");
        else console.error(`fill it, then run: clawdlets secrets init --from-json ${defaultSecretsJsonDisplay}`);
        process.exitCode = 1;
        return;
      }
    }

    validateSecretsInitNonInteractive({
      interactive,
      fromJson,
      yes: Boolean(a.yes),
      dryRun: Boolean(a.dryRun),
      localSecretsDirExists: fs.existsSync(localSecretsDir),
    });

    if (interactive && fs.existsSync(localSecretsDir) && !a.yes) {
      const ok = await p.confirm({ message: `Update existing secrets dir? (${localSecretsDir})`, initialValue: true });
      if (p.isCancel(ok)) {
        const nav = await navOnCancel({ flow: "secrets init", canBack: false });
        if (nav === NAV_EXIT) cancelFlow();
        return;
      }
      if (!ok) return;
    }

    const nix = { nixBin: String(process.env.NIX_BIN || "nix").trim() || "nix", cwd: layout.repoRoot, dryRun: Boolean(a.dryRun) } as const;

    const ensureAgePair = async (keyPath: string, pubPath: string) => {
      if (fs.existsSync(keyPath)) {
        const keyText = fs.readFileSync(keyPath, "utf8");
        const parsed = parseAgeKeyFile(keyText);
        if (!parsed.secretKey) throw new Error(`invalid age key: ${keyPath}`);

        const publicKey =
          (a.dryRun ? parsed.publicKey?.trim() : await agePublicKeyFromIdentityFile(keyPath, nix)) ||
          (fs.existsSync(pubPath) ? fs.readFileSync(pubPath, "utf8").trim() : "");
        if (!publicKey) throw new Error(`invalid age key: ${keyPath} (missing public key)`);

        const existingPub = fs.existsSync(pubPath) ? fs.readFileSync(pubPath, "utf8").trim() : "";
        if (existingPub && existingPub !== publicKey) {
          console.error(`warn: operator public key mismatch; rewriting ${pubPath}`);
        }

        if (!a.dryRun && (!existingPub || existingPub !== publicKey)) {
          await ensureDir(path.dirname(pubPath));
          await writeFileAtomic(pubPath, `${publicKey}\n`, { mode: 0o644 });
        }

        return { secretKey: parsed.secretKey, publicKey };
      }

      const pair = await ageKeygen(nix);
      if (!a.dryRun) {
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

    const renderHostKeyYaml = (keys: { publicKey: string; secretKey: string }): string =>
      upsertYamlScalarLine({
        text: upsertYamlScalarLine({ text: "\n", key: "age_public_key", value: keys.publicKey }),
        key: "age_secret_key",
        value: keys.secretKey,
      }) + "\n";

    let hostKeys: { secretKey: string; publicKey: string };
    let shouldRewriteHostKeyFile = false;
    if (fs.existsSync(hostKeyFile)) {
      if (a.dryRun) {
        hostKeys = {
          publicKey: "age1dryrundryrundryrundryrundryrundryrundryrundryrundryrun0l9p4",
          secretKey: "AGE-SECRET-KEY-DRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUN",
        };
      } else {
        try {
          const decrypted = await sopsDecryptYamlFile({
            filePath: hostKeyFile,
            ageKeyFile: operatorKeyPath,
            nix,
          });
          const secretKey = readYamlScalarFromMapping({ yamlText: decrypted, key: "age_secret_key" })?.trim() || "";
          const publicKey = readYamlScalarFromMapping({ yamlText: decrypted, key: "age_public_key" })?.trim() || "";
          if (!secretKey || !publicKey) throw new Error(`invalid host age key file: ${hostKeyFile}`);
          hostKeys = { secretKey, publicKey };
        } catch (e) {
          if (fs.existsSync(extraFilesKeyPath)) {
            const keyText = fs.readFileSync(extraFilesKeyPath, "utf8");
            const parsed = parseAgeKeyFile(keyText);
            if (!parsed.secretKey) throw new Error(`invalid extra-files key: ${extraFilesKeyPath}`);
            const publicKey = await agePublicKeyFromIdentityFile(extraFilesKeyPath, nix);
            hostKeys = { secretKey: parsed.secretKey, publicKey };
            shouldRewriteHostKeyFile = true;
            console.error(`warn: host age key file not decryptable; recovered from ${extraFilesKeyPath}`);
          } else {
            const pair = await ageKeygen(nix);
            hostKeys = { secretKey: pair.secretKey, publicKey: pair.publicKey };
            shouldRewriteHostKeyFile = true;
            console.error("warn: host age key file not decryptable; generated new host key");
          }
        }
      }
    } else {
      const pair = await ageKeygen(nix);
      hostKeys = { secretKey: pair.secretKey, publicKey: pair.publicKey };
      shouldRewriteHostKeyFile = true;

      if (!a.dryRun) {
        await ensureDir(path.dirname(sopsConfigPath));
        await writeFileAtomic(sopsConfigPath, withHostKeyRule, { mode: 0o644 });
        await sopsEncryptYamlToFile({ plaintextYaml: renderHostKeyYaml(pair), outPath: hostKeyFile, configPath: sopsConfigPath, nix });
      }
    }

    const hostSecretsPathRegex = getHostSecretsSopsCreationRulePathRegex(layout, hostName);
    const nextSops = upsertSopsCreationRule({
      existingYaml: withHostKeyRule,
      pathRegex: hostSecretsPathRegex,
      ageRecipients: [hostKeys.publicKey, operatorKeys.publicKey],
    });

    if (!a.dryRun) {
      await ensureDir(path.dirname(sopsConfigPath));
      await writeFileAtomic(sopsConfigPath, nextSops, { mode: 0o644 });
      await ensureDir(path.dirname(extraFilesKeyPath));
      await writeFileAtomic(extraFilesKeyPath, `${hostKeys.secretKey}\n`, { mode: 0o600 });
      if (shouldRewriteHostKeyFile) {
        await sopsEncryptYamlToFile({ plaintextYaml: renderHostKeyYaml(hostKeys), outPath: hostKeyFile, configPath: sopsConfigPath, nix });
      }
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
	    } = { adminPassword: "", adminPasswordHash: "", tailscaleAuthKey: "", secrets: {} };

	    if (interactive) {
      type Step =
        | { kind: "adminPassword" }
        | { kind: "tailscaleAuthKey" }
	        | { kind: "garnixNetrcFile"; secretName: string; netrcPath: string }
	        | { kind: "secret"; secretName: string };

	      const requiredSecretsToPrompt = sets.requiredSecrets;

	      const allSteps: Step[] = [
	        { kind: "adminPassword" },
	        ...(sets.requiresTailscaleAuthKey ? ([{ kind: "tailscaleAuthKey" }] as const) : []),
	        ...requiredSecretsToPrompt.map((secretName) =>
	          garnixPrivateEnabled && secretName === garnixNetrcSecretName
	            ? ({ kind: "garnixNetrcFile", secretName, netrcPath: garnixNetrcPath || "/etc/nix/netrc" } as const)
	            : ({ kind: "secret", secretName } as const),
        ),
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
        } else if (step.kind === "garnixNetrcFile") {
          v = await p.text({
            message: `Path to netrc file for private Garnix cache (${step.secretName} → ${step.netrcPath}) (required)`,
            placeholder: `${layout.runtimeDir}/garnix.netrc`,
          });
        } else if (step.kind === "secret") {
          v = await p.password({ message: `Secret value (${step.secretName}) (required)` });
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
        else if (step.kind === "garnixNetrcFile") {
          const rawPath = s.trim();
          if (!rawPath) values.secrets[step.secretName] = "";
          else {
            const expanded = expandPath(rawPath);
            const abs = path.isAbsolute(expanded) ? expanded : path.resolve(layout.repoRoot, expanded);
            const stat = fs.statSync(abs);
            if (!stat.isFile()) throw new Error(`not a file: ${abs}`);
            if (stat.size > 64 * 1024) throw new Error(`netrc file too large (>64KB): ${abs}`);
            const netrc = fs.readFileSync(abs, "utf8").trimEnd();
            if (!netrc) throw new Error(`netrc file is empty: ${abs}`);
            values.secrets[step.secretName] = netrc;
          }
        }
        else if (step.kind === "secret") values.secrets[step.secretName] = s;
        i += 1;
      }
    } else {
      const input = readSecretsInitJson(String(fromJson));
      values.adminPasswordHash = input.adminPasswordHash;
      values.tailscaleAuthKey = input.tailscaleAuthKey || "";
      values.secrets = input.secrets || {};
    }

    const allowlist = buildManagedHostSecretNameAllowlist({ config: clawdletsConfig, host: hostName });
    assertSecretsAreManaged({ allowlist, secrets: values.secrets });

    const secretsToWrite = Array.from(new Set([
      ...secretsPlan.hostSecretNamesRequired,
      ...secretsPlan.secretNamesAll,
    ])).sort();

    const isOptionalMarker = (v: string): boolean => String(v || "").trim() === "<OPTIONAL>";
    const requiredSecretNamesForValue = new Set<string>([
      ...secretsPlan.hostSecretNamesRequired,
      ...secretsPlan.secretNamesRequired,
    ]);

    const needsExistingValue = (secretName: string): boolean => {
      if (secretName === "tailscale_auth_key") return !values.tailscaleAuthKey.trim();
      if (secretName === "admin_password_hash") return !values.adminPasswordHash.trim() && !values.adminPassword.trim();
      const vv = values.secrets?.[secretName]?.trim() || "";
      const required = requiredSecretNamesForValue.has(secretName);
      if (vv && !(required && (isOptionalMarker(vv) || isPlaceholderSecretValue(vv)))) return false;
      return true;
    };

    const secretsNeedingExisting = secretsToWrite.filter(needsExistingValue);
    const existingPairs =
      secretsNeedingExisting.length > 0
        ? await mapWithConcurrency({
            items: secretsNeedingExisting,
            concurrency: 4,
            fn: async (secretName) => [secretName, await readExistingScalar(secretName)] as const,
          })
        : [];
    const existingBySecret = new Map(existingPairs);

    const resolvedValues: Record<string, string> = {};
    for (const secretName of secretsToWrite) {
      const existing = existingBySecret.get(secretName) ?? null;
      if (secretName === "tailscale_auth_key") {
        if (values.tailscaleAuthKey.trim()) resolvedValues[secretName] = values.tailscaleAuthKey.trim();
        else if (existing && !isPlaceholderSecretValue(existing)) resolvedValues[secretName] = existing;
        else if (a.allowPlaceholders) resolvedValues[secretName] = "<FILL_ME>";
        else throw new Error("missing tailscale auth key (tailscale_auth_key); pass --allow-placeholders only if you intend to set it later");
        continue;
      }

      if (secretName === "admin_password_hash") {
        if (values.adminPasswordHash.trim()) {
          resolvedValues[secretName] = values.adminPasswordHash.trim();
        } else if (values.adminPassword.trim()) {
          resolvedValues[secretName] = a.dryRun ? "<admin_password_hash>" : await mkpasswdYescryptHash(String(values.adminPassword), nix);
        } else {
          resolvedValues[secretName] = existing ?? "<FILL_ME>";
        }
        continue;
      }

      const vv = values.secrets?.[secretName]?.trim() || "";
      const required = requiredSecretNamesForValue.has(secretName);
      if (vv && !(required && (isOptionalMarker(vv) || isPlaceholderSecretValue(vv)))) {
        resolvedValues[secretName] = vv;
        continue;
      }
      if (existing && (!required || (!isPlaceholderSecretValue(existing) && !isOptionalMarker(existing) && existing.trim()))) {
        resolvedValues[secretName] = existing;
        continue;
      }
      if (required) {
        if (a.allowPlaceholders) resolvedValues[secretName] = "<FILL_ME>";
        else throw new Error(`missing required secret: ${secretName} (set it in --from-json.secrets or via interactive prompts)`);
        continue;
      }
      resolvedValues[secretName] = "<OPTIONAL>";
    }

    if (!a.dryRun) {
      await ensureDir(localSecretsDir);
      await ensureDir(extraFilesSecretsDir);

      for (const secretName of secretsToWrite) {
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
