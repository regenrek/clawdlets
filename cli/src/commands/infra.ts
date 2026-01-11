import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { applyTerraformVars } from "@clawdbot/clawdlets-core/lib/terraform";
import { expandPath } from "@clawdbot/clawdlets-core/lib/path-expand";
import { loadStack, loadStackEnv } from "@clawdbot/clawdlets-core/stack";

function getHost(stackHosts: Record<string, unknown>, host: string): unknown {
  const h = stackHosts[host];
  if (!h) throw new Error(`unknown host: ${host}`);
  return h;
}

const infraApply = defineCommand({
  meta: {
    name: "apply",
    description: "Apply Hetzner terraform for a host (public SSH toggle lives in server/lockdown).",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: clawdbot-fleet-host).", default: "clawdbot-fleet-host" },
    "public-ssh": {
      type: "boolean",
      description: "Whether public SSH (22) is open in Hetzner firewall.",
      default: false,
    },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    const host = getHost(stack.hosts, hostName) as typeof stack.hosts[string];

    const envLoaded = loadStackEnv({ cwd: process.cwd(), stackDir: args.stackDir, envFile: stack.envFile });
    const hcloudToken = String(envLoaded.env.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set it in stack env file)");

    const sshPubkeyFile = expandPath(host.terraform.sshPubkeyFile);
    if (!fs.existsSync(sshPubkeyFile)) throw new Error(`ssh pubkey file not found: ${sshPubkeyFile}`);

    await applyTerraformVars({
      repoRoot: layout.repoRoot,
      vars: {
        hcloudToken,
        adminCidr: host.terraform.adminCidr,
        sshPubkeyFile,
        serverType: host.hetzner.serverType,
        publicSsh: Boolean((args as any)["public-ssh"]),
      },
      nixBin: envLoaded.env.NIX_BIN || "nix",
      dryRun: args.dryRun,
      redact: [hcloudToken, envLoaded.env.GITHUB_TOKEN].filter(Boolean) as string[],
    });

    console.log(`ok: terraform applied for ${hostName}`);
    console.log(`hint: outputs in ${path.join(layout.repoRoot, "infra", "terraform")}`);
  },
});

export const infra = defineCommand({
  meta: {
    name: "infra",
    description: "Infrastructure operations (Hetzner Terraform).",
  },
  subCommands: {
    apply: infraApply,
  },
});
