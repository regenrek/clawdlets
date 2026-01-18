import process from "node:process";
import type { DoctorCheck } from "@clawdlets/core/doctor";

type DoctorStatus = DoctorCheck["status"];

const STATUS_ORDER: Record<DoctorStatus, number> = { missing: 0, warn: 1, ok: 2 };
const SCOPE_ORDER: Record<DoctorCheck["scope"], number> = { repo: 0, bootstrap: 1, "server-deploy": 2, cattle: 3 };

function supportsColor(out: NodeJS.WriteStream): boolean {
  if (!out.isTTY) return false;
  if (process.env.NO_COLOR != null) return false;
  if (process.env.TERM === "dumb") return false;
  return true;
}

function colorize(params: { enabled: boolean; code: number; s: string }): string {
  if (!params.enabled) return params.s;
  return `\x1b[${params.code}m${params.s}\x1b[0m`;
}

function formatStatusTag(status: DoctorStatus, opts: { color: boolean }): string {
  if (status === "ok") return colorize({ enabled: opts.color, code: 32, s: "[OK]" });
  if (status === "warn") return colorize({ enabled: opts.color, code: 33, s: "[WARN]" });
  return colorize({ enabled: opts.color, code: 31, s: "[MISSING]" });
}

function bold(s: string, opts: { color: boolean }): string {
  return colorize({ enabled: opts.color, code: 1, s });
}

function categoryForLabel(label: string): string {
  const l = label.toLowerCase();

  if (l.includes("public repo hygiene") || l.includes("inline scripting") || l.includes("docs index") || l.includes("bundled skills")) return "repo hygiene";
  if (l.includes("fleet") || l.includes("guild") || l.includes("discord") || l.includes("routing")) return "fleet / discord";
  if (l.includes("sops") || l.includes("secret") || l.includes("envsecrets") || l.includes("llm api")) return "secrets";
  if (l.includes("deploy env file") || l.includes("env file")) return "infra";
  if (l.includes("hetzner") || l.includes("provisioning") || l.includes("opentofu") || l.includes("hcloud") || l.includes("nixos-anywhere")) return "infra";
  if (l.includes("github_token") || l.includes("base flake")) return "github";
  if (l.includes("ssh") || l.includes("targethost") || l.includes("authorizedkeys")) return "ssh";
  if (l.startsWith("nix")) return "nix";

  return "other";
}

function groupChecks(params: { checks: DoctorCheck[]; showOk: boolean }): Array<{
  scope: DoctorCheck["scope"];
  category: string;
  checks: DoctorCheck[];
  worst: DoctorStatus;
}> {
  const byKey = new Map<string, { scope: DoctorCheck["scope"]; category: string; checks: DoctorCheck[] }>();

  for (const c of params.checks) {
    if (!params.showOk && c.status === "ok") continue;
    const category = categoryForLabel(c.label);
    const key = `${c.scope}:${category}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.checks.push(c);
      continue;
    }
    byKey.set(key, { scope: c.scope, category, checks: [c] });
  }

  const groups = Array.from(byKey.values()).map((g) => {
    const worst = g.checks.reduce<DoctorStatus>((acc, c) => (STATUS_ORDER[c.status] < STATUS_ORDER[acc] ? c.status : acc), "ok");
    g.checks.sort((a, b) => {
      const d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (d !== 0) return d;
      return a.label.localeCompare(b.label);
    });
    return { ...g, worst };
  });

  groups.sort((a, b) => {
    const scopeOrder = SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope];
    if (scopeOrder !== 0) return scopeOrder;
    const worstOrder = STATUS_ORDER[a.worst] - STATUS_ORDER[b.worst];
    if (worstOrder !== 0) return worstOrder;
    return a.category.localeCompare(b.category);
  });

  return groups;
}

export function renderDoctorReport(params: {
  checks: DoctorCheck[];
  host: string;
  scope: "repo" | "bootstrap" | "server-deploy" | "cattle" | "all";
  strict: boolean;
  showOk: boolean;
}): string {
  const color = supportsColor(process.stdout);
  const counts = params.checks.reduce(
    (acc, c) => {
      acc[c.status] += 1;
      return acc;
    },
    { ok: 0, warn: 0, missing: 0 },
  );

  const groups = groupChecks({ checks: params.checks, showOk: params.showOk });

  const lines: string[] = [];
  lines.push(
    `doctor: host=${params.host} scope=${params.scope}${params.strict ? " strict" : ""}`,
  );
  lines.push(`summary: ok=${counts.ok} warn=${counts.warn} missing=${counts.missing}${!params.showOk && counts.ok > 0 ? " (ok hidden; pass --show-ok)" : ""}`);

  if (groups.length === 0) {
    lines.push("ok: no issues found");
    return lines.join("\n");
  }

  for (const g of groups) {
    lines.push("");
    lines.push(bold(`${g.scope} / ${g.category}`, { color }));
    for (const c of g.checks) {
      const tag = formatStatusTag(c.status, { color });
      lines.push(`  ${tag} ${c.label}${c.detail ? ` (${c.detail})` : ""}`);
    }
  }

  return lines.join("\n");
}

export function renderDoctorGateFailure(params: {
  checks: DoctorCheck[];
  scope: "repo" | "bootstrap" | "server-deploy";
  strict: boolean;
}): string {
  const missing = params.checks.filter((c) => c.status === "missing");
  const warn = params.checks.filter((c) => c.status === "warn");
  const failing = params.strict ? [...missing, ...warn] : missing;

  const groups = groupChecks({ checks: failing, showOk: true });
  const lines: string[] = [];
  lines.push(`doctor gate failed (${params.scope}${params.strict ? ", strict" : ""})`);
  lines.push(`missing=${missing.length}${params.strict ? ` warn=${warn.length}` : ""}`);

  const maxLines = 60;
  for (const g of groups) {
    if (lines.length >= maxLines) break;
    lines.push("");
    lines.push(`${g.scope} / ${g.category}`);
    for (const c of g.checks) {
      if (lines.length >= maxLines) break;
      lines.push(`  ${c.status.toUpperCase()}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`);
    }
  }

  lines.push("");
  lines.push(`hint: run clawdlets doctor --scope ${params.scope}${params.strict ? " --strict" : ""}`);
  return lines.join("\n");
}
