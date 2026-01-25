import path from "node:path";
import { assertSafeSecretName } from "@clawdlets/shared/lib/identifiers";

function assertPathWithinDir(rootDir: string, absPath: string): void {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(absPath);
  const rel = path.relative(root, resolved);
  if (rel === "" || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes dir: ${resolved}`);
  }
}

export function resolveLegacySecretPaths(params: {
  localSecretsDir: string;
  extraFilesSecretsDir: string;
  secretName: string;
}): { localPath: string; extraPath: string } {
  const secretName = params.secretName.trim();
  assertSafeSecretName(secretName);
  const localPath = path.resolve(params.localSecretsDir, `${secretName}.yaml`);
  const extraPath = path.resolve(params.extraFilesSecretsDir, `${secretName}.yaml`);
  assertPathWithinDir(params.localSecretsDir, localPath);
  assertPathWithinDir(params.extraFilesSecretsDir, extraPath);
  return { localPath, extraPath };
}
