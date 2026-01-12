import process from "node:process";
import { defineCommand } from "citty";
import { resolveGitRev } from "@clawdbot/clawdlets-core/lib/git";
import { shellQuote, sshCapture, sshRun } from "@clawdbot/clawdlets-core/lib/ssh-remote";
import { resolveBaseFlake } from "@clawdbot/clawdlets-core/lib/base-flake";
import { getHostRemoteSecretsDir } from "@clawdbot/clawdlets-core/repo-layout";
import { requireTargetHost, needsSudo } from "./server/common.js";
import { serverGithubSync } from "./server/github-sync.js";
import { loadHostContextOrExit } from "../lib/context.js";

function normalizeSince(value: string): string {
  const v = value.trim();
  const m = v.match(/^(\d+)\s*([smhd])$/i);
  if (!m) return v;
  const n = Number(m[1]);
  const unit = String(m[2]).toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return v;
  if (unit === "s") return `${n} sec ago`;
  if (unit === "m") return `${n} min ago`;
  if (unit === "h") return `${n} hour ago`;
  if (unit === "d") return `${n} day ago`;
  return v;
}

function resolveHostFromFlake(flakeBase: string): string | null {
  const hashIndex = flakeBase.indexOf("#");
  if (hashIndex === -1) return null;
  const host = flakeBase.slice(hashIndex + 1).trim();
  return host.length > 0 ? host : null;
}

type AuditCheck = { status: "ok" | "warn" | "missing"; label: string; detail?: string };

async function trySshCapture(targetHost: string, remoteCmd: string, opts: { tty?: boolean } = {}): Promise<{ ok: boolean; out: string }> {
  try {
    const out = await sshCapture(targetHost, remoteCmd, opts);
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String((e as Error)?.message || e) };
  }
}

