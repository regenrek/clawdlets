import fs from "node:fs";
import path from "node:path";

function octal(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`;
}

export function assertSafeUnixSocketPath(socketPath: string): void {
  const p = String(socketPath || "").trim();
  if (!p) throw new Error("socketPath missing");
  if (!path.isAbsolute(p)) throw new Error(`socketPath must be absolute: ${p}`);

  const dir = path.dirname(p);
  const dirSt = fs.statSync(dir);
  if (!dirSt.isDirectory()) throw new Error(`socket directory is not a directory: ${dir}`);
  const dirMode = dirSt.mode & 0o777;
  if ((dirMode & 0o002) !== 0) {
    throw new Error(`socket directory is world-writable (refusing): ${dir} (${octal(dirMode)})`);
  }

  const st = fs.lstatSync(p);
  if (!st.isSocket()) throw new Error(`socketPath is not a unix socket: ${p}`);

  const mode = st.mode & 0o777;
  if ((mode & 0o007) !== 0) {
    throw new Error(`socketPath is world-accessible (refusing): ${p} (${octal(mode)})`);
  }
  if ((mode & 0o600) !== 0o600) {
    throw new Error(`socketPath must be owner-rw (refusing): ${p} (${octal(mode)})`);
  }
}

export function tryChmodUnixSocket(socketPath: string, mode: number): void {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(socketPath, mode);
  } catch {
    // best-effort: systemd-owned sockets may not be chmod-able by the service user.
  }
}

