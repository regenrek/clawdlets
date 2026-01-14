import path from "node:path";
import fs from "node:fs";
import {
  nixShellCapture,
  nixShellCaptureWithInput,
  type NixToolOpts,
} from "./nix-tools.js";
import { capture, captureWithInput, run } from "./run.js";
import { ensureDir, writeFileAtomic } from "./fs-safe.js";
import { withFlakesEnv } from "./nix-flakes.js";

function shellEscapeSingle(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function withSopsAgeKeyEnv(params: {
  env?: NodeJS.ProcessEnv;
  ageKeyFile?: string;
}): NodeJS.ProcessEnv {
  const env = { ...withFlakesEnv(params.env) };
  const hasExplicitKey =
    Boolean(env.SOPS_AGE_KEY) ||
    Boolean(env.SOPS_AGE_KEY_CMD) ||
    Boolean(env.SOPS_AGE_SSH_PRIVATE_KEY_FILE);
  const candidateFile = params.ageKeyFile || env.SOPS_AGE_KEY_FILE;
  if (!hasExplicitKey && candidateFile && fs.existsSync(candidateFile)) {
    // Avoid exporting the raw key; use a command to read from disk.
    env.SOPS_AGE_KEY_CMD = `cat ${shellEscapeSingle(candidateFile)}`;
  }
  if (params.ageKeyFile) env.SOPS_AGE_KEY_FILE = params.ageKeyFile;
  return env;
}

let cachedHasSops: boolean | null = null;
async function hasSopsBinary(opts: NixToolOpts): Promise<boolean> {
  if (cachedHasSops !== null) return cachedHasSops;
  try {
    await capture("sops", ["--version"], { cwd: opts.cwd, env: withFlakesEnv(opts.env) });
    cachedHasSops = true;
  } catch {
    cachedHasSops = false;
  }
  return cachedHasSops;
}

export async function sopsDecryptYamlFile(params: {
  filePath: string;
  filenameOverride?: string;
  configPath?: string;
  ageKeyFile?: string;
  nix: NixToolOpts;
}): Promise<string> {
  const env = withSopsAgeKeyEnv({ env: params.nix.env, ageKeyFile: params.ageKeyFile });
  const args = [
    ...(params.configPath ? (["--config", params.configPath] as const) : []),
    "decrypt",
    "--input-type",
    "yaml",
    "--output-type",
    "yaml",
  ];
  if (params.filenameOverride) args.push("--filename-override", params.filenameOverride);
  args.push(params.filePath);
  const hasSops = await hasSopsBinary(params.nix);
  if (hasSops) {
    return await capture("sops", args, { cwd: params.nix.cwd, env });
  }
  return await nixShellCapture("sops", "sops", args, { ...params.nix, env });
}

export async function sopsEncryptYamlToFile(params: {
  plaintextYaml: string;
  outPath: string;
  filenameOverride?: string;
  configPath?: string;
  nix: NixToolOpts;
}): Promise<void> {
  const outDir = path.dirname(params.outPath);
  await ensureDir(outDir);
  const filenameOverride = params.filenameOverride || params.outPath;

  const sopsArgs = [
    ...(params.configPath ? (["--config", params.configPath] as const) : []),
    "encrypt",
    "--input-type",
    "yaml",
    "--output-type",
    "yaml",
    "--filename-override",
    filenameOverride,
    "/dev/stdin",
  ];
  if (params.nix.dryRun) {
    const hasSops = await hasSopsBinary(params.nix);
    if (hasSops) {
      await run("sops", sopsArgs, { ...params.nix, env: withSopsAgeKeyEnv({ env: params.nix.env }) });
    } else {
      const nixArgs = ["shell", "nixpkgs#sops", "-c", "sops", ...sopsArgs];
      await run(params.nix.nixBin, nixArgs, {
        ...params.nix,
        env: withSopsAgeKeyEnv({ env: params.nix.env }),
      });
    }
    return;
  }

  const plaintext = params.plaintextYaml.endsWith("\n")
    ? params.plaintextYaml
    : `${params.plaintextYaml}\n`;
  const env = withSopsAgeKeyEnv({ env: params.nix.env });
  const hasSops = await hasSopsBinary(params.nix);
  const encrypted = hasSops
    ? await captureWithInput("sops", sopsArgs, plaintext, { cwd: params.nix.cwd, env })
    : await nixShellCaptureWithInput("sops", "sops", sopsArgs, plaintext, { ...params.nix, env });
  const normalized = encrypted.endsWith("\n") ? encrypted : `${encrypted}\n`;
  await writeFileAtomic(params.outPath, normalized, { mode: 0o600 });
}
