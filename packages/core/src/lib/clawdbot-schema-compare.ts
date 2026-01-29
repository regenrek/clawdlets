import type { ClawdbotSchemaArtifact } from "./clawdbot-schema.js";
import { getPinnedClawdbotSchema } from "./clawdbot-schema.js";
import { fetchNixClawdbotSourceInfo, getNixClawdbotRevFromFlakeLock } from "./nix-clawdbot.js";

type FetchSourceInfo = typeof fetchNixClawdbotSourceInfo;
type GetPinnedSchema = typeof getPinnedClawdbotSchema;
type GetNixRev = typeof getNixClawdbotRevFromFlakeLock;

export type ClawdbotSchemaPinnedComparison =
  | { ok: true; nixClawdbotRev: string; clawdbotRev: string; matches: boolean }
  | { ok: false; nixClawdbotRev: string; error: string };

export type ClawdbotSchemaUpstreamComparison =
  | { ok: true; nixClawdbotRef: string; clawdbotRev: string; matches: boolean }
  | { ok: false; nixClawdbotRef: string; error: string };

export type ClawdbotSchemaComparison = {
  schemaVersion: string;
  schemaRev: string;
  pinned?: ClawdbotSchemaPinnedComparison;
  upstream: ClawdbotSchemaUpstreamComparison;
  warnings: string[];
};

export type ClawdbotSchemaComparisonSummary = {
  schemaVersion: string;
  schemaRev: string;
  warnings: string[];
  pinned?:
    | {
        ok: true;
        status: "ok" | "warn";
        nixClawdbotRev: string;
        clawdbotRev: string;
        matches: boolean;
      }
    | {
        ok: false;
        status: "warn";
        nixClawdbotRev: string;
        error: string;
      };
  upstream:
    | {
        ok: true;
        status: "ok" | "warn";
        nixClawdbotRef: string;
        clawdbotRev: string;
        matches: boolean;
      }
    | {
        ok: false;
        status: "warn";
        nixClawdbotRef: string;
        error: string;
      };
};

type CompareDeps = {
  schema?: ClawdbotSchemaArtifact;
  getPinnedSchema?: GetPinnedSchema;
  getNixClawdbotRevFromFlakeLock?: GetNixRev;
  fetchNixClawdbotSourceInfo?: FetchSourceInfo;
  requireSchemaRev?: boolean;
};

export async function compareClawdbotSchemaToNixClawdbot(
  params: { repoRoot: string } & CompareDeps,
): Promise<ClawdbotSchemaComparison | null> {
  const getPinnedSchema = params.getPinnedSchema ?? getPinnedClawdbotSchema;
  const getNixRev = params.getNixClawdbotRevFromFlakeLock ?? getNixClawdbotRevFromFlakeLock;
  const fetchSourceInfo = params.fetchNixClawdbotSourceInfo ?? fetchNixClawdbotSourceInfo;
  const schema = params.schema ?? getPinnedSchema();
  const schemaRev = schema?.clawdbotRev?.trim() || "";
  const schemaVersion = schema?.version?.trim() || "";
  const requireSchemaRev = params.requireSchemaRev ?? false;
  if (requireSchemaRev && !schemaRev) return null;

  const warnings: string[] = [];
  const nixClawdbotRev = getNixRev(params.repoRoot);
  let pinned: ClawdbotSchemaPinnedComparison | undefined;
  if (nixClawdbotRev) {
    const pinnedResult = await fetchSourceInfo({ ref: nixClawdbotRev });
    if (!pinnedResult.ok) {
      warnings.push(`pinned nix-clawdbot fetch failed: ${pinnedResult.error}`);
      pinned = { ok: false, nixClawdbotRev, error: pinnedResult.error };
    } else {
      const matches = schemaRev ? pinnedResult.info.rev === schemaRev : false;
      pinned = { ok: true, nixClawdbotRev, clawdbotRev: pinnedResult.info.rev, matches };
    }
  }

  const upstreamResult = await fetchSourceInfo({ ref: "main" });
  let upstream: ClawdbotSchemaUpstreamComparison;
  if (!upstreamResult.ok) {
    warnings.push(`upstream nix-clawdbot fetch failed: ${upstreamResult.error}`);
    upstream = { ok: false, nixClawdbotRef: "main", error: upstreamResult.error };
  } else {
    const matches = schemaRev ? upstreamResult.info.rev === schemaRev : false;
    upstream = { ok: true, nixClawdbotRef: "main", clawdbotRev: upstreamResult.info.rev, matches };
  }

  return {
    schemaVersion,
    schemaRev,
    pinned,
    upstream,
    warnings,
  };
}

export function summarizeClawdbotSchemaComparison(
  comparison: ClawdbotSchemaComparison,
): ClawdbotSchemaComparisonSummary {
  const pinned: ClawdbotSchemaComparisonSummary["pinned"] = comparison.pinned
    ? comparison.pinned.ok
      ? {
          ok: true,
          status: comparison.pinned.matches ? "ok" : "warn",
          nixClawdbotRev: comparison.pinned.nixClawdbotRev,
          clawdbotRev: comparison.pinned.clawdbotRev,
          matches: comparison.pinned.matches,
        }
      : {
          ok: false,
          status: "warn",
          nixClawdbotRev: comparison.pinned.nixClawdbotRev,
          error: comparison.pinned.error,
        }
    : undefined;

  const upstream: ClawdbotSchemaComparisonSummary["upstream"] = comparison.upstream.ok
    ? {
        ok: true,
        status: comparison.upstream.matches ? "ok" : "warn",
        nixClawdbotRef: comparison.upstream.nixClawdbotRef,
        clawdbotRev: comparison.upstream.clawdbotRev,
        matches: comparison.upstream.matches,
      }
    : {
        ok: false,
        status: "warn",
        nixClawdbotRef: comparison.upstream.nixClawdbotRef,
        error: comparison.upstream.error,
      };

  return {
    schemaVersion: comparison.schemaVersion,
    schemaRev: comparison.schemaRev,
    warnings: comparison.warnings,
    pinned,
    upstream,
  };
}
