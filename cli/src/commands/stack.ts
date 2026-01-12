import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { zodToJsonSchema } from "zod-to-json-schema";
import { tryGetOriginFlake } from "@clawdbot/clawdlets-core/lib/git";
import { ensureDir, writeFileAtomic } from "@clawdbot/clawdlets-core/lib/fs-safe";
import { validateTargetHost } from "@clawdbot/clawdlets-core/lib/ssh-remote";
import { StackSchema, getStackLayout, loadStack, loadStackEnv, resolveStackBaseFlake } from "@clawdbot/clawdlets-core/stack";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../lib/wizard.js";

function requireTty(): void {
  if (!process.stdout.isTTY) throw new Error("requires a TTY (interactive)");
}

function wantsInteractive(flag: boolean | undefined): boolean {
  if (flag) return true;
  const env = String(process.env["CLAWDLETS_INTERACTIVE"] || "").trim();
  return env === "1" || env.toLowerCase() === "true";
}

function getDefaultSshPubkeyFile(): string {
  const home = process.env.HOME || "";
  const candidates = [
    path.join(home, ".ssh", "id_ed25519.pub"),
    path.join(home, ".ssh", "id_rsa.pub"),
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return path.join(home, ".ssh", "id_ed25519.pub");
}

function readSshConfigHostAliases(): string[] {
  const home = process.env.HOME || "";
  const sshConfig = path.join(home, ".ssh", "config");
  if (!home || !fs.existsSync(sshConfig)) return [];
  const raw = fs.readFileSync(sshConfig, "utf8");
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*Host\s+(.+)\s*$/i);
    if (!m) continue;
    const parts = m[1]!.trim().split(/\s+/g);
    for (const p0 of parts) {
      const p1 = p0.trim();
      if (!p1) continue;
      if (p1 === "*" || p1.includes("*") || p1.includes("?") || p1.startsWith("!")) continue;
      if (!out.includes(p1)) out.push(p1);
      if (out.length >= 30) return out;
    }
  }
  return out;
}

async function writeStackSchemaJson(outFile: string): Promise<void> {
  const schema = zodToJsonSchema(StackSchema, {
    name: "ClawdletsStack",
    $refStrategy: "none",
  });
  await writeFileAtomic(outFile, `${JSON.stringify(schema, null, 2)}\n`);
}

