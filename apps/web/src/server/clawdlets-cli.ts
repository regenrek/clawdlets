import fs from "node:fs";
import path from "node:path";

export function resolveClawdletsCliEntry(): string {
  const candidates = [
    path.resolve(process.cwd(), "packages/cli/dist/main.mjs"),
    path.resolve(process.cwd(), "../packages/cli/dist/main.mjs"),
    path.resolve(process.cwd(), "../../packages/cli/dist/main.mjs"),
    path.resolve(process.cwd(), "../../../packages/cli/dist/main.mjs"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error("unable to find clawdlets CLI entry (packages/cli/dist/main.mjs). Run `pnpm -C packages/cli build`.");
}

