import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function hasNeededExperimentalFeatures(existing: string): boolean {
  const normalized = existing.replace(/\s+/g, " ").toLowerCase();
  if (!normalized.includes("experimental-features")) return false;
  return normalized.includes("nix-command") && normalized.includes("flakes");
}

function isWritableDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isWritablePathOrParent(target: string): boolean {
  const normalized = target.trim();
  if (!normalized) return false;
  try {
    fs.accessSync(normalized, fs.constants.W_OK);
    return true;
  } catch {
    try {
      fs.accessSync(path.dirname(normalized), fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

export function withFlakesEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = { ...process.env, ...(env || {}) };
  const homeDir = String(base.HOME || "").trim();
  const needsPrivateXdgHome = Boolean(homeDir) && !isWritableDir(homeDir);

  const xdgRoot = path.join(os.tmpdir(), "clawdlets-xdg");
  const withXdg = needsPrivateXdgHome
    ? {
        ...base,
        XDG_CACHE_HOME: isWritablePathOrParent(String(base.XDG_CACHE_HOME || "")) ? base.XDG_CACHE_HOME : path.join(xdgRoot, "cache"),
        XDG_CONFIG_HOME: isWritablePathOrParent(String(base.XDG_CONFIG_HOME || "")) ? base.XDG_CONFIG_HOME : path.join(xdgRoot, "config"),
        XDG_DATA_HOME: isWritablePathOrParent(String(base.XDG_DATA_HOME || "")) ? base.XDG_DATA_HOME : path.join(xdgRoot, "data"),
        XDG_STATE_HOME: isWritablePathOrParent(String(base.XDG_STATE_HOME || "")) ? base.XDG_STATE_HOME : path.join(xdgRoot, "state"),
      }
    : base;

  const neededFlakes = "experimental-features = nix-command flakes";
  const neededXdg = "use-xdg-base-directories = true";
  const existing = String(withXdg.NIX_CONFIG || "").trim();

  if (!existing) {
    return {
      ...withXdg,
      NIX_CONFIG: needsPrivateXdgHome ? `${neededFlakes}\n${neededXdg}` : neededFlakes,
    };
  }

  const additions: string[] = [];
  if (!hasNeededExperimentalFeatures(existing)) additions.push(neededFlakes);
  if (needsPrivateXdgHome) additions.push(neededXdg);
  if (additions.length === 0) return withXdg;

  return { ...withXdg, NIX_CONFIG: `${existing}\n${additions.join("\n")}` };
}