const stackInit = defineCommand({
  meta: {
    name: "init",
    description: "Create a new local stack in .clawdlets/ (gitignored).",
  },
  args: {
    stackDir: {
      type: "string",
      description: "Stack directory (default: .clawdlets).",
    },
    host: {
      type: "string",
      description: "Host name (default: clawdbot-fleet-host).",
      default: "clawdbot-fleet-host",
    },
    flake: { type: "string", description: "Base flake URI (optional)." },
    targetHost: { type: "string", description: "SSH target for post-install ops (optional)." },
    serverType: { type: "string", description: "Hetzner server type (default: cx43).", default: "cx43" },
    adminCidr: { type: "string", description: "ADMIN_CIDR (required in non-interactive mode)." },
    sshPubkeyFile: { type: "string", description: "SSH_PUBKEY_FILE (default: ~/.ssh/id_ed25519.pub if present)." },
    hcloudToken: { type: "string", description: "HCLOUD_TOKEN (or set env HCLOUD_TOKEN)." },
    githubToken: { type: "string", description: "GITHUB_TOKEN (optional; or set env GITHUB_TOKEN)." },
    force: { type: "boolean", description: "Overwrite existing stack files.", default: false },
    interactive: { type: "boolean", description: "Prompt for inputs (requires TTY).", default: false },
    dryRun: {
      type: "boolean",
      description: "Print planned files without writing.",
      default: false,
    },
  },
  async run({ args }) {
    const layout = getStackLayout({ cwd: process.cwd(), stackDir: args.stackDir });
    const host = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    const interactive = wantsInteractive(Boolean(args.interactive));
    if (interactive) requireTty();

    const originFlakeFromGit = await tryGetOriginFlake(layout.repoRoot);
    const originFlake = originFlakeFromGit ?? "github:<owner>/<repo>";

    if (!interactive) {
      const baseFlake = String(args.flake || "").trim();
      const targetHostInput = String(args.targetHost || "").trim();
      if (targetHostInput) validateTargetHost(targetHostInput);
      const serverType = String(args.serverType || "cx43").trim() || "cx43";
      if (/^cax/i.test(serverType)) throw new Error("ARM (CAX) not supported (this repo builds x86_64-linux; use CX/CPX/CCX)");

      const adminCidr = String(args.adminCidr || "").trim();
      if (!adminCidr) throw new Error("missing --admin-cidr");

      const sshPubkeyFile = String(args.sshPubkeyFile || getDefaultSshPubkeyFile()).trim();
      if (!sshPubkeyFile) throw new Error("missing --ssh-pubkey-file");

      const hcloudToken = String(args.hcloudToken || process.env.HCLOUD_TOKEN || "").trim();
      if (!hcloudToken) throw new Error("missing --hcloud-token (or env HCLOUD_TOKEN)");

      const githubToken = String(args.githubToken || process.env.GITHUB_TOKEN || "").trim();

      const stack = {
        schemaVersion: 3,
        ...(baseFlake ? { base: { flake: baseFlake } } : {}),
        envFile: ".env",
        hosts: {
          [host]: {
            flakeHost: host,
            ...(targetHostInput ? { targetHost: targetHostInput } : {}),
            hetzner: { serverType },
            opentofu: {
              adminCidr,
              sshPubkeyFile,
            },
            secrets: {
              localDir: `secrets/hosts/${host}`,
              remoteDir: `/var/lib/clawdlets/secrets/hosts/${host}`,
            },
          },
        },
      };

      const envLines = [
        `HCLOUD_TOKEN=${JSON.stringify(hcloudToken)}`,
        ...(githubToken ? [`GITHUB_TOKEN=${JSON.stringify(githubToken)}`] : []),
        "",
      ].join("\n");

      const planned = [
        layout.stackFile,
        layout.envFile,
        path.join(layout.distDir, "stack.schema.json"),
      ];

      if (args.dryRun) {
        console.log(planned.map((f) => `- ${path.relative(layout.repoRoot, f)}`).join("\n"));
        return;
      }

      if (!args.force) {
        if (fs.existsSync(layout.stackFile)) throw new Error(`stack file exists (pass --force): ${layout.stackFile}`);
        if (fs.existsSync(layout.envFile)) throw new Error(`env file exists (pass --force): ${layout.envFile}`);
      }

      await ensureDir(layout.stackDir);
      await ensureDir(layout.distDir);
      await writeFileAtomic(layout.stackFile, `${JSON.stringify(stack, null, 2)}\n`);
      await writeFileAtomic(layout.envFile, envLines, { mode: 0o600 });
      await writeStackSchemaJson(path.join(layout.distDir, "stack.schema.json"));

      const nextLines: string[] = [];
      nextLines.push(`next: clawdlets secrets init --host ${host}`);
      nextLines.push("next: clawdlets doctor --scope deploy");
      nextLines.push(`next: clawdlets bootstrap --host ${host}`);
      if (!targetHostInput) nextLines.push(`next: clawdlets stack set-target-host --host ${host} --target-host <ssh-alias>`);
      console.log(nextLines.join("\n"));
      return;
    }

    p.intro("clawdlets stack init");
    p.note(
      [
        "HCLOUD_TOKEN: Hetzner Cloud Console → Security → API Tokens (https://console.hetzner.cloud/)",
        "ADMIN_CIDR: your public IPv4 CIDR, usually <your-ip>/32 (example: 203.0.113.10/32)",
        "Tip: curl -4 https://ifconfig.me  # then add /32",
        "GITHUB_TOKEN: only if base flake repo is private. Create fine-grained PAT at https://github.com/settings/personal-access-tokens/new",
        "- Repo access: only select the flake repo",
        "- Repo permissions: Contents = Read-only",
      ].join("\n"),
      "Inputs",
    );

    const flow = "stack init";
    const answers: {
      baseFlake: string;
      connectMode: string;
      targetHost: string;
      serverType: string;
      adminCidr: string;
      sshPubkeyFile: string;
      hcloudToken: string;
      githubToken: string;
    } = {
      baseFlake: "",
      connectMode: "skip",
      targetHost: "",
      serverType: "cx43",
      adminCidr: "",
      sshPubkeyFile: getDefaultSshPubkeyFile(),
      hcloudToken: "",
      githubToken: "",
    };

    const steps: Array<{
      key: keyof typeof answers;
      prompt: () => Promise<unknown>;
      normalize: (v: unknown) => string;
    }> = [
      {
        key: "baseFlake",
        prompt: () =>
          p.text({
            message: "Base flake (blank = current repo origin)",
            placeholder: originFlake,
            defaultValue: answers.baseFlake,
          }),
        normalize: (v) => String(v).trim(),
      },
      {
        key: "connectMode",
        prompt: () =>
          p.select({
            message: "SSH target (for post-install ops)",
            initialValue: answers.connectMode,
            options: [
              { value: "skip", label: "Skip for now (recommended; set after bootstrap)" },
              { value: "alias", label: "SSH config alias (recommended)" },
              { value: "userhost", label: "user@host (advanced)" },
            ],
          }),
        normalize: (v) => String(v).trim(),
      },
      {
        key: "targetHost",
        prompt: async () => {
          const mode = String(answers.connectMode || "skip").trim();
          if (mode === "skip") return "";
          if (mode === "alias") {
            const aliases = readSshConfigHostAliases();
            if (aliases.length > 0) {
              const selected = await p.select({
                message: "Pick SSH alias from ~/.ssh/config",
                options: [
                  ...aliases.map((a) => ({ value: a, label: a })),
                  { value: "__custom__", label: "Custom…" },
                ],
              });
              if (p.isCancel(selected)) return selected;
              if (selected === "__custom__") {
                return p.text({
                  message: "SSH alias (Host in ~/.ssh/config)",
                  validate: (x) => (String(x).trim() ? undefined : "required"),
                });
              }
              return selected;
            }
            return p.text({
              message: "SSH alias (Host in ~/.ssh/config)",
              validate: (x) => (String(x).trim() ? undefined : "required"),
            });
          }
          return p.text({
            message: "SSH target (what you pass to ssh)",
            placeholder: "admin@100.64.0.1",
            validate: (x) => (String(x).trim() ? undefined : "required"),
          });
        },
        normalize: (v) => String(v).trim(),
      },
      {
        key: "serverType",
        prompt: () =>
          p.text({
            message: "Hetzner server type (default: cx43; see https://www.hetzner.com/de/cloud/)",
            defaultValue: answers.serverType,
            validate: (x) => {
              const v = String(x).trim();
              if (!v) return "required";
              if (/^cax/i.test(v)) return "ARM (CAX) not supported (this repo builds x86_64-linux; use CX/CPX/CCX)";
              return undefined;
            },
          }),
        normalize: (v) => String(v).trim(),
      },
      {
        key: "adminCidr",
        prompt: () =>
          p.text({
            message: "ADMIN_CIDR (your public IP CIDR, e.g. 203.0.113.10/32)",
            defaultValue: answers.adminCidr,
            validate: (x) => (String(x).trim() ? undefined : "required"),
          }),
        normalize: (v) => String(v).trim(),
      },
      {
        key: "sshPubkeyFile",
        prompt: () =>
          p.text({
            message: "SSH public key file (SSH_PUBKEY_FILE)",
            defaultValue: answers.sshPubkeyFile,
            validate: (x) => (String(x).trim() ? undefined : "required"),
          }),
        normalize: (v) => String(v).trim(),
      },
      {
        key: "hcloudToken",
        prompt: () =>
          p.password({
            message: "HCLOUD_TOKEN (stored in .clawdlets/.env)",
            validate: (x) => (String(x).trim() ? undefined : "required"),
          }),
        normalize: (v) => String(v).trim(),
      },
      {
        key: "githubToken",
        prompt: () =>
          p.password({
            message: "GITHUB_TOKEN (optional; only if base flake repo is private)",
          }),
        normalize: (v) => String(v).trim(),
      },
    ];

    for (let i = 0; i < steps.length;) {
      const step = steps[i]!;
      const v = await step.prompt();
      if (p.isCancel(v)) {
        const nav = await navOnCancel({ flow, canBack: i > 0 });
        if (nav === NAV_EXIT) {
          cancelFlow();
          return;
        }
        i = Math.max(0, i - 1);
        continue;
      }
      answers[step.key] = step.normalize(v) as never;
      i += 1;
    }

    const baseFlake = String(answers.baseFlake || "").trim();
    const targetHostInput = String(answers.targetHost || "").trim();
    if (targetHostInput) validateTargetHost(targetHostInput);
    const stack = {
      schemaVersion: 3,
      ...(baseFlake ? { base: { flake: baseFlake } } : {}),
      envFile: ".env",
      hosts: {
        [host]: {
          flakeHost: host,
          ...(targetHostInput ? { targetHost: targetHostInput } : {}),
          hetzner: { serverType: answers.serverType },
          opentofu: {
            adminCidr: answers.adminCidr,
            sshPubkeyFile: answers.sshPubkeyFile,
          },
          secrets: {
            localDir: `secrets/hosts/${host}`,
            remoteDir: `/var/lib/clawdlets/secrets/hosts/${host}`,
          },
        },
      },
    };

    const envLines = [
      `HCLOUD_TOKEN=${JSON.stringify(answers.hcloudToken)}`,
      ...(answers.githubToken ? [`GITHUB_TOKEN=${JSON.stringify(answers.githubToken)}`] : []),
      "",
    ].join("\n");

    const planned = [
      layout.stackFile,
      layout.envFile,
      path.join(layout.distDir, "stack.schema.json"),
    ];

    if (args.dryRun) {
      p.note(planned.map((f) => `- ${path.relative(layout.repoRoot, f)}`).join("\n"), "Planned files");
      p.outro("dry-run");
      return;
    }

    await ensureDir(layout.stackDir);
    await ensureDir(layout.distDir);
    await writeFileAtomic(layout.stackFile, `${JSON.stringify(stack, null, 2)}\n`);
    await writeFileAtomic(layout.envFile, envLines, { mode: 0o600 });
    await writeStackSchemaJson(path.join(layout.distDir, "stack.schema.json"));

    if (!baseFlake && !originFlakeFromGit) {
      p.note("No git origin found. Set stack.base.flake (or add git remote origin) before bootstrap.", "base flake");
    }
    if (!targetHostInput) {
      p.note(`Set later with: clawdlets stack set-target-host --host ${host} --target-host <alias|user@host>`, "ssh target");
    }

    const nextLines: string[] = [];
    nextLines.push(`- clawdlets secrets init --host ${host}`);
    nextLines.push("- clawdlets doctor");
    if (!baseFlake && !originFlakeFromGit) {
      nextLines.push("- set git remote origin (so blank base flake works)");
      nextLines.push("  - gh repo create <owner>/<repo> --private --source . --remote origin --push");
    }
    nextLines.push(`- clawdlets bootstrap --host ${host}`);
    if (!targetHostInput) {
      nextLines.push(`- clawdlets stack set-target-host --host ${host} --target-host <ssh-alias>`);
    }
    p.note(nextLines.join("\n"), "Next");
    p.outro(`wrote ${path.relative(layout.repoRoot, layout.stackFile)}`);
  },
});

