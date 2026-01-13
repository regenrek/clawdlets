#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function usage() {
  const msg = [
    "agent-bootstrap-server",
    "",
    "Usage:",
    "  node scripts/agent-bootstrap-server.mjs init [--file <path>] [--force]",
    "  node scripts/agent-bootstrap-server.mjs apply [--file <path>] [--dry-run]",
    "",
    "Defaults:",
    "  --file .clawdlets/day0.json",
  ].join("\n");
  console.log(msg);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") out.file = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--force") out.force = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else out._.push(a);
  }
  return out;
}

function findProjectRoot(startDir) {
  let dir = startDir;
  for (;;) {
    const cfg = path.join(dir, "infra", "configs", "clawdlets.json");
    if (fs.existsSync(cfg)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function assertSafeHostName(host) {
  if (!/^[a-z][a-z0-9-]*$/.test(host)) die(`invalid hostName (use [a-z][a-z0-9-]*): ${host}`);
}

function assertSafeBotId(bot) {
  if (!/^[a-z][a-z0-9_-]*$/.test(bot)) die(`invalid bot id (use [a-z][a-z0-9_-]*): ${bot}`);
}

function assertSafeEnvVarName(envVar) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(envVar)) die(`invalid env var name (use [A-Z_][A-Z0-9_]*): ${envVar}`);
}

function assertSafeSecretName(secretName) {
  if (!/^[a-z][a-z0-9_-]*$/.test(secretName)) die(`invalid secret name (use [a-z][a-z0-9_-]*): ${secretName}`);
}

function readJsonFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    die(`missing file: ${filePath}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    die(`invalid JSON (${filePath}): ${String(err && err.message ? err.message : err)}`);
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // ignore on non-POSIX fs
  }
}

function writeFile0600(filePath, text, opts) {
  if (!opts.force && fs.existsSync(filePath)) die(`refusing to overwrite existing file (pass --force): ${filePath}`);
  fs.writeFileSync(filePath, text, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // ignore on non-POSIX fs
  }
}

function quoteForLog(s) {
  if (s === "") return "''";
  if (/^[a-zA-Z0-9_./:-]+$/.test(s)) return s;
  return JSON.stringify(s);
}

function run(bin, args, opts) {
  const rendered = `$ ${[bin, ...args].map(quoteForLog).join(" ")}`;
  console.log(rendered);
  if (opts.dryRun) return;
  const res = spawnSync(bin, args, { stdio: "inherit", cwd: opts.cwd });
  if (res.error) die(`${bin} failed: ${String(res.error.message || res.error)}`);
  if (typeof res.status === "number" && res.status !== 0) process.exit(res.status);
}

function runWithStdin(bin, args, stdinText, opts) {
  const rendered = `$ ${[bin, ...args].map(quoteForLog).join(" ")}  # (stdin)`;
  console.log(rendered);
  if (opts.dryRun) return;
  const res = spawnSync(bin, args, {
    stdio: ["pipe", "inherit", "inherit"],
    cwd: opts.cwd,
    input: stdinText,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) die(`${bin} failed: ${String(res.error.message || res.error)}`);
  if (typeof res.status === "number" && res.status !== 0) process.exit(res.status);
}

function requireString(obj, keyPath) {
  const parts = keyPath.split(".");
  let cur = obj;
  for (const p0 of parts) {
    if (!cur || typeof cur !== "object") return "";
    cur = cur[p0];
  }
  return typeof cur === "string" ? cur.trim() : "";
}

function requireBool(obj, keyPath, def) {
  const parts = keyPath.split(".");
  let cur = obj;
  for (const p0 of parts) {
    if (!cur || typeof cur !== "object") return def;
    cur = cur[p0];
  }
  if (typeof cur === "boolean") return cur;
  return def;
}

function requireStringArray(obj, keyPath) {
  const parts = keyPath.split(".");
  let cur = obj;
  for (const p0 of parts) {
    if (!cur || typeof cur !== "object") return [];
    cur = cur[p0];
  }
  if (!Array.isArray(cur)) return [];
  return cur.map((x) => String(x || "").trim()).filter(Boolean);
}

function requireRecordStringString(obj, keyPath) {
  const parts = keyPath.split(".");
  let cur = obj;
  for (const p0 of parts) {
    if (!cur || typeof cur !== "object") return {};
    cur = cur[p0];
  }
  if (!cur || typeof cur !== "object" || Array.isArray(cur)) return {};
  const out = {};
  for (const [k, v] of Object.entries(cur)) {
    const kk = String(k || "").trim();
    const vv = typeof v === "string" ? v.trim() : "";
    if (kk && vv) out[kk] = vv;
  }
  return out;
}

function validateInput(input) {
  if (!input || typeof input !== "object") die("day0.json must be a JSON object");

  const hostName = requireString(input, "hostName");
  if (!hostName) die("missing hostName");
  assertSafeHostName(hostName);

  const guildId = requireString(input, "fleet.guildId");
  if (!guildId) die("missing fleet.guildId");

  const bots = requireStringArray(input, "fleet.bots");
  if (bots.length === 0) die("missing fleet.bots (non-empty array)");
  for (const b of bots) assertSafeBotId(b);

  const envSecrets = requireRecordStringString(input, "fleet.envSecrets");
  for (const [envVar, secretName] of Object.entries(envSecrets)) {
    assertSafeEnvVarName(envVar);
    assertSafeSecretName(secretName);
  }

  const diskDevice = requireString(input, "host.diskDevice");
  if (!diskDevice) die("missing host.diskDevice");

  const serverType = requireString(input, "host.serverType");
  if (!serverType) die("missing host.serverType");

  const adminCidr = requireString(input, "host.adminCidr");
  if (!adminCidr || !adminCidr.includes("/")) die("missing/invalid host.adminCidr (expected CIDR, e.g. 1.2.3.4/32)");

  const sshPubkeyFile = requireString(input, "host.sshPubkeyFile");
  if (!sshPubkeyFile) die("missing host.sshPubkeyFile");

  const addSshKeyFiles = requireStringArray(input, "host.addSshKeyFiles");
  for (const f of addSshKeyFiles) {
    const abs = f.startsWith("/") ? f : path.resolve(process.env.HOME || "", f.replace(/^~\//, ""));
    if (!fs.existsSync(abs)) die(`ssh key file not found: ${f}`);
    const st = fs.statSync(abs);
    if (!st.isFile()) die(`ssh key path is not a file: ${f}`);
  }

  const secretsInit = input.secretsInit;
  if (!secretsInit || typeof secretsInit !== "object" || Array.isArray(secretsInit)) die("missing secretsInit object");
  const adminPasswordHash = requireString(input, "secretsInit.adminPasswordHash");
  if (!adminPasswordHash) die("missing secretsInit.adminPasswordHash (YESCRYPT hash)");

  const discordTokens = requireRecordStringString(input, "secretsInit.discordTokens");
  for (const bot of bots) {
    if (!discordTokens[bot]) die(`missing secretsInit.discordTokens.${bot}`);
  }

  const secrets = requireRecordStringString(input, "secretsInit.secrets");
  for (const [k, v] of Object.entries(secrets)) {
    assertSafeSecretName(k);
    if (!v) die(`missing secretsInit.secrets.${k}`);
  }

  return {
    hostName,
    baseFlake: requireString(input, "baseFlake"),
    guildId,
    bots,
    envSecrets,
    host: {
      enable: requireBool(input, "host.enable", true),
      diskDevice,
      serverType,
      adminCidr,
      sshPubkeyFile,
      addSshKeyFiles,
      tailnet: requireString(input, "host.tailnet") || "tailscale",
      publicSsh: requireBool(input, "host.publicSsh", false),
      provisioning: requireBool(input, "host.provisioning", false),
      agentModelPrimary: requireString(input, "host.agentModelPrimary"),
      targetHost: requireString(input, "host.targetHost"),
    },
    secretsInit: {
      adminPasswordHash,
      tailscaleAuthKey: requireString(input, "secretsInit.tailscaleAuthKey"),
      discordTokens,
      secrets,
    },
    bootstrap: {
      run: requireBool(input, "bootstrap.run", true),
      keepPublicSsh: requireBool(input, "bootstrap.keepPublicSsh", false),
      rev: requireString(input, "bootstrap.rev") || "HEAD",
      ref: requireString(input, "bootstrap.ref"),
    },
  };
}

function loadConfigIfExists(repoRoot) {
  const cfgPath = path.join(repoRoot, "infra", "configs", "clawdlets.json");
  if (!fs.existsSync(cfgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    die(`failed to parse infra/configs/clawdlets.json (invalid JSON): ${cfgPath}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) return usage();
  const cmd = args._[0];
  if (!cmd || (cmd !== "init" && cmd !== "apply")) return usage();

  const repoRoot = findProjectRoot(process.cwd());
  if (!repoRoot) die("not in a clawdlets project (missing infra/configs/clawdlets.json)");

  const relDefault = path.join(".clawdlets", "day0.json");
  const filePath = args.file ? path.resolve(process.cwd(), String(args.file)) : path.join(repoRoot, relDefault);

  const config = loadConfigIfExists(repoRoot);
  const inferredHostName = String(config?.defaultHost || "").trim() || "clawdbot-fleet-host";
  const inferredHostCfg = config?.hosts?.[inferredHostName] || {};

  if (cmd === "init") {
    const runtimeDir = path.join(repoRoot, ".clawdlets");
    ensureDir(runtimeDir);

    const bots = Array.isArray(config?.fleet?.bots) && config.fleet.bots.length > 0 ? config.fleet.bots : ["maren", "sonja", "gunnar", "melinda"];
    const envSecrets =
      config?.fleet?.envSecrets && typeof config.fleet.envSecrets === "object" && !Array.isArray(config.fleet.envSecrets)
        ? config.fleet.envSecrets
        : { ZAI_API_KEY: "z_ai_api_key", Z_AI_API_KEY: "z_ai_api_key" };

    const template = {
      schemaVersion: 1,
      hostName: inferredHostName,
      baseFlake: String(config?.baseFlake || "").trim() || "github:YOURORG/your-clawdlets-host-flake",
      fleet: {
        guildId: String(config?.fleet?.guildId || "").trim() || "DISCORD_GUILD_ID",
        bots,
        envSecrets,
      },
      host: {
        enable: Boolean(inferredHostCfg?.enable ?? true),
        diskDevice: String(inferredHostCfg?.diskDevice || "").trim() || "/dev/sda",
        serverType: String(inferredHostCfg?.hetzner?.serverType || "").trim() || "cx43",
        adminCidr: String(inferredHostCfg?.opentofu?.adminCidr || "").trim() || "1.2.3.4/32",
        sshPubkeyFile: String(inferredHostCfg?.opentofu?.sshPubkeyFile || "").trim() || "~/.ssh/id_ed25519.pub",
        addSshKeyFiles: [String(inferredHostCfg?.opentofu?.sshPubkeyFile || "").trim() || "~/.ssh/id_ed25519.pub"],
        tailnet: String(inferredHostCfg?.tailnet?.mode || "").trim() || "tailscale",
        publicSsh: Boolean(inferredHostCfg?.publicSsh?.enable ?? false),
        provisioning: Boolean(inferredHostCfg?.provisioning?.enable ?? false),
        agentModelPrimary: String(inferredHostCfg?.agentModelPrimary || "").trim() || "zai/glm-4.7",
        targetHost: String(inferredHostCfg?.targetHost || "").trim(),
      },
      secretsInit: {
        adminPasswordHash: "<YESCRYPT_HASH>",
        tailscaleAuthKey: "tskey-auth-...",
        discordTokens: Object.fromEntries(bots.map((b) => [b, "<DISCORD_BOT_TOKEN>"])),
        secrets: {
          z_ai_api_key: "<ZAI_API_KEY>",
        },
      },
      bootstrap: {
        run: true,
        keepPublicSsh: false,
        rev: "HEAD",
        ref: "",
      },
    };
    writeFile0600(filePath, `${JSON.stringify(template, null, 2)}\n`, { force: Boolean(args.force) });
    console.log(`ok: wrote ${path.relative(repoRoot, filePath) || filePath}`);
    console.log("next:");
    console.log("- clawdlets env init  # set HCLOUD_TOKEN");
    console.log(`- edit ${path.relative(repoRoot, filePath) || filePath}  # fill values`);
    console.log(`- node scripts/agent-bootstrap-server.mjs apply --file ${path.relative(repoRoot, filePath) || filePath}`);
    return;
  }

  const input = readJsonFile(filePath);
  const normalized = validateInput(input);

  const dryRun = Boolean(args.dryRun);
  const runOpts = { cwd: repoRoot, dryRun };

  let cfg = loadConfigIfExists(repoRoot);
  if (!cfg) {
    run("clawdlets", ["config", "init", "--host", normalized.hostName], runOpts);
    cfg = loadConfigIfExists(repoRoot);
  }

  if (!cfg || !cfg.hosts || !cfg.hosts[normalized.hostName]) {
    run("clawdlets", ["host", "add", "--host", normalized.hostName], runOpts);
  }

  run("clawdlets", ["host", "set-default", "--host", normalized.hostName], runOpts);

  if (normalized.baseFlake) {
    run("clawdlets", ["config", "set", "--path", "baseFlake", "--value", normalized.baseFlake], runOpts);
  }

  run("clawdlets", ["config", "set", "--path", "fleet.guildId", "--value", normalized.guildId], runOpts);

  run("clawdlets", ["config", "set", "--path", "fleet.bots", "--value-json", JSON.stringify(normalized.bots)], runOpts);

  if (Object.keys(normalized.envSecrets).length > 0) {
    run(
      "clawdlets",
      ["config", "set", "--path", "fleet.envSecrets", "--value-json", JSON.stringify(normalized.envSecrets)],
      runOpts,
    );
  }

  const hostArgs = [
    "host",
    "set",
    "--host",
    normalized.hostName,
    "--enable",
    normalized.host.enable ? "true" : "false",
    "--disk-device",
    normalized.host.diskDevice,
    "--server-type",
    normalized.host.serverType,
    "--admin-cidr",
    normalized.host.adminCidr,
    "--ssh-pubkey-file",
    normalized.host.sshPubkeyFile,
    "--tailnet",
    normalized.host.tailnet,
    "--public-ssh",
    normalized.host.publicSsh ? "true" : "false",
    "--provisioning",
    normalized.host.provisioning ? "true" : "false",
  ];

  if (normalized.host.agentModelPrimary) hostArgs.push("--agent-model-primary", normalized.host.agentModelPrimary);
  if (normalized.host.targetHost) hostArgs.push("--target-host", normalized.host.targetHost);
  for (const f of normalized.host.addSshKeyFiles) hostArgs.push("--add-ssh-key-file", f);
  run("clawdlets", hostArgs, runOpts);

  const secretsInitPayload = {
    adminPasswordHash: normalized.secretsInit.adminPasswordHash,
    ...(normalized.secretsInit.tailscaleAuthKey ? { tailscaleAuthKey: normalized.secretsInit.tailscaleAuthKey } : {}),
    discordTokens: normalized.secretsInit.discordTokens,
    secrets: normalized.secretsInit.secrets,
  };
  runWithStdin(
    "clawdlets",
    ["secrets", "init", "--host", normalized.hostName, "--from-json", "-", "--yes"],
    `${JSON.stringify(secretsInitPayload)}\n`,
    runOpts,
  );

  run("clawdlets", ["doctor", "--host", normalized.hostName, "--scope", "deploy"], runOpts);

  if (normalized.bootstrap.run) {
    const bootstrapArgs = ["bootstrap", "--host", normalized.hostName];
    if (normalized.bootstrap.keepPublicSsh) bootstrapArgs.push("--keep-public-ssh");
    if (normalized.bootstrap.ref) bootstrapArgs.push("--ref", normalized.bootstrap.ref);
    else if (normalized.bootstrap.rev) bootstrapArgs.push("--rev", normalized.bootstrap.rev);
    run("clawdlets", bootstrapArgs, runOpts);
  }

  console.log("next:");
  console.log(`- clawdlets host set --host ${normalized.hostName} --target-host <ssh-alias|user@host>`);
  console.log(`- clawdlets lockdown --host ${normalized.hostName}`);
}

const selfPath = path.resolve(fileURLToPath(import.meta.url));
const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (argv1 && argv1 === selfPath) {
  main(process.argv.slice(2));
}

