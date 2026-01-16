import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { run } from "./run.js";

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => reject(err));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function listYamlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
    .map((e) => e.name)
    .sort();
}

export async function createSecretsTar(params: {
  hostName: string;
  localDir: string;
}): Promise<{ tarPath: string; digest: string; files: string[] }> {
  if (!fs.existsSync(params.localDir)) {
    throw new Error(`missing local secrets dir: ${params.localDir}`);
  }

  const files = listYamlFiles(params.localDir);
  if (files.length === 0) {
    throw new Error(`no secrets found in ${params.localDir}`);
  }

  const tarPath = path.join(os.tmpdir(), `clawdlets-secrets.${params.hostName}.${process.pid}.tgz`);
  const tarPathRaw = path.join(os.tmpdir(), `clawdlets-secrets.${params.hostName}.${process.pid}.tar`);
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), `clawdlets-secrets-stage.${params.hostName}.`));

  try {
    for (const file of files) {
      const src = path.join(params.localDir, file);
      const dest = path.join(stageDir, file);
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o400);
      fs.utimesSync(dest, 0, 0);
    }

    await run("tar", ["--owner=0", "--group=0", "--numeric-owner", "-C", stageDir, "-cf", tarPathRaw, ...files], { redact: [] });
    await run("gzip", ["-n", "-f", tarPathRaw], { redact: [] });
    if (!fs.existsSync(tarPath) && fs.existsSync(`${tarPathRaw}.gz`)) {
      fs.renameSync(`${tarPathRaw}.gz`, tarPath);
    }
  } finally {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  const digest = await sha256File(tarPath);
  return { tarPath, digest, files };
}
