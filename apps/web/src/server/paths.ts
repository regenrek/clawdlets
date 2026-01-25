import path from "node:path";
import os from "node:os";

export function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("path required");
  if (trimmed.includes("\u0000")) throw new Error("invalid path");

  const expanded =
    trimmed === "~"
      ? os.homedir()
      : trimmed.startsWith("~/")
        ? path.join(os.homedir(), trimmed.slice(2))
        : trimmed;

  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
}

