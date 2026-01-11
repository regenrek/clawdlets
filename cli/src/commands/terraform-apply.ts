import { defineCommand } from "citty";
import { loadFleetEnv } from "@clawdbot/clawdlets-core/lib/env";
import { applyTerraform } from "@clawdbot/clawdlets-core/lib/terraform";

export const terraformApply = defineCommand({
  meta: {
    name: "terraform-apply",
    description: "Run terraform apply (ensures Hetzner SSH key id).",
  },
  args: {
    envFile: {
      type: "string",
      description: "Path to .env file (default: repo root .env if present).",
    },
    serverType: {
      type: "string",
      description: "Override SERVER_TYPE (Hetzner server type).",
    },
    "public-ssh": {
      type: "boolean",
      description: "Whether to allow public SSH from ADMIN_CIDR.",
      default: false,
    },
    dryRun: {
      type: "boolean",
      description: "Print commands without executing.",
      default: false,
    },
  },
  async run({ args }) {
    const loaded = loadFleetEnv({ cwd: process.cwd(), envFile: args.envFile });
    await applyTerraform({
      loaded,
      serverType: args.serverType,
      publicSsh: Boolean((args as any)["public-ssh"]),
      dryRun: args.dryRun,
    });
  },
});
