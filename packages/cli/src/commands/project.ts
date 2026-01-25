import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { initProject, planProjectInit } from "@clawdlets/core/lib/project-init";
import { assertSafeHostName } from "@clawdlets/shared/lib/identifiers";
import { resolveTemplateSpec } from "../lib/template-spec.js";
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

const projectInit = defineCommand({
  meta: { name: "init", description: "Scaffold a new clawdlets infra repo (from clawdlets-template)." },
  args: {
    dir: { type: "string", description: "Target directory (created if missing)." },
    host: { type: "string", description: "Host name placeholder (default: clawdbot-fleet-host).", default: "clawdbot-fleet-host" },
    gitInit: { type: "boolean", description: "Run `git init` in the new directory.", default: true },
    interactive: { type: "boolean", description: "Prompt for confirmation (requires TTY).", default: false },
    dryRun: { type: "boolean", description: "Print planned files without writing.", default: false },
    template: { type: "string", description: "Template repo (default: config/template-source.json)." },
    templatePath: { type: "string", description: "Template path inside repo (default: config/template-source.json)." },
    templateRef: { type: "string", description: "Template git ref (default: config/template-source.json)." },
  },
  async run({ args }) {
    const interactive = wantsInteractive(Boolean(args.interactive));
    requireTtyIfInteractive(interactive);

    const dirRaw = String(args.dir || "").trim();
    if (!dirRaw) throw new Error("missing --dir");
    const destDir = path.resolve(process.cwd(), dirRaw);
    const host = String(args.host || "clawdbot-fleet-host").trim() || "clawdbot-fleet-host";
    assertSafeHostName(host);

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

    const templateSpec = resolveTemplateSpec({
      template: args.template,
      templatePath: args.templatePath,
      templateRef: args.templateRef,
    });

    if (args.dryRun) {
      const plan = await planProjectInit({
        destDir,
        host,
        templateSpec: templateSpec.spec,
      });
      const list = plan.plannedFiles.join("\n");
      p.note(list, "Planned files");
      p.outro("dry-run");
      return;
    }

    const result = await initProject({
      destDir,
      host,
      templateSpec: templateSpec.spec,
      gitInit: args.gitInit,
    });

    if (!result.gitInitialized && interactive) {
      p.note("git not available; skipped `git init`", "gitInit");
    }

    const next = result.nextSteps.join("\n");
    if (interactive) p.outro(next);
    else console.log(next);
  },
});

export const project = defineCommand({
  meta: { name: "project", description: "Project scaffolding." },
  subCommands: { init: projectInit },
});
