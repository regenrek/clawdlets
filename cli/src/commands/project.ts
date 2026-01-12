import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { getTemplateDir } from "@clawdlets/template";
import { ensureDir, writeFileAtomic } from "@clawdbot/clawdlets-core/lib/fs-safe";
import { capture, run } from "@clawdbot/clawdlets-core/lib/run";
import { assertSafeHostName } from "@clawdbot/clawdlets-core/lib/clawdlets-config";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../lib/wizard.js";

function wantsInteractive(flag: boolean | undefined): boolean {
  if (flag) return true;
  const env = String(process.env["CLAWDLETS_INTERACTIVE"] || "").trim();
  return env === "1" || env.toLowerCase() === "true";
}

function requireTtyIfInteractive(interactive: boolean): void {
  if (!interactive) return;
  if (!process.stdout.isTTY) throw new Error("--interactive requires a TTY");
}

function applySubs(s: string, subs: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(subs)) out = out.split(k).join(v);
  return out;
}

function isProbablyText(file: string): boolean {
  const base = path.basename(file);
  if (base === "Justfile" || base === "_gitignore") return true;
  const ext = path.extname(file).toLowerCase();
  return [
    ".md",
    ".nix",
    ".tf",
    ".hcl",
    ".json",
    ".yaml",
    ".yml",
    ".txt",
    ".lock",
    ".gitignore",
  ].includes(ext);
}

async function copyTree(params: {
  srcDir: string;
  destDir: string;
  subs: Record<string, string>;
}): Promise<void> {
  const entries = await fs.promises.readdir(params.srcDir, { withFileTypes: true });
  for (const ent of entries) {
    const srcName = ent.name;
    const srcPath = path.join(params.srcDir, srcName);

    const renamed =
      srcName === "_gitignore"
        ? ".gitignore"
        : applySubs(srcName, params.subs);
    const destPath = path.join(params.destDir, renamed);

    if (ent.isDirectory()) {
      await ensureDir(destPath);
      await copyTree({ srcDir: srcPath, destDir: destPath, subs: params.subs });
      continue;
    }

    if (!ent.isFile()) continue;

    const buf = await fs.promises.readFile(srcPath);
    if (!isProbablyText(srcName)) {
      await ensureDir(path.dirname(destPath));
      await fs.promises.writeFile(destPath, buf);
      continue;
    }

    const rendered = applySubs(buf.toString("utf8"), params.subs);
    await writeFileAtomic(destPath, rendered);
  }
}

async function dirHasAnyFiles(dir: string): Promise<boolean> {
  try {
    const entries = await fs.promises.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

const projectInit = defineCommand({
  meta: { name: "init", description: "Scaffold a new clawdlets infra repo (from @clawdlets/template)." },
  args: {
    dir: { type: "string", description: "Target directory (created if missing)." },
    host: { type: "string", description: "Host name placeholder (default: clawdbot-fleet-host).", default: "clawdbot-fleet-host" },
    gitInit: { type: "boolean", description: "Run `git init` in the new directory.", default: true },
    interactive: { type: "boolean", description: "Prompt for confirmation (requires TTY).", default: false },
    dryRun: { type: "boolean", description: "Print planned files without writing.", default: false },
  },
  async run({ args }) {
    const interactive = wantsInteractive(Boolean(args.interactive));
    requireTtyIfInteractive(interactive);

    const dirRaw = String(args.dir || "").trim();
    if (!dirRaw) throw new Error("missing --dir");
    const destDir = path.resolve(process.cwd(), dirRaw);
    const host = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    assertSafeHostName(host);
    const projectName = path.basename(destDir);

    if (interactive) {
      p.intro("clawdlets project init");
      const ok = await p.confirm({
        message: `Create project at ${destDir}?`,
        initialValue: true,
      });
      if (p.isCancel(ok)) {
        const nav = await navOnCancel({ flow: "project init", canBack: false });
        if (nav === NAV_EXIT) cancelFlow();
        return;
      }
      if (!ok) {
        cancelFlow();
        return;
      }
    }

    const templateDir = getTemplateDir();
    if (!fs.existsSync(templateDir)) throw new Error(`template dir missing: ${templateDir}`);

    const exists = fs.existsSync(destDir);
    if (exists && (await dirHasAnyFiles(destDir))) {
      throw new Error(`target dir not empty: ${destDir}`);
    }

    const subs = {
      "__PROJECT_NAME__": projectName,
      "clawdbot-fleet-host": host,
      "clawdbot_fleet_host": host.replace(/-/g, "_"),
    };

    const planned: string[] = [];
    const walk = async (srcDir: string, rel: string) => {
      const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
      for (const ent of entries) {
        const srcName = ent.name;
        const mapped = srcName === "_gitignore" ? ".gitignore" : applySubs(srcName, subs);
        const nextRel = path.join(rel, mapped);
        if (ent.isDirectory()) {
          await walk(path.join(srcDir, srcName), nextRel);
        } else if (ent.isFile()) {
          planned.push(nextRel);
        }
      }
    };
    await walk(templateDir, ".");

    if (args.dryRun) {
      p.note(planned.sort().join("\n"), "Planned files");
      p.outro("dry-run");
      return;
    }

    await ensureDir(destDir);
    await copyTree({ srcDir: templateDir, destDir, subs });

    if (args.gitInit) {
      try {
        await capture("git", ["--version"], { cwd: destDir });
        await run("git", ["init"], { cwd: destDir });
      } catch {
        if (interactive) p.note("git not available; skipped `git init`", "gitInit");
      }
    }

	    const next = [
	      "next:",
	      `- cd ${destDir}`,
	      "- create a git repo + set origin (recommended; enables blank base flake)",
	      `- clawdlets host set --host ${host} --admin-cidr <your-ip>/32 --disk-device /dev/sda --add-ssh-key-file $HOME/.ssh/id_ed25519.pub`,
	      `- clawdlets secrets init --host ${host}`,
	      `- clawdlets doctor --host ${host}`,
	      `- clawdlets bootstrap --host ${host}`,
	      `- clawdlets host set --host ${host} --target-host <ssh-alias|user@host>`,
	      `- clawdlets lockdown --host ${host}`,
	    ].join("\n");
    if (interactive) p.outro(next);
    else console.log(next);
  },
});

export const project = defineCommand({
  meta: { name: "project", description: "Project scaffolding." },
  subCommands: { init: projectInit },
});