const stackSetTargetHost = defineCommand({
  meta: {
    name: "set-target-host",
    description: "Set hosts.<host>.targetHost in stack.json.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (default: clawdbot-fleet-host).", default: "clawdbot-fleet-host" },
    targetHost: { type: "string", description: "SSH target (alias or user@host)." },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    const h = stack.hosts[hostName];
    if (!h) throw new Error(`unknown host: ${hostName}`);
    const targetHost = String(args.targetHost || "").trim();
    if (!targetHost) throw new Error("missing --target-host");
    validateTargetHost(targetHost);

    const next = {
      ...stack,
      hosts: {
        ...stack.hosts,
        [hostName]: { ...h, targetHost },
      },
    };
    await writeFileAtomic(layout.stackFile, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`ok: set ${hostName}.targetHost = ${targetHost}`);
  },
});

const stackMigrate = defineCommand({
  meta: {
    name: "migrate",
    description: "Upgrade legacy stack.json to the latest schema.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    dryRun: { type: "boolean", description: "Print the migrated JSON without writing.", default: false },
  },
  async run({ args }) {
    const layout = getStackLayout({ cwd: process.cwd(), stackDir: args.stackDir });
    if (!fs.existsSync(layout.stackFile)) throw new Error(`missing stack file: ${layout.stackFile}`);

    let rawParsed: any;
    try {
      rawParsed = JSON.parse(fs.readFileSync(layout.stackFile, "utf8"));
    } catch {
      throw new Error(`invalid JSON: ${layout.stackFile}`);
    }

    const schemaVersion = Number(rawParsed?.schemaVersion);
    if (!Number.isFinite(schemaVersion)) throw new Error(`invalid stack.schemaVersion: ${String(rawParsed?.schemaVersion)}`);
    if (schemaVersion === 3) {
      console.log("ok: stack schemaVersion=3 (no changes)");
      return;
    }
    if (schemaVersion !== 1 && schemaVersion !== 2) throw new Error(`unsupported stack.schemaVersion: ${String(rawParsed?.schemaVersion)}`);

    const hosts = rawParsed?.hosts || {};
    if (!hosts || typeof hosts !== "object" || Object.keys(hosts).length === 0) throw new Error("stack.hosts must not be empty");

    const toDirSecrets = (secrets: any) => {
      if (secrets?.localDir && secrets?.remoteDir) {
        return { localDir: String(secrets.localDir), remoteDir: String(secrets.remoteDir) };
      }
      if (secrets?.localFile && secrets?.remoteFile) {
        const localFile = String(secrets.localFile);
        const remoteFile = String(secrets.remoteFile);
        const localDir = localFile.replace(/\\.ya?ml$/i, "");
        const remoteDir = remoteFile.replace(/\\.ya?ml$/i, "");
        return { localDir, remoteDir };
      }
      throw new Error("invalid secrets config (expected localDir/remoteDir or localFile/remoteFile)");
    };

    const toOpenTofu = (h: any) => {
      if (h?.opentofu?.adminCidr && h?.opentofu?.sshPubkeyFile) {
        return {
          adminCidr: String(h.opentofu.adminCidr),
          sshPubkeyFile: String(h.opentofu.sshPubkeyFile),
        };
      }
      if (h?.terraform?.adminCidr && h?.terraform?.sshPubkeyFile) {
        return {
          adminCidr: String(h.terraform.adminCidr),
          sshPubkeyFile: String(h.terraform.sshPubkeyFile),
        };
      }
      throw new Error("missing opentofu/terraform config (expected {adminCidr, sshPubkeyFile})");
    };

    const nextHosts = Object.fromEntries(
      Object.entries(hosts).map(([hostName, h]) => {
        const nextSecrets = toDirSecrets((h as any)?.secrets);
        const nextOpentofu = toOpenTofu(h as any);
        const { terraform: _terraform, opentofu: _opentofu, ...rest } = (h as any) || {};
        return [hostName, { ...rest, opentofu: nextOpentofu, secrets: nextSecrets }];
      }),
    );

    const { schemaVersion: _schemaVersion, ...restStack } = rawParsed || {};
    const next = {
      ...restStack,
      schemaVersion: 3,
      hosts: nextHosts,
    };

    StackSchema.parse(next);

    if (args.dryRun) {
      console.log(JSON.stringify(next, null, 2));
      return;
    }

    await writeFileAtomic(layout.stackFile, `${JSON.stringify(next, null, 2)}\\n`);
    console.log("ok: migrated stack.json to schemaVersion=3");
  },
});

