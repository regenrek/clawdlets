import { spawn } from "node:child_process";
import readline from "node:readline";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { RunEventLevel } from "@clawdlets/core/lib/run-types";
import type { ConvexClient } from "./convex";
import { redactLine } from "./redaction";

export type RunManagerEvent = {
  ts: number;
  level: RunEventLevel;
  message: string;
  data?: unknown;
  redacted?: boolean;
};

const active = new Map<string, { child: ReturnType<typeof spawn>; aborted: boolean }>();
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_EVENT_LIMITS = {
  maxEvents: 5000,
  maxBytes: 512 * 1024,
  maxBatchSize: 100,
  flushIntervalMs: 1000,
} as const;

const SAFE_ENV_KEYS = new Set([
  "COLORTERM",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LOGNAME",
  "NIX_BIN",
  "NODE_OPTIONS",
  "PATH",
  "PWD",
  "SHELL",
  "SOPS_AGE_KEY_FILE",
  "SSH_AUTH_SOCK",
  "TERM",
  "TMP",
  "TEMP",
  "TMPDIR",
  "USER",
]);

const SAFE_ENV_PREFIXES = ["LC_", "XDG_", "GIT_"];

function isSafeEnvKey(key: string): boolean {
  if (SAFE_ENV_KEYS.has(key)) return true;
  return SAFE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function buildSafeEnv(params: {
  baseEnv: NodeJS.ProcessEnv;
  extraEnv?: NodeJS.ProcessEnv;
  allowlist?: string[];
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(params.baseEnv || {})) {
    if (value === undefined) continue;
    if (!isSafeEnvKey(key)) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(params.extraEnv || {})) {
    if (value === undefined) continue;
    const permitted = isSafeEnvKey(key) || (params.allowlist ? params.allowlist.includes(key) : false);
    if (!permitted) continue;
    env[key] = value;
  }
  return env;
}

function resolveCommand(cmd: string): { exec: string; display: string } {
  if (cmd === "node") return { exec: process.execPath, display: "node" };
  return { exec: cmd, display: cmd };
}

function scheduleTermination(params: { child: ReturnType<typeof spawn>; timeoutMs: number; killAfterMs: number }) {
  let killed = false;
  let killTimer: NodeJS.Timeout | null = null;
  const terminate = setTimeout(() => {
    try {
      params.child.kill("SIGTERM");
    } catch {
      // ignore
    }
    killTimer = setTimeout(() => {
      if (killed) return;
      try {
        params.child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, params.killAfterMs);
  }, params.timeoutMs);

  const clear = () => {
    killed = true;
    clearTimeout(terminate);
    if (killTimer) clearTimeout(killTimer);
  };

  return { clear };
}

type RunEventLimits = {
  maxEvents: number;
  maxBytes: number;
  maxBatchSize: number;
  flushIntervalMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cancelActiveRun(runId: string): boolean {
  const entry = active.get(runId);
  if (!entry) return false;
  entry.aborted = true;
  try {
    entry.child.kill("SIGTERM");
  } catch {
    // ignore
  }
  return true;
}

async function appendEvents(client: ConvexClient, runId: Id<"runs">, events: RunManagerEvent[]): Promise<void> {
  if (events.length === 0) return;
  const payload = {
    runId,
    events: events.map((e) => ({
      ts: e.ts,
      level: e.level,
      message: e.message,
      data: e.data,
      redacted: e.redacted,
    })),
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await client.mutation(api.runEvents.appendBatch, payload);
      return;
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(250 * (attempt + 1));
    }
  }
}

export async function runWithEvents(params: {
  client: ConvexClient;
  runId: Id<"runs">;
  redactTokens: string[];
  limits?: Partial<RunEventLimits>;
  fn: (emit: (e: Omit<RunManagerEvent, "ts"> & { ts?: number }) => Promise<void>) => Promise<void>;
}): Promise<void> {
  let buffer: RunManagerEvent[] = [];
  let bufferBytes = 0;
  let totalEvents = 0;
  let totalBytes = 0;
  let truncated = false;
  let lastFlush = Date.now();
  let flushInFlight: Promise<void> | null = null;
  const limits: RunEventLimits = { ...DEFAULT_EVENT_LIMITS, ...params.limits };

  const flush = async () => {
    if (flushInFlight) {
      await flushInFlight;
    }
    const batch = buffer;
    buffer = [];
    bufferBytes = 0;
    if (batch.length === 0) return;
    const promise = appendEvents(params.client, params.runId, batch);
    flushInFlight = promise;
    try {
      await promise;
    } finally {
      if (flushInFlight === promise) flushInFlight = null;
      lastFlush = Date.now();
    }
  };

  const emit = async (e: Omit<RunManagerEvent, "ts"> & { ts?: number }) => {
    if (truncated) return;
    const ts = e.ts ?? Date.now();
    const message = redactLine(e.message, params.redactTokens);
    const messageBytes = Buffer.byteLength(message, "utf8");
    if (totalEvents >= limits.maxEvents || totalBytes + messageBytes > limits.maxBytes) {
      if (!truncated) {
        truncated = true;
        const warning = `log truncated after ${totalEvents} events (${Math.ceil(totalBytes / 1024)}KB).`;
        const warningBytes = Buffer.byteLength(warning, "utf8");
        buffer.push({
          ts,
          level: "warn",
          message: warning,
        });
        totalEvents += 1;
        totalBytes += warningBytes;
        bufferBytes += warningBytes;
      }
      await flush();
      return;
    }
    buffer.push({
      ts,
      level: e.level,
      message,
      data: e.data,
      redacted: message !== e.message || e.redacted,
    });
    totalEvents += 1;
    totalBytes += messageBytes;
    bufferBytes += messageBytes;
    const now = Date.now();
    if (buffer.length >= limits.maxBatchSize || bufferBytes >= limits.maxBytes || now - lastFlush >= limits.flushIntervalMs) {
      await flush();
    }
  };

  try {
    await params.fn(emit);
    await flush();
  } catch (err) {
    try {
      await emit({
        level: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      await flush();
    } catch {
      // ignore secondary errors
    }
    throw err;
  }
}

export async function spawnCommand(params: {
  client: ConvexClient;
  runId: Id<"runs">;
  cwd: string;
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  killGraceMs?: number;
  envAllowlist?: string[];
  redactTokens: string[];
  timeoutMs?: number;
}): Promise<void> {
  await runWithEvents({
    client: params.client,
    runId: params.runId,
    redactTokens: params.redactTokens,
    fn: async (emit) => {
      const cmd = resolveCommand(params.cmd);
      await emit({ level: "info", message: `$ ${cmd.display} [${params.args.length} args]` });

      if (active.has(params.runId)) {
        throw new Error("run already active");
      }

      const child = spawn(cmd.exec, params.args, {
        cwd: params.cwd,
        env: buildSafeEnv({ baseEnv: process.env, extraEnv: params.env, allowlist: params.envAllowlist }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      active.set(params.runId, { child, aborted: false });
      const timeoutMs = params.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
      let timedOut = false;
      const killGraceMs = Math.max(250, params.killGraceMs ?? 5_000);
      const termination = scheduleTermination({ child, timeoutMs, killAfterMs: killGraceMs });
      const timeout = setTimeout(() => {
        timedOut = true;
      }, timeoutMs);

      const onLine = async (level: RunEventLevel, line: string) => {
        const msg = line.trimEnd();
        if (!msg) return;
        await emit({ level, message: msg });
      };

      const stdout = child.stdout ? readline.createInterface({ input: child.stdout }) : null;
      const stderr = child.stderr ? readline.createInterface({ input: child.stderr }) : null;
      const pumpStdout = (async () => {
        if (!stdout) return;
        for await (const line of stdout) await onLine("info", line);
      })();
      const pumpStderr = (async () => {
        if (!stderr) return;
        for await (const line of stderr) await onLine("warn", line);
      })();

      try {
        const exitCode = await new Promise<number>((resolve, reject) => {
          child.on("error", (e) => reject(e));
          child.on("close", (code) => resolve(code ?? 0));
        });

        await Promise.allSettled([pumpStdout, pumpStderr]);

        const entry = active.get(params.runId);
        if (entry?.aborted) throw new Error("run canceled");
        if (timedOut) throw new Error(`run timed out after ${Math.ceil(timeoutMs / 1000)}s`);
        if (exitCode !== 0) throw new Error(`${params.cmd} exited with code ${exitCode}`);
      } finally {
        clearTimeout(timeout);
        termination.clear();
        active.delete(params.runId);
      }
    },
  });
}

export async function spawnCommandCapture(params: {
  client: ConvexClient;
  runId: Id<"runs">;
  cwd: string;
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  killGraceMs?: number;
  envAllowlist?: string[];
  redactTokens: string[];
  maxCaptureBytes?: number;
  allowNonZeroExit?: boolean;
  timeoutMs?: number;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let exitCode = 0;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let capturedBytes = 0;

  const pushCaptured = (lines: string[], line: string) => {
    if (!params.maxCaptureBytes) {
      lines.push(line);
      return;
    }
    if (capturedBytes >= params.maxCaptureBytes) return;
    const nextBytes = Buffer.byteLength(line, "utf8") + 1;
    if (capturedBytes + nextBytes > params.maxCaptureBytes) return;
    capturedBytes += nextBytes;
    lines.push(line);
  };

  await runWithEvents({
    client: params.client,
    runId: params.runId,
    redactTokens: params.redactTokens,
    fn: async (emit) => {
      const cmd = resolveCommand(params.cmd);
      await emit({ level: "info", message: `$ ${cmd.display} [${params.args.length} args]` });

      if (active.has(params.runId)) {
        throw new Error("run already active");
      }

      const child = spawn(cmd.exec, params.args, {
        cwd: params.cwd,
        env: buildSafeEnv({ baseEnv: process.env, extraEnv: params.env, allowlist: params.envAllowlist }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      active.set(params.runId, { child, aborted: false });
      const timeoutMs = params.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
      let timedOut = false;
      const killGraceMs = Math.max(250, params.killGraceMs ?? 5_000);
      const termination = scheduleTermination({ child, timeoutMs, killAfterMs: killGraceMs });
      const timeout = setTimeout(() => {
        timedOut = true;
      }, timeoutMs);

      const onLine = async (level: RunEventLevel, line: string) => {
        const msg = line.trimEnd();
        if (!msg) return;
        await emit({ level, message: msg });
      };

      const stdout = child.stdout ? readline.createInterface({ input: child.stdout }) : null;
      const stderr = child.stderr ? readline.createInterface({ input: child.stderr }) : null;
      const pumpStdout = (async () => {
        if (!stdout) return;
        for await (const line of stdout) {
          pushCaptured(stdoutLines, line);
          await onLine("info", line);
        }
      })();
      const pumpStderr = (async () => {
        if (!stderr) return;
        for await (const line of stderr) {
          pushCaptured(stderrLines, line);
          await onLine("warn", line);
        }
      })();

      try {
        exitCode = await new Promise<number>((resolve, reject) => {
          child.on("error", (e) => reject(e));
          child.on("close", (code) => resolve(code ?? 0));
        });

        await Promise.allSettled([pumpStdout, pumpStderr]);

        const entry = active.get(params.runId);
        if (entry?.aborted) throw new Error("run canceled");
        if (timedOut) throw new Error(`run timed out after ${Math.ceil(timeoutMs / 1000)}s`);

        if (exitCode !== 0 && !params.allowNonZeroExit) {
          throw new Error(`${params.cmd} exited with code ${exitCode}`);
        }
        if (exitCode !== 0 && params.allowNonZeroExit) {
          await emit({ level: "warn", message: `${params.cmd} exited with code ${exitCode}` });
        }
      } finally {
        clearTimeout(timeout);
        termination.clear();
        active.delete(params.runId);
      }
    },
  });

  return {
    exitCode,
    stdout: stdoutLines.join("\n").trim(),
    stderr: stderrLines.join("\n").trim(),
  };
}
