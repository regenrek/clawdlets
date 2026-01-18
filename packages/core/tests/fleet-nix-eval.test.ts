import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { withFlakesEnv } from "../src/lib/nix-flakes";

const NIX_EVAL_TIMEOUT_MS = 120_000;

function resolveRepoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..");
}

function hasNix(): boolean {
  try {
    execFileSync("nix", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("fleet nix eval", () => {
  const testIt = hasNix() && fs.existsSync(resolveRepoRoot()) ? it : it.skip;

  testIt(
    "fails when no bots are configured",
    async () => {
      const repoRoot = resolveRepoRoot();
      const expr = [
        "let",
        "  flake = builtins.getFlake (toString ./.);",
        "  lib = flake.inputs.nixpkgs.lib;",
        "  project = {",
        "    root = flake.outPath;",
        "    config = { fleet = { botOrder = []; bots = {}; }; };",
        "  };",
        "  fleet = import (flake.outPath + \"/nix/lib/fleet-config.nix\") { inherit lib project; };",
        "in fleet.bots",
      ].join("\n");

      expect(() =>
        execFileSync("nix", ["eval", "--impure", "--json", "--expr", expr], {
          cwd: repoRoot,
          env: withFlakesEnv(process.env),
          stdio: "pipe",
        }),
      ).toThrow();
    },
    NIX_EVAL_TIMEOUT_MS,
  );
});
