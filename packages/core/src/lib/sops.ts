import path from "node:path";
import {
  nixShellCapture,
  nixShellCaptureWithInput,
  type NixToolOpts,
} from "./nix-tools.js";
import { run } from "./run.js";
import { ensureDir, writeFileAtomic } from "./fs-safe.js";
import { withFlakesEnv } from "./nix-flakes.js";

export async function sopsDecryptYamlFile(params: {
  filePath: string;
  filenameOverride?: string;
  configPath?: string;
  ageKeyFile?: string;
  nix: NixToolOpts;
}): Promise<string> {
  const env = {
    ...withFlakesEnv(params.nix.env),
    ...(params.ageKeyFile ? { SOPS_AGE_KEY_FILE: params.ageKeyFile } : {}),
  };
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
  return await nixShellCapture(
    "sops",
    "sops",
    args,
    { ...params.nix, env },
  );
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

  const nixArgs = [
    "shell",
    "nixpkgs#sops",
    "-c",
    "sops",
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
    await run(params.nix.nixBin, nixArgs, {
      ...params.nix,
      env: withFlakesEnv(params.nix.env),
    });
    return;
  }

  const plaintext = params.plaintextYaml.endsWith("\n")
    ? params.plaintextYaml
    : `${params.plaintextYaml}\n`;
  const encrypted = await nixShellCaptureWithInput(
    "sops",
    "sops",
    nixArgs.slice(4),
    plaintext,
    {
      ...params.nix,
      env: withFlakesEnv(params.nix.env),
    },
  );
  const normalized = encrypted.endsWith("\n") ? encrypted : `${encrypted}\n`;
  await writeFileAtomic(params.outPath, normalized, { mode: 0o600 });
}