const stackValidate = defineCommand({
  meta: {
    name: "validate",
    description: "Validate stack.json + env presence.",
  },
  args: {
    stackDir: {
      type: "string",
      description: "Stack directory (default: .clawdlets).",
    },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const { envFile, env } = loadStackEnv({ cwd: process.cwd(), stackDir: args.stackDir, envFile: stack.envFile });
    const resolved = await resolveStackBaseFlake({ repoRoot: layout.repoRoot, stack });

    const missing: string[] = [];
    if (!env.HCLOUD_TOKEN) missing.push("HCLOUD_TOKEN");

    console.log(`ok: stack (${layout.stackFile})`);
    console.log(`ok: base.flake (${resolved.flake ?? "(unset)"})`);
    console.log(`ok: hosts (${Object.keys(stack.hosts).length})`);
    console.log(`ok: envFile (${envFile ?? "(none)"})`);
    for (const k of missing) console.log(`missing: ${k}`);
    for (const [k, v] of Object.entries(stack.hosts)) {
      if (!v.targetHost) console.log(`missing (recommended): hosts.${k}.targetHost`);
    }
    if (missing.length > 0) process.exitCode = 1;
  },
});

const stackPrint = defineCommand({
  meta: {
    name: "print",
    description: "Print the current stack.json.",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
  },
  async run({ args }) {
    const { stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    console.log(JSON.stringify(stack, null, 2));
  },
});

export const stack = defineCommand({
  meta: {
    name: "stack",
    description: "Local stack management (.clawdlets).",
  },
  subCommands: {
    init: stackInit,
    migrate: stackMigrate,
    "set-target-host": stackSetTargetHost,
    validate: stackValidate,
    print: stackPrint,
  },
});