const serverAudit = defineCommand({
  meta: {
    name: "audit",
    description: "Audit host invariants over SSH (bootstrap firewall, tailscale, services, rendered env).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
	  async run({ args }) {
	    const cwd = process.cwd();
	    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
	    if (!ctx) return;
	    const { hostName, hostCfg } = ctx;
	    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const sudo = needsSudo(targetHost);

    const checks: AuditCheck[] = [];
    const add = (c: AuditCheck) => checks.push(c);

    const opt = async (label: string, cmd: string) => {
      const out = await trySshCapture(targetHost, cmd, { tty: sudo && args.sshTty });
      if (!out.ok) add({ status: "warn", label, detail: out.out });
      return out.out;
    };

    const must = async (label: string, cmd: string) => {
      const out = await trySshCapture(targetHost, cmd, { tty: sudo && args.sshTty });
      if (!out.ok) add({ status: "missing", label, detail: out.out });
      else add({ status: "ok", label, detail: out.out });
      return out;
    };

    const nixosOption = async (name: string) => {
      const cmd = [
        ...(sudo ? ["sudo"] : []),
        "sh",
        "-lc",
        `nixos-option ${shellQuote(name)} 2>/dev/null || true`,
      ].join(" ");
      return await opt(`nixos-option ${name}`, cmd);
    };

    const provisioning = await nixosOption("clawdlets.provisioning.enable");
    const publicSsh = await nixosOption("clawdlets.publicSsh.enable");

    const provisioningEnabled = provisioning.includes("Value: true");
    const publicSshEnabled = publicSsh.includes("Value: true");

    if (publicSshEnabled) add({ status: "missing", label: "publicSsh", detail: "(enabled; public SSH open)" });
    else if (publicSsh.includes("Value: false")) add({ status: "ok", label: "publicSsh", detail: "(disabled)" });
    else add({ status: "warn", label: "publicSsh", detail: "(unknown; nixos-option not available?)" });

    if (provisioningEnabled) add({ status: "warn", label: "provisioning", detail: "(enabled)" });
    else if (provisioning.includes("Value: false")) add({ status: "ok", label: "provisioning", detail: "(disabled)" });
    else add({ status: "warn", label: "provisioning", detail: "(unknown; nixos-option not available?)" });

    const tailscaleEnabled = (await nixosOption("services.tailscale.enable")).includes("Value: true");
    if (tailscaleEnabled) {
      await must("tailscale service", [ ...(sudo ? ["sudo"] : []), "systemctl", "is-active", "tailscaled.service" ].join(" "));
      await must("tailscale autoconnect", [ ...(sudo ? ["sudo"] : []), "systemctl", "is-active", "tailscaled-autoconnect.service" ].join(" "));
    } else {
      add({ status: "warn", label: "tailscale enabled", detail: "(services.tailscale.enable=false)" });
    }

    const botsRaw = await nixosOption("services.clawdbotFleet.bots");
    const bots = Array.from(botsRaw.matchAll(/"([^"]+)"/g)).map((m) => String(m[1] ?? "")).filter(Boolean);
    if (bots.length === 0) add({ status: "warn", label: "fleet bots list", detail: "(could not read services.clawdbotFleet.bots)" });
    else add({ status: "ok", label: "fleet bots list", detail: bots.join(", ") });

    for (const b of bots) {
      await must(`service clawdbot-${b}`, [ ...(sudo ? ["sudo"] : []), "systemctl", "is-active", `clawdbot-${b}.service` ].join(" "));
      await must(
        `rendered env clawdbot-${b}`,
        [
          ...(sudo ? ["sudo"] : []),
          "sh",
          "-lc",
          shellQuote(`test -s /run/secrets/rendered/clawdbot-${b}.env && echo ok`),
        ].join(" "),
      );
    }

    const allowUsers = await opt(
      "sshd AllowUsers",
      [ ...(sudo ? ["sudo"] : []), "sh", "-lc", shellQuote("sshd -T 2>/dev/null | awk '$1==\"allowusers\"{print}' || true") ].join(" "),
    );
    if (/\ballowusers\s+admin\b/i.test(allowUsers) && !/\bbreakglass\b/i.test(allowUsers)) {
      add({ status: "ok", label: "sshd AllowUsers", detail: "(admin only)" });
    } else if (allowUsers.trim().length === 0) {
      add({ status: "warn", label: "sshd AllowUsers", detail: "(not set; relying on other controls)" });
    } else {
      add({ status: "missing", label: "sshd AllowUsers", detail: allowUsers.trim() });
    }

    const sshd = await trySshCapture(targetHost, [ ...(sudo ? ["sudo"] : []), "sshd", "-T" ].join(" "), { tty: false });
    if (!sshd.ok) {
      add({ status: "warn", label: "sshd config", detail: sshd.out });
    } else if (/passwordauthentication\s+no/i.test(sshd.out) && /kbdinteractiveauthentication\s+no/i.test(sshd.out)) {
      add({ status: "ok", label: "sshd password auth", detail: "(disabled)" });
    } else {
      add({ status: "missing", label: "sshd password auth", detail: "(password auth may be enabled)" });
    }

    const remoteSecretsDir = getHostRemoteSecretsDir(hostName);
    await must(
      "remote secrets dir",
      [ ...(sudo ? ["sudo"] : []), "sh", "-lc", shellQuote(`test -d ${shellQuote(remoteSecretsDir)} && echo ok`) ].join(" "),
    );
    await must(
      "remote secrets perms",
      [
        ...(sudo ? ["sudo"] : []),
        "sh",
        "-lc",
        shellQuote(
          `bad="$(find ${shellQuote(remoteSecretsDir)} -maxdepth 1 -type f -name '*.yaml' -printf '%m %u %g %p\\n' | awk '$1!=\"400\" || $2!=\"root\" || $3!=\"root\" {print; exit 0}' || true)"; if [ -n "$bad" ]; then echo "bad: $bad" >&2; exit 1; fi; echo ok`,
        ),
      ].join(" "),
    );

    const firewall = await opt(
      "firewall port 22 (public)",
      [
        ...(sudo ? ["sudo"] : []),
        "sh",
        "-lc",
        shellQuote(
          "nft list ruleset 2>/dev/null | grep -n \"dport 22\" || true",
        ),
      ].join(" "),
    );
    if (!publicSshEnabled && firewall.trim().length === 0) {
      add({ status: "ok", label: "firewall port 22 (public)", detail: "(no public dport 22 rule found)" });
    } else if (!publicSshEnabled && firewall.trim().length > 0) {
      add({ status: "missing", label: "firewall port 22 (public)", detail: firewall.trim() });
    }

    if (args.json) console.log(JSON.stringify({ host: hostName, targetHost, checks }, null, 2));
    else for (const c of checks) console.log(`${c.status}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`);

    if (checks.some((c) => c.status === "missing")) process.exitCode = 1;
  },
});

const serverStatus = defineCommand({
  meta: {
    name: "status",
    description: "Show systemd status for Clawdbot services.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const sudo = needsSudo(targetHost);
    const cmd = [
      ...(sudo ? ["sudo"] : []),
      "systemctl",
      "list-units",
      "--all",
      "--plain",
      "--legend=false",
      "--no-pager",
      "clawdbot-*.service",
    ].join(" ");
    const out = await sshCapture(targetHost, cmd);
    console.log(out);
  },
});

const serverLogs = defineCommand({
  meta: {
    name: "logs",
    description: "Stream or print logs via journalctl.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    unit: {
      type: "string",
      description: "systemd unit (default: clawdbot-*.service).",
      default: "clawdbot-*.service",
    },
    since: { type: "string", description: "Time window (supports 5m/1h/2d or journalctl syntax)." },
    follow: { type: "boolean", description: "Follow logs.", default: false },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const sudo = needsSudo(targetHost);
    const unit = String(args.unit || "clawdbot-*.service").trim() || "clawdbot-*.service";
    const since = args.since ? normalizeSince(String(args.since)) : "";

    const cmdArgs = [
      ...(sudo ? ["sudo"] : []),
      "journalctl",
      "--no-pager",
      ...(args.follow ? ["-f"] : []),
      ...(since ? ["--since", shellQuote(since)] : []),
      "-u",
      shellQuote(unit),
    ];
    const remoteCmd = cmdArgs.join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

const serverRebuild = defineCommand({
  meta: {
    name: "rebuild",
    description: "Run nixos-rebuild switch on the host using a pinned git rev/ref.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    flake: { type: "string", description: "Flake base override (default: clawdlets.json baseFlake or git origin)." },
    rev: { type: "string", description: "Git rev to pin (HEAD/sha/tag).", default: "HEAD" },
    ref: { type: "string", description: "Git ref to pin (branch or tag)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { layout, repoRoot, config, hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const githubToken = String(process.env.GITHUB_TOKEN || "").trim();

    const baseResolved = await resolveBaseFlake({ repoRoot, config });
    const flakeBase = String(args.flake || baseResolved.flake || "").trim();
    if (!flakeBase) throw new Error("missing base flake (set baseFlake in infra/configs/clawdlets.json, set git origin, or pass --flake)");

    const requestedHost = String(hostCfg.flakeHost || hostName).trim() || hostName;
    const hostFromFlake = resolveHostFromFlake(flakeBase);
    if (hostFromFlake && hostFromFlake !== requestedHost) {
      throw new Error(`flake host mismatch: ${hostFromFlake} vs ${requestedHost}`);
    }
    const flakeWithHost = flakeBase.includes("#") ? flakeBase : `${flakeBase}#${requestedHost}`;

    const rev = String(args.rev || "").trim();
    const ref = String(args.ref || "").trim();
    if (rev && ref) throw new Error("use either --rev or --ref (not both)");

    const hashIndex = flakeWithHost.indexOf("#");
    const flakeBasePath = hashIndex === -1 ? flakeWithHost : flakeWithHost.slice(0, hashIndex);
    const flakeFragment = hashIndex === -1 ? "" : flakeWithHost.slice(hashIndex);
    if ((rev || ref) && /(^|[?&])(rev|ref)=/.test(flakeBasePath)) {
      throw new Error("flake already includes ?rev/?ref; drop --rev/--ref");
    }

    let flake = flakeWithHost;
    if (rev) {
      const resolved = await resolveGitRev(layout.repoRoot, rev);
      if (!resolved) throw new Error(`unable to resolve git rev: ${rev}`);
      const sep = flakeBasePath.includes("?") ? "&" : "?";
      flake = `${flakeBasePath}${sep}rev=${resolved}${flakeFragment}`;
    } else if (ref) {
      const sep = flakeBasePath.includes("?") ? "&" : "?";
      flake = `${flakeBasePath}${sep}ref=${ref}${flakeFragment}`;
    }

    const sudo = needsSudo(targetHost);
    const remoteArgs: string[] = [];
    if (sudo) remoteArgs.push("sudo");
    remoteArgs.push("env");
    if (githubToken) {
      remoteArgs.push(`NIX_CONFIG=access-tokens = github.com=${githubToken}`);
    }
    remoteArgs.push("nixos-rebuild", "switch", "--flake", flake);

    const remoteCmd = remoteArgs.map(shellQuote).join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

const serverRestart = defineCommand({
  meta: {
    name: "restart",
    description: "Restart a systemd unit (default: clawdbot-*.service).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    unit: { type: "string", description: "systemd unit (default: clawdbot-*.service).", default: "clawdbot-*.service" },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const unit = String(args.unit || "clawdbot-*.service").trim() || "clawdbot-*.service";
    const sudo = needsSudo(targetHost);
    const remoteCmd = [
      ...(sudo ? ["sudo"] : []),
      "systemctl",
      "restart",
      shellQuote(unit),
    ].join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

export const server = defineCommand({
  meta: {
    name: "server",
    description: "Server operations via SSH (rebuild/logs/status).",
  },
  subCommands: {
    audit: serverAudit,
    status: serverStatus,
    logs: serverLogs,
    "github-sync": serverGithubSync,
    restart: serverRestart,
    rebuild: serverRebuild,
  },
});
