import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function resolveTemplateTestDir(params: { repoRoot: string; destRoot: string }): string {
  const repoReal = fs.realpathSync(params.repoRoot);
  const expected = path.join(repoReal, "packages", "core", "tests", ".template");
  const destAbs = path.resolve(params.destRoot);
  const destReal = fs.existsSync(destAbs) ? fs.realpathSync(destAbs) : destAbs;

  const root = path.parse(destReal).root;
  if (destReal === root) throw new Error("template test dir cannot be filesystem root");
  if (destReal === repoReal) throw new Error("template test dir cannot be repo root");
  if (destReal === os.homedir()) throw new Error("template test dir cannot be $HOME");

  const suffix = path.join("packages", "core", "tests", ".template");
  if (!destReal.endsWith(path.sep + suffix) && destReal !== expected) {
    throw new Error(`template test dir must end with ${suffix}`);
  }

  const parent = path.dirname(destReal);
  const parentReal = fs.realpathSync(parent);
  const resolved = path.join(parentReal, path.basename(destReal));

  if (resolved !== expected) {
    throw new Error(`template test dir must resolve to ${expected}`);
  }

  return resolved;
}
