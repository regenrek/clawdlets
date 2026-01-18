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

function evalSudoExtraConfig(deployEnabled: boolean): string {
  const expr = `
let
  flake = builtins.getFlake (toString ./.);
  system = "x86_64-linux";
  hostName = "clawdbot-fleet-host";
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
      ({ ... }: { clawdlets.operator.deploy.enable = lib.mkForce ${deployEnabled ? "true" : "false"}; })
    ];
  }).config;
in cfg.security.sudo.extraConfig
`;

  return execFileSync("nix", ["eval", "--impure", "--raw", "--expr", expr], {
    cwd: resolveRepoRoot(),
    env: process.env,
    encoding: "utf8",
  }).trim();
}

describe("sudo deploy allowlist", () => {
  const testIt = hasNix() && fs.existsSync(resolveRepoRoot()) ? it : it.skip;

  testIt(
    "omits deploy sudo alias when disabled",
    () => {
      const extra = evalSudoExtraConfig(false);
      expect(extra).not.toContain("CLAWDLETS_DEPLOY");
    },
    NIX_EVAL_TIMEOUT_MS,
  );

  testIt(
    "includes deploy sudo alias when enabled",
    () => {
      const extra = evalSudoExtraConfig(true);
      expect(extra).toContain("CLAWDLETS_DEPLOY");
    },
    NIX_EVAL_TIMEOUT_MS,
  );
});
