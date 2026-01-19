import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolvePackageRoot(fromUrl: string = import.meta.url): string {
  let dir = path.dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return path.dirname(fileURLToPath(fromUrl));
}

export function readCliVersion(rootDir: string = resolvePackageRoot()): string {
  const pkgPath = path.join(rootDir, "package.json");
  const raw = fs.readFileSync(pkgPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("missing version in package.json");
  }
  return parsed.version;
}
