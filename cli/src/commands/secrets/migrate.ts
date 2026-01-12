import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import YAML from "yaml";
import { parseAgeKeyFile } from "@clawdbot/clawdlets-core/lib/age";
import { assertSafeHostName } from "@clawdbot/clawdlets-core/lib/clawdlets-config";
import { sanitizeOperatorId } from "@clawdbot/clawdlets-core/lib/identifiers";
import { ensureDir, writeFileAtomic } from "@clawdbot/clawdlets-core/lib/fs-safe";
import { resolveLegacySecretPaths } from "@clawdbot/clawdlets-core/lib/secrets-migrate";
import { removeSopsCreationRule, sopsPathRegexForDirFiles, sopsPathRegexForPathSuffix, upsertSopsCreationRule } from "@clawdbot/clawdlets-core/lib/sops-config";
import { sopsDecryptYamlFile, sopsEncryptYamlToFile } from "@clawdbot/clawdlets-core/lib/sops";
import { readDotenvFile, nextBackupPath, resolveRepoRootFromStackDir } from "./common.js";
import { resolveHostNameOrExit } from "../../lib/host-resolve.js";

export const secretsMigrate = defineCommand({
  meta: {
    name: "migrate",
    description: "Migrate legacy single-file host secrets to per-secret files (one secret per file).",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    operator: {
      type: "string",
      description: "Operator id for age key name (default: $USER). Used if SOPS_AGE_KEY_FILE is not set.",
    },
    ageKeyFile: { type: "string", description: "Override SOPS_AGE_KEY_FILE path." },
    yes: { type: "boolean", description: "Overwrite existing target dirs without prompt.", default: false },
    dryRun: { type: "boolean", description: "Print actions without writing.", default: false },
  },
  async run({ args }) {
    const stackDir = args.stackDir ? path.resolve(process.cwd(), args.stackDir) : path.resolve(process.cwd(), ".clawdlets");
    const stackFile = path.join(stackDir, "stack.json");
    if (!fs.existsSync(stackFile)) throw new Error(`missing stack file: ${stackFile}`);

    const hostName = resolveHostNameOrExit({ cwd: process.cwd(), stackDir: args.stackDir, hostArg: args.host });
    if (!hostName) return;
    assertSafeHostName(hostName);

    let stackRaw: unknown;
    try {
      stackRaw = JSON.parse(fs.readFileSync(stackFile, "utf8"));
    } catch {
      throw new Error(`invalid JSON: ${stackFile}`);
    }

    const stackObj = stackRaw as { schemaVersion?: unknown; envFile?: unknown; hosts?: Record<string, any> };
    const schemaVersion = Number(stackObj.schemaVersion);
    if (!Number.isFinite(schemaVersion) || (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3)) {
      throw new Error(`unsupported stack.schemaVersion: ${String(stackObj.schemaVersion)}`);
    }
    const hosts = stackObj.hosts || {};
    const host = hosts[hostName];
    if (!host) {
      const available = Object.keys(hosts);
      console.error(`warn: unknown stack host: ${hostName}`);
      console.error(`tip: stack hosts: ${available.length > 0 ? available.join(", ") : "(none)"}`);
      console.error(`tip: pass --host <name> to select a host`);
      process.exitCode = 1;
      return;
    }

    const envFileRel = String(stackObj.envFile || ".env");
    const envPath = path.isAbsolute(envFileRel) ? envFileRel : path.join(stackDir, envFileRel);
    const env = readDotenvFile(envPath);

    const repoRoot = resolveRepoRootFromStackDir(stackDir);

    const operatorId = sanitizeOperatorId(String(args.operator || process.env.USER || "operator"));

    const operatorKeyPath =
      (args.ageKeyFile ? String(args.ageKeyFile).trim() : "") ||
      (env.SOPS_AGE_KEY_FILE ? env.SOPS_AGE_KEY_FILE.trim() : "") ||
      path.join(stackDir, "secrets", "operators", `${operatorId}.agekey`);
    if (!fs.existsSync(operatorKeyPath)) throw new Error(`missing operator age key: ${operatorKeyPath}`);

    const operatorKeyText = fs.readFileSync(operatorKeyPath, "utf8");
    const operatorKeys = parseAgeKeyFile(operatorKeyText);
    if (!operatorKeys.publicKey) throw new Error(`operator age key missing public key comment: ${operatorKeyPath}`);

    const hostKeyPath = path.join(stackDir, "secrets", "hosts", `${hostName}.agekey`);
    if (!fs.existsSync(hostKeyPath)) throw new Error(`missing host age key: ${hostKeyPath}`);
    const hostKeys = parseAgeKeyFile(fs.readFileSync(hostKeyPath, "utf8"));
    if (!hostKeys.publicKey) throw new Error(`host age key missing public key comment: ${hostKeyPath}`);

    const toDirSecrets = (secrets: any) => {
      if (secrets?.localDir && secrets?.remoteDir) {
        return { localDir: String(secrets.localDir), remoteDir: String(secrets.remoteDir) };
      }
      if (secrets?.localFile && secrets?.remoteFile) {
        const localFile = String(secrets.localFile);
        const remoteFile = String(secrets.remoteFile);
        const localDir = localFile.replace(/\.ya?ml$/i, "");
        const remoteDir = remoteFile.replace(/\.ya?ml$/i, "");
        return { localDir, remoteDir };
      }
      throw new Error("invalid secrets config (expected localDir/remoteDir or localFile/remoteFile)");
    };

    const toOpenTofu = (name: string, h: any) => {
      if (h?.opentofu?.adminCidr && h?.opentofu?.sshPubkeyFile) {
        return {
          adminCidr: String(h.opentofu.adminCidr),
          sshPubkeyFile: String(h.opentofu.sshPubkeyFile),
        };
      }
      if (h?.terraform?.adminCidr && h?.terraform?.sshPubkeyFile) {
        return {
          adminCidr: String(h.terraform.adminCidr),
          sshPubkeyFile: String(h.terraform.sshPubkeyFile),
        };
      }
      throw new Error(`host ${name} missing opentofu/terraform config (expected {adminCidr, sshPubkeyFile})`);
    };

    const nextHosts = Object.fromEntries(
      Object.entries(hosts).map(([name, h]) => {
        const nextSecrets = toDirSecrets((h as any)?.secrets);
        const nextOpentofu = toOpenTofu(name, h as any);
        const { terraform: _terraform, opentofu: _opentofu, ...rest } = (h as any) || {};
        return [name, { ...rest, opentofu: nextOpentofu, secrets: nextSecrets }];
      }),
    );

    const nextHost = nextHosts[hostName];
    if (!nextHost) throw new Error(`unknown host after upgrade: ${hostName}`);
    const nextSecrets = toDirSecrets(nextHost.secrets);

    const localSecretsDir = path.join(stackDir, String(nextSecrets.localDir));
    const extraFilesSecretsDir = path.join(stackDir, "extra-files", hostName, "var/lib/clawdlets/secrets/hosts", hostName);

    const sopsConfigPath = path.join(stackDir, "secrets", ".sops.yaml");
    const existingSops = fs.existsSync(sopsConfigPath) ? fs.readFileSync(sopsConfigPath, "utf8") : "";

    const nix = { nixBin: String(env.NIX_BIN || process.env.NIX_BIN || "nix").trim() || "nix", cwd: repoRoot, dryRun: Boolean(args.dryRun) } as const;

    const legacyLocalFiles = (() => {
      const candidates: string[] = [];
      const configured = host?.secrets?.localFile ? path.join(stackDir, String(host.secrets.localFile)) : "";
      if (configured) candidates.push(configured);
      candidates.push(path.join(stackDir, "secrets", "hosts", `${hostName}.yaml`));
      candidates.push(path.join(stackDir, "secrets", "hosts", `${hostName}.yml`));
      return candidates.filter((v, i) => Boolean(v && v.trim()) && candidates.indexOf(v) === i);
    })();
    const legacyLocalFile = legacyLocalFiles.find((f) => fs.existsSync(f)) || legacyLocalFiles[0]!;

    const planned: string[] = [];
    planned.push(stackFile);
    planned.push(sopsConfigPath);
    planned.push(localSecretsDir);
    planned.push(extraFilesSecretsDir);
    if (fs.existsSync(legacyLocalFile)) planned.push(legacyLocalFile);

    const dirNonEmpty = (dir: string) => fs.existsSync(dir) && fs.readdirSync(dir).some((n) => n && n !== "." && n !== "..");
    if (dirNonEmpty(localSecretsDir) && !args.yes) throw new Error(`target secrets dir not empty (pass --yes): ${localSecretsDir}`);
    if (dirNonEmpty(extraFilesSecretsDir) && !args.yes) throw new Error(`target extra-files secrets dir not empty (pass --yes): ${extraFilesSecretsDir}`);

    const haveOld = fs.existsSync(legacyLocalFile);
    const haveNew = dirNonEmpty(localSecretsDir);
    if (!haveOld && !haveNew) {
      throw new Error(`no legacy secrets file found (checked: ${legacyLocalFiles.map((f) => path.relative(stackDir, f)).join(", ")})`);
    }

    const nextSops1 = upsertSopsCreationRule({
      existingYaml: existingSops,
      pathRegex: sopsPathRegexForDirFiles(`secrets/hosts/${hostName}`, "yaml"),
      ageRecipients: [hostKeys.publicKey, operatorKeys.publicKey],
    });
    const nextSops1b = removeSopsCreationRule({ existingYaml: nextSops1, pathRegex: sopsPathRegexForPathSuffix(`secrets/hosts/${hostName}.yaml`) });
    const nextSops2 = removeSopsCreationRule({ existingYaml: nextSops1b, pathRegex: sopsPathRegexForDirFiles(`.clawdlets/secrets/hosts/${hostName}`, "yaml") });

    if (args.dryRun) {
      console.log("planned:");
      for (const f of planned) console.log(`- ${f}`);
      console.log("dry-run");
      return;
    }

    await ensureDir(localSecretsDir);
    await ensureDir(extraFilesSecretsDir);

    if (haveOld) {
      const decrypted = await sopsDecryptYamlFile({ filePath: legacyLocalFile, ageKeyFile: operatorKeyPath, nix });
      const parsed = (YAML.parse(decrypted) as Record<string, unknown>) || {};
      const entries = Object.entries(parsed).filter(([k]) => k !== "sops");
      if (entries.length === 0) throw new Error(`no secrets found in ${legacyLocalFile}`);

      for (const [k, v] of entries) {
        if (!k) continue;
        const secretName = String(k).trim();
        const value = typeof v === "string" ? v : v == null ? "" : String(v);
        const { localPath, extraPath } = resolveLegacySecretPaths({
          localSecretsDir,
          extraFilesSecretsDir,
          secretName,
        });
        const plaintextYaml = YAML.stringify({ [secretName]: value });
        await sopsEncryptYamlToFile({ plaintextYaml, outPath: localPath, configPath: sopsConfigPath, nix });
        const encrypted = fs.readFileSync(localPath, "utf8");
        await writeFileAtomic(extraPath, encrypted, { mode: 0o400 });
      }

      const oldBackup = nextBackupPath(legacyLocalFile);
      fs.renameSync(legacyLocalFile, oldBackup);

      const oldExtraFile = path.join(stackDir, "extra-files", hostName, "var/lib/clawdlets/secrets/hosts", `${hostName}.yaml`);
      if (fs.existsSync(oldExtraFile)) fs.renameSync(oldExtraFile, nextBackupPath(oldExtraFile));
    }

    await writeFileAtomic(sopsConfigPath, nextSops2, { mode: 0o644 });

    const { schemaVersion: _schemaVersion, ...restStack } = (stackRaw as any) || {};
    const nextStack = {
      ...restStack,
      schemaVersion: 3,
      hosts: {
        ...(nextHosts as any),
      },
    };
    await writeFileAtomic(stackFile, `${JSON.stringify(nextStack, null, 2)}\n`);

    console.log(`ok: migrated secrets to ${localSecretsDir}`);
    console.log(`next: clawdlets secrets sync && clawdlets server rebuild --target-host <host> --rev HEAD`);
  },
});
