import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import YAML from "yaml";
import { parseAgeKeyFile } from "@clawdbot/clawdlets-core/lib/age";
import { ensureDir, writeFileAtomic } from "@clawdbot/clawdlets-core/lib/fs-safe";
import { removeSopsCreationRule, sopsPathRegexForDirFiles, sopsPathRegexForPathSuffix, upsertSopsCreationRule } from "@clawdbot/clawdlets-core/lib/sops-config";
import { sopsDecryptYamlFile, sopsEncryptYamlToFile } from "@clawdbot/clawdlets-core/lib/sops";
import { readDotenvFile, nextBackupPath, resolveRepoRootFromStackDir, sanitizeOperatorId } from "./common.js";

export const secretsMigrate = defineCommand({
  meta: {
    name: "migrate",
    description: "Migrate legacy single-file host secrets to per-secret files (one secret per file).",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: clawdbot-fleet-host).", default: "clawdbot-fleet-host" },
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

    const hostName = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";

    let stackRaw: unknown;
    try {
      stackRaw = JSON.parse(fs.readFileSync(stackFile, "utf8"));
    } catch {
      throw new Error(`invalid JSON: ${stackFile}`);
    }

    const stackObj = stackRaw as { schemaVersion?: unknown; envFile?: unknown; hosts?: Record<string, any> };
    const schemaVersion = Number(stackObj.schemaVersion);
    if (!Number.isFinite(schemaVersion) || (schemaVersion !== 1 && schemaVersion !== 2)) {
      throw new Error(`unsupported stack.schemaVersion: ${String(stackObj.schemaVersion)}`);
    }
    const hosts = stackObj.hosts || {};
    const host = hosts[hostName];
    if (!host) throw new Error(`unknown host: ${hostName}`);

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

    const oldLocalFile = (() => {
      if (schemaVersion === 1) {
        const localFile = host.secrets?.localFile;
        if (localFile) return path.join(stackDir, String(localFile));
      }
      return path.join(stackDir, "secrets", "hosts", `${hostName}.yaml`);
    })();

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

    const nextHosts =
      schemaVersion === 2
        ? hosts
        : Object.fromEntries(
            Object.entries(hosts).map(([name, h]) => {
              const next = toDirSecrets(h?.secrets);
              return [name, { ...(h as any), secrets: next }];
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

    const planned: string[] = [];
    planned.push(stackFile);
    planned.push(sopsConfigPath);
    planned.push(localSecretsDir);
    planned.push(extraFilesSecretsDir);
    if (fs.existsSync(oldLocalFile)) planned.push(oldLocalFile);

    const dirNonEmpty = (dir: string) => fs.existsSync(dir) && fs.readdirSync(dir).some((n) => n && n !== "." && n !== "..");
    if (dirNonEmpty(localSecretsDir) && !args.yes) throw new Error(`target secrets dir not empty (pass --yes): ${localSecretsDir}`);
    if (dirNonEmpty(extraFilesSecretsDir) && !args.yes) throw new Error(`target extra-files secrets dir not empty (pass --yes): ${extraFilesSecretsDir}`);

    const haveOld = fs.existsSync(oldLocalFile);
    const haveNew = dirNonEmpty(localSecretsDir);
    if (!haveOld && !haveNew) throw new Error(`no legacy secrets file found: ${oldLocalFile}`);

    const nextSops1 = upsertSopsCreationRule({
      existingYaml: existingSops,
      pathRegex: sopsPathRegexForDirFiles(`secrets/hosts/${hostName}`, "yaml"),
      ageRecipients: [hostKeys.publicKey, operatorKeys.publicKey],
    });
    const nextSops1b = removeSopsCreationRule({ existingYaml: nextSops1, pathRegex: sopsPathRegexForPathSuffix(`secrets/hosts/${hostName}.yaml`) });
    const nextSops1c = removeSopsCreationRule({ existingYaml: nextSops1b, pathRegex: sopsPathRegexForPathSuffix(`.clawdlets/secrets/hosts/${hostName}.yaml`) });
    const nextSops2 = removeSopsCreationRule({ existingYaml: nextSops1c, pathRegex: sopsPathRegexForDirFiles(`.clawdlets/secrets/hosts/${hostName}`, "yaml") });

    if (args.dryRun) {
      console.log("planned:");
      for (const f of planned) console.log(`- ${f}`);
      console.log("dry-run");
      return;
    }

    await ensureDir(localSecretsDir);
    await ensureDir(extraFilesSecretsDir);

    if (haveOld) {
      const decrypted = await sopsDecryptYamlFile({ filePath: oldLocalFile, ageKeyFile: operatorKeyPath, nix });
      const parsed = (YAML.parse(decrypted) as Record<string, unknown>) || {};
      const entries = Object.entries(parsed).filter(([k]) => k !== "sops");
      if (entries.length === 0) throw new Error(`no secrets found in ${oldLocalFile}`);

      for (const [k, v] of entries) {
        if (!k) continue;
        const secretName = String(k).trim();
        const value = typeof v === "string" ? v : v == null ? "" : String(v);
        const outPath = path.join(localSecretsDir, `${secretName}.yaml`);
        const plaintextYaml = YAML.stringify({ [secretName]: value });
        await sopsEncryptYamlToFile({ plaintextYaml, outPath, nix });
        const encrypted = fs.readFileSync(outPath, "utf8");
        await writeFileAtomic(path.join(extraFilesSecretsDir, `${secretName}.yaml`), encrypted, { mode: 0o400 });
      }

      const oldBackup = nextBackupPath(oldLocalFile);
      fs.renameSync(oldLocalFile, oldBackup);

      const oldExtraFile = path.join(stackDir, "extra-files", hostName, "var/lib/clawdlets/secrets/hosts", `${hostName}.yaml`);
      if (fs.existsSync(oldExtraFile)) fs.renameSync(oldExtraFile, nextBackupPath(oldExtraFile));
    }

    await writeFileAtomic(sopsConfigPath, nextSops2, { mode: 0o644 });

    const nextStack =
      schemaVersion === 2
        ? stackRaw
        : {
            ...(stackRaw as any),
            schemaVersion: 2,
            hosts: {
              ...(nextHosts as any),
            },
          };
    await writeFileAtomic(stackFile, `${JSON.stringify(nextStack, null, 2)}\n`);

    console.log(`ok: migrated secrets to ${localSecretsDir}`);
    console.log(`next: clawdlets secrets sync --host ${hostName} && clawdlets server rebuild --target-host <host> --rev HEAD`);
  },
});
