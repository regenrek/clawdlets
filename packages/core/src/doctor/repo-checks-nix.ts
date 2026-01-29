import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { capture } from "../lib/run.js";
import { withFlakesEnv } from "../lib/nix-flakes.js";

export async function evalWheelAccess(params: { repoRoot: string; nixBin: string; host: string }): Promise<{
  adminHasWheel: boolean;
  breakglassHasWheel: boolean;
} | null> {
  const expr = [
    "let",
    "  flake = builtins.getFlake (toString ./.);",
    `  cfg = flake.nixosConfigurations.${JSON.stringify(params.host)}.config;`,
    "  admin = cfg.users.users.admin or {};",
    "  breakglass = cfg.users.users.breakglass or {};",
    "  adminGroups = admin.extraGroups or [];",
    "  breakglassGroups = breakglass.extraGroups or [];",
    "in {",
    "  adminHasWheel = builtins.elem \"wheel\" adminGroups;",
    "  breakglassHasWheel = builtins.elem \"wheel\" breakglassGroups;",
    "}",
  ].join("\n");
  try {
    const out = await capture(params.nixBin, ["eval", "--impure", "--json", "--expr", expr], {
      cwd: params.repoRoot,
      env: withFlakesEnv(process.env),
    });
    const parsed = JSON.parse(out);
    return {
      adminHasWheel: Boolean(parsed?.adminHasWheel),
      breakglassHasWheel: Boolean(parsed?.breakglassHasWheel),
    };
  } catch {
    return null;
  }
}

export function getClawdletsRevFromFlakeLock(repoRoot: string): string | null {
  const flakeLockPath = path.join(repoRoot, "flake.lock");
  if (!fs.existsSync(flakeLockPath)) return null;
  try {
    const lock = JSON.parse(fs.readFileSync(flakeLockPath, "utf8"));
    const rev = lock?.nodes?.clawdlets?.locked?.rev;
    return typeof rev === "string" && rev.trim() ? rev.trim() : null;
  } catch {
    return null;
  }
}
