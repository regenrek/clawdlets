import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { run } from "@clawdbot/clawdlets-core/lib/run";

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => reject(err));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function createSecretsTar(params: {
  hostName: string;
  localDir: string;
}): Promise<{ tarPath: string; digest: string; files: string[] }> {
  if (!fs.existsSync(params.localDir)) {
    throw new Error(`missing local secrets dir: ${params.localDir}`);
  }

  const entries = fs.readdirSync(params.localDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
    .map((e) => e.name)
    .sort();

  if (files.length === 0) {
    throw new Error(`no secrets found in ${params.localDir}`);
  }

  const tarPath = path.join(os.tmpdir(), `clawdlets-secrets.${params.hostName}.${process.pid}.tgz`);

  await run("tar", ["-C", params.localDir, "-czf", tarPath, ...files], { redact: [] });

  const digest = await sha256File(tarPath);
  return { tarPath, digest, files };
}
