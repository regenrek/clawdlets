#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function rmForce(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const srcDir = path.join(repoRoot, "packages", "core", "src", "assets");
  const distDir = path.join(repoRoot, "packages", "core", "dist", "assets");

  if (!fs.existsSync(srcDir)) {
    console.error(`copy-core-assets: missing ${srcDir}`);
    process.exit(1);
  }

  rmForce(distDir);
  ensureDir(path.dirname(distDir));
  fs.cpSync(srcDir, distDir, { recursive: true });
}

main();

