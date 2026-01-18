import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const NIX_EVAL_TIMEOUT_MS = 120_000;

function resolveRepoRoot(): string {
  return path.resolve(process.env.CLAWDLETS_TEMPLATE_DIR || path.join(__dirname, ".template"));
}

function hasNix(): boolean {
  try {
    execFileSync("nix", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("sudo policy (host)", () => {
  const testIt = hasNix() && fs.existsSync(resolveRepoRoot()) ? it : it.skip;

  testIt(
    "does not allow wildcard nixos-rebuild flake rebuilds in sudoers",
    () => {
      const repoRoot = resolveRepoRoot();
      const cfgPath = path.join(repoRoot, "fleet", "clawdlets.json");
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as any;
      const host = Object.keys((cfg && typeof cfg === "object" ? (cfg as any).hosts : null) || {})[0] || "clawdbot-fleet-host";

      const expr = `
let
  flake = builtins.getFlake (toString ./.);
  system = "x86_64-linux";
  hostName = ${JSON.stringify(host)};
  nixpkgs = flake.inputs.clawdlets.inputs.nixpkgs;
  lib = nixpkgs.lib;
  project = {
    root = flake.outPath;
    config = builtins.fromJSON (builtins.readFile (flake.outPath + "/fleet/clawdlets.json"));
  };
  cfg = (lib.nixosSystem {
    inherit system;
    specialArgs = {
      clawdlets = flake.inputs.clawdlets;
      nix-clawdbot = flake.inputs.clawdlets.inputs.nix-clawdbot;
      inherit project;
      flakeInfo = { clawdlets = { rev = null; lastModifiedDate = null; }; };
    };
    modules = [
      flake.inputs.clawdlets.inputs.disko.nixosModules.disko
      flake.inputs.clawdlets.inputs.nixos-generators.nixosModules.all-formats
      flake.inputs.clawdlets.inputs.sops-nix.nixosModules.sops
      flake.inputs.clawdlets.nixosModules.clawdletsProjectHost
      ({ ... }: { clawdlets.hostName = hostName; })
    ];
  }).config;
in cfg.security.sudo.extraConfig
`;

      const extra = execFileSync("nix", ["eval", "--impure", "--raw", "--expr", expr], {
        cwd: repoRoot,
        env: process.env,
        encoding: "utf8",
      }).trim();

      expect(extra.includes("--flake *")).toBe(false);
      expect(/Cmnd_Alias\s+CLAWDBOT_REBUILD\b/.test(extra)).toBe(false);
    },
    NIX_EVAL_TIMEOUT_MS,
  );
});
