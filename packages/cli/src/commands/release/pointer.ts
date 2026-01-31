import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { loadHostContextOrExit } from "@clawdlets/core/lib/context";
import { formatReleasePointer, ReleasePointerV1Schema } from "@clawdlets/core/lib/release-manifest";

function requireChannel(value: string): string {
  const v = value.trim();
  if (!v) throw new Error("missing --channel");
  if (!/^[a-z][a-z0-9-]*$/.test(v)) throw new Error(`invalid --channel: ${v} (use [a-z][a-z0-9-]*)`);
  return v;
}

function requireReleaseId(value: string): number {
  const v = value.trim();
  if (!v) throw new Error("missing --release-id");
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid --release-id: ${v} (expected positive integer)`);
  return n;
}

function toPathFromCwd(cwd: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

const pointerWrite = defineCommand({
  meta: {
    name: "write",
    description: "Write latest.json pointer for a host+channel (signed separately).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    channel: { type: "string", description: "Release channel (staging|prod|...)." },
    releaseId: { type: "string", description: "Monotonic issuance id for this host+channel (integer)." },
    file: { type: "string", description: "Optional immutable manifest filename (default: <releaseId>.json)." },
    out: { type: "string", description: "Output pointer path (default: deploy/<host>/<channel>/latest.json)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName } = ctx;

    const channel = requireChannel(String(args.channel || ""));
    const releaseId = requireReleaseId(String((args as any).releaseId || ""));
    const file = String((args as any).file || "").trim() || `${String(releaseId)}.json`;

    const outRaw = String((args as any).out || "").trim();
    const outPath = outRaw ? toPathFromCwd(cwd, outRaw) : path.join(cwd, "deploy", hostName, channel, "latest.json");

    const pointer = ReleasePointerV1Schema.parse({
      releaseId,
      file,
    });

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, formatReleasePointer(pointer), "utf8");
    console.log(`ok: wrote release pointer ${outPath}`);
  },
});

export const releasePointer = defineCommand({
  meta: {
    name: "pointer",
    description: "Release pointer (latest.json) tooling.",
  },
  subCommands: {
    write: pointerWrite,
  },
});
