import { capture, run, type RunOpts } from "./run.js";

const SSH_TARGET_HOST_RE =
  /^(?:[A-Za-z0-9._-]+@)?(?:[A-Za-z0-9._-]+|\[[0-9a-fA-F:]+\])$/;
const CONTROL_OR_WHITESPACE_RE = /[\s\u0000-\u001f\u007f]/;

export function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function isValidTargetHost(targetHost: string): boolean {
  const v = targetHost.trim();
  if (!v) return false;
  if (v.startsWith("-")) return false;
  if (CONTROL_OR_WHITESPACE_RE.test(v)) return false;
  return SSH_TARGET_HOST_RE.test(v);
}

export function validateTargetHost(targetHost: string): string {
  const v = targetHost.trim();
  if (!isValidTargetHost(v)) {
    throw new Error(
      "invalid target host: expected ssh alias or user@host (no whitespace/control chars; no leading '-')",
    );
  }
  return v;
}

export function buildSshArgs(targetHost: string, opts: { tty?: boolean } = {}): string[] {
  const safeHost = validateTargetHost(targetHost);
  return [...(opts.tty ? ["-t"] : []), "--", safeHost];
}

export async function sshRun(
  targetHost: string,
  remoteCmd: string,
  opts: RunOpts & { tty?: boolean } = {},
): Promise<void> {
  const sshArgs = [...buildSshArgs(targetHost, { tty: opts.tty }), remoteCmd];
  await run("ssh", sshArgs, opts);
}

export async function sshCapture(
  targetHost: string,
  remoteCmd: string,
  opts: RunOpts & { tty?: boolean } = {},
): Promise<string> {
  const sshArgs = [...buildSshArgs(targetHost, { tty: opts.tty }), remoteCmd];
  return await capture("ssh", sshArgs, opts);
}
