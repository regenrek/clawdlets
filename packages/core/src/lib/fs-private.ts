import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function ensurePrivateDir(dirPath: string): void {
  const dir = path.isAbsolute(dirPath) ? dirPath : path.resolve(process.cwd(), dirPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") return;
  const st = fs.statSync(dir);
  if (!st.isDirectory()) throw new Error(`not a directory: ${dir}`);
  const mode = st.mode & 0o777;
  if ((mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
  const st2 = fs.statSync(dir);
  const mode2 = st2.mode & 0o777;
  if ((mode2 & 0o077) !== 0) throw new Error(`failed to secure directory permissions: ${dir} (mode 0${mode2.toString(8)})`);
}

export function ensurePrivateFile(filePath: string): void {
  if (process.platform === "win32") return;
  if (!fs.existsSync(filePath)) return;
  const st = fs.statSync(filePath);
  if (!st.isFile()) throw new Error(`not a file: ${filePath}`);
  const mode = st.mode & 0o777;
  if ((mode & 0o077) !== 0) fs.chmodSync(filePath, 0o600);
  const mode2 = (fs.statSync(filePath).mode & 0o777) >>> 0;
  if ((mode2 & 0o077) !== 0) throw new Error(`failed to secure file permissions: ${filePath} (mode 0${mode2.toString(8)})`);
}

