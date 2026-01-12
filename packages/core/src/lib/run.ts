import { spawn } from "node:child_process";

export type RunOpts = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  redact?: string[];
};

function redactLine(line: string, values?: string[]): string {
  if (!values || values.length === 0) return line;
  let redacted = line;
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    redacted = redacted.split(trimmed).join("<redacted>");
  }
  return redacted;
}

export async function run(
  cmd: string,
  args: string[],
  opts: RunOpts = {},
): Promise<void> {
  if (opts.dryRun) {
    const line = [cmd, ...args].join(" ");
    console.log(redactLine(line, opts.redact));
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code ?? "null"}`));
    });
  });
}

export async function capture(
  cmd: string,
  args: string[],
  opts: RunOpts = {},
): Promise<string> {
  if (opts.dryRun) return "";

  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    child.stdout.on("data", (buf) => {
      chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8").trim());
      else reject(new Error(`${cmd} exited with code ${code ?? "null"}`));
    });
  });
}

export async function captureWithInput(
  cmd: string,
  args: string[],
  input: string,
  opts: RunOpts = {},
): Promise<string> {
  if (opts.dryRun) return "";

  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "inherit"],
    });
    child.stdout.on("data", (buf) => {
      chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    });
    child.on("error", reject);
    child.stdin.write(input);
    child.stdin.end();
    child.on("exit", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8").trim());
      else reject(new Error(`${cmd} exited with code ${code ?? "null"}`));
    });
  });
}
