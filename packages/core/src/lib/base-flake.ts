import { tryGetOriginFlake } from "./git.js";
import type { ClawdletsConfig } from "./clawdlets-config.js";

export async function resolveBaseFlake(params: {
  repoRoot: string;
  config: ClawdletsConfig;
}): Promise<{ flake: string | null; source: "config" | "origin" | "none" }> {
  const fromConfig = String(params.config.baseFlake || "").trim();
  if (fromConfig) return { flake: fromConfig, source: "config" };
  const fromOrigin = (await tryGetOriginFlake(params.repoRoot)) ?? null;
  if (fromOrigin) return { flake: fromOrigin, source: "origin" };
  return { flake: null, source: "none" };
}

