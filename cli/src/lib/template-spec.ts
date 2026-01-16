import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTemplateSource, type TemplateSource } from "@clawdbot/clawdlets-core/lib/template-source";

type TemplateSpecArgs = {
  template?: string;
  templatePath?: string;
  templateRef?: string;
};

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function resolveTemplateSourcePath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packagedPath = path.resolve(moduleDir, "..", "config", "template-source.json");
  if (fs.existsSync(packagedPath)) return packagedPath;

  const repoRootPath = path.resolve(moduleDir, "..", "..", "..", "config", "template-source.json");
  if (fs.existsSync(repoRootPath)) return repoRootPath;

  const cwdPath = path.resolve(process.cwd(), "config", "template-source.json");
  if (fs.existsSync(cwdPath)) return cwdPath;

  throw new Error("template source config missing (expected config/template-source.json)");
}

function loadTemplateSourceDefaults(): { repo: string; path: string; ref: string } {
  const configPath = resolveTemplateSourcePath();
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as { repo?: string; path?: string; ref?: string };
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`template source config invalid: ${configPath}`);
  }
  return {
    repo: String(parsed.repo || ""),
    path: String(parsed.path || ""),
    ref: String(parsed.ref || ""),
  };
}

export function resolveTemplateSpec(args: TemplateSpecArgs): TemplateSource {
  const defaults = loadTemplateSourceDefaults();
  const repo = firstNonEmpty(args.template, process.env["CLAWDLETS_TEMPLATE_REPO"], defaults.repo);
  const tplPath = firstNonEmpty(args.templatePath, process.env["CLAWDLETS_TEMPLATE_PATH"], defaults.path);
  const ref = firstNonEmpty(args.templateRef, process.env["CLAWDLETS_TEMPLATE_REF"], defaults.ref);

  return normalizeTemplateSource({
    repo: repo || "",
    path: tplPath || "",
    ref: ref || "",
  });
}
