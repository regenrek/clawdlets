import fs from "node:fs";

import { looksLikeSshPrivateKey, parseSshPublicKeysFromText } from "./ssh.js";

export function parseKnownHostsFromText(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (lines.length === 0) throw new Error("no known_hosts entries found");
  return lines;
}

export function readSshPublicKeysFromFile(filePath: string): string[] {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`not a file: ${filePath}`);
  if (stat.size > 64 * 1024) throw new Error(`ssh key file too large (>64KB): ${filePath}`);

  const raw = fs.readFileSync(filePath, "utf8");
  if (looksLikeSshPrivateKey(raw)) {
    throw new Error(`refusing to read ssh private key (expected .pub): ${filePath}`);
  }

  const keys = parseSshPublicKeysFromText(raw);
  if (keys.length === 0) throw new Error(`no ssh public keys found in file: ${filePath}`);
  return keys;
}

export function readKnownHostsFromFile(filePath: string): string[] {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`not a file: ${filePath}`);
  if (stat.size > 256 * 1024) throw new Error(`known_hosts file too large (>256KB): ${filePath}`);

  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return parseKnownHostsFromText(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "no known_hosts entries found") {
      throw new Error(`no known_hosts entries found in file: ${filePath}`);
    }
    throw err;
  }
}
