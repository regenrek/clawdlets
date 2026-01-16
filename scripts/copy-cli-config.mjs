import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const src = path.join(repoRoot, "config", "template-source.json");
const dest = path.join(repoRoot, "cli", "dist", "config", "template-source.json");

if (!fs.existsSync(src)) {
  throw new Error(`missing template source config: ${src}`);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
