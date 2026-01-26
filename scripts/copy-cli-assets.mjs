#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const srcDir = path.join(repoRoot, "packages", "core", "src", "assets");
  const distDir = path.join(repoRoot, "packages", "cli", "dist", "assets");

  if (!fs.existsSync(srcDir)) {
    console.error(`copy-cli-assets: missing ${srcDir}`);
    process.exit(1);
  }

  ensureDir(distDir);
  fs.cpSync(srcDir, distDir, { recursive: true });
}

main();
