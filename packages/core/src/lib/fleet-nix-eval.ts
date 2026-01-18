import { z } from "zod";
import { capture } from "./run.js";
import type { FleetConfig } from "./fleet-policy.js";
import { withFlakesEnv } from "./nix-flakes.js";

const FleetConfigSchema = z.object({
  bots: z.array(z.string()).default([]),
  botProfiles: z.record(z.any()).default({}),
});

export async function evalFleetConfig(params: {
  repoRoot: string;
  nixBin: string;
}): Promise<FleetConfig> {
  const expr = [
    "let",
    "  flake = builtins.getFlake (toString ./.);",
    "  lib = flake.inputs.clawdlets.inputs.nixpkgs.lib;",
    "  project = {",
    "    root = flake.outPath;",
    "    config = builtins.fromJSON (builtins.readFile (flake.outPath + \"/fleet/clawdlets.json\"));",
    "  };",
    "  fleet = import (flake.inputs.clawdlets.outPath + \"/nix/lib/fleet-config.nix\") { inherit lib project; };",
    "in {",
    "  bots = fleet.bots;",
    "  botProfiles = fleet.botProfiles;",
    "}",
  ].join("\n");

  const out = await capture(params.nixBin, ["eval", "--impure", "--json", "--expr", expr], {
    cwd: params.repoRoot,
    env: withFlakesEnv(process.env),
  });

  const parsed = FleetConfigSchema.safeParse(JSON.parse(out));
  if (!parsed.success) {
    throw new Error(`invalid fleet JSON (nix eval): ${parsed.error.message}`);
  }
  return parsed.data as FleetConfig;
}
