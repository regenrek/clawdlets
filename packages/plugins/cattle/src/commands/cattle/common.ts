import fs from "node:fs";
import { capture } from "@clawdlets/core/lib/run";
import { parseTtlToSeconds } from "@clawdlets/cattle-core/lib/ttl";
import { CattleTaskSchema, CATTLE_TASK_SCHEMA_VERSION, type CattleTask } from "@clawdlets/cattle-core/lib/cattle-task";
import type { CattleServer } from "@clawdlets/cattle-core/lib/hcloud-cattle";

export function requireEnabled(params: { enabled: boolean; hint: string }): void {
  if (params.enabled) return;
  throw new Error(params.hint);
}

export function requireFile(pathname: string, label: string): void {
  if (fs.existsSync(pathname)) return;
  throw new Error(`${label} missing: ${pathname}`);
}

export function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid JSON: ${filePath} (${String((e as Error)?.message || e)})`);
  }
}

export function requireTtlSeconds(ttlRaw: string): { seconds: number; normalized: string } {
  const parsed = parseTtlToSeconds(ttlRaw);
  if (!parsed) throw new Error(`invalid --ttl: ${ttlRaw} (expected e.g. 30m, 2h, 1d)`);
  return { seconds: parsed.seconds, normalized: parsed.raw };
}

export function unixSecondsNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function formatAgeSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${ss}s`;
  return `${ss}s`;
}

export function formatTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const widths: number[] = [];
  for (const r of rows) {
    for (let i = 0; i < r.length; i++) {
      widths[i] = Math.max(widths[i] || 0, String(r[i] ?? "").length);
    }
  }
  return rows
    .map((r) => r.map((c, i) => String(c ?? "").padEnd(widths[i] || 0)).join("  ").trimEnd())
    .join("\n");
}

export async function resolveTailscaleIpv4(hostname: string): Promise<string> {
  const name = String(hostname || "").trim();
  if (!name) throw new Error("hostname missing for tailscale ip resolution");
  const out = await capture("tailscale", ["ip", "--1", "--4", name], { maxOutputBytes: 4096 });
  const ip = out.trim();
  if (!ip) throw new Error(`tailscale ip returned empty output for ${name}`);
  return ip;
}

export function loadTaskFromFile(taskFile: string): CattleTask {
  const raw = readJsonFile(taskFile);
  const parsed = CattleTaskSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid task file (expected schemaVersion ${CATTLE_TASK_SCHEMA_VERSION}): ${taskFile}`);
  return parsed.data;
}

export async function waitForClfJobTerminal(params: {
  client: { show: (jobId: string) => Promise<{ job: any }> };
  jobId: string;
  timeoutMs: number;
  pollMs: number;
}): Promise<any> {
  const start = Date.now();
  while (true) {
    const res = await params.client.show(params.jobId);
    const job = res.job;
    if (job?.status === "done" || job?.status === "failed" || job?.status === "canceled") return job;
    if (Date.now() - start > params.timeoutMs) {
      throw new Error(`timeout waiting for job ${params.jobId} (last=${String(job?.status || "")})`);
    }
    await new Promise((r) => setTimeout(r, params.pollMs));
  }
}

export function resolveOne(servers: CattleServer[], idOrName: string): CattleServer {
  const v = String(idOrName || "").trim();
  if (!v) throw new Error("missing id/name");
  const byId = servers.find((s) => s.id === v);
  if (byId) return byId;
  const byName = servers.find((s) => s.name === v);
  if (byName) return byName;
  throw new Error(`cattle server not found: ${v}`);
}

