import {
  compareClawdbotSchemaToNixClawdbot,
  summarizeClawdbotSchemaComparison,
} from "../lib/clawdbot-schema-compare.js";
import { getPinnedClawdbotSchema } from "../lib/clawdbot-schema.js";
import { fetchNixClawdbotSourceInfo, getNixClawdbotRevFromFlakeLock } from "../lib/nix-clawdbot.js";
import type { DoctorCheck } from "./types.js";

type SchemaCheckDeps = {
  getPinnedSchema?: typeof getPinnedClawdbotSchema;
  getNixClawdbotRevFromFlakeLock?: typeof getNixClawdbotRevFromFlakeLock;
  fetchNixClawdbotSourceInfo?: typeof fetchNixClawdbotSourceInfo;
};

export async function checkSchemaVsNixClawdbot(
  params: { repoRoot: string } & SchemaCheckDeps,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const comparison = await compareClawdbotSchemaToNixClawdbot({
    repoRoot: params.repoRoot,
    getPinnedSchema: params.getPinnedSchema ?? getPinnedClawdbotSchema,
    getNixClawdbotRevFromFlakeLock: params.getNixClawdbotRevFromFlakeLock ?? getNixClawdbotRevFromFlakeLock,
    fetchNixClawdbotSourceInfo: params.fetchNixClawdbotSourceInfo ?? fetchNixClawdbotSourceInfo,
    requireSchemaRev: true,
  });
  if (!comparison) return checks;

  const summary = summarizeClawdbotSchemaComparison(comparison);
  const schemaRev = summary.schemaRev;
  const schemaVersion = summary.schemaVersion;
  const pinned = summary.pinned;
  if (pinned) {
    if (!pinned.ok) {
      checks.push({
        scope: "repo",
        status: "warn",
        label: "clawdbot schema vs nix-clawdbot",
        detail: `pinned nix-clawdbot rev=${pinned.nixClawdbotRev.slice(0, 12)}... (${pinned.error})`,
      });
    } else {
      checks.push({
        scope: "repo",
        status: pinned.status,
        label: "clawdbot schema vs nix-clawdbot",
        detail: pinned.matches
          ? `schema=v${schemaVersion} rev=${schemaRev.slice(0, 12)}...`
          : `schema=v${schemaVersion} rev=${schemaRev.slice(0, 12)}... nix=${pinned.clawdbotRev.slice(0, 12)}...`,
      });
    }
  }

  const upstream = summary.upstream;
  if (!upstream.ok) {
    checks.push({
      scope: "repo",
      status: "warn",
      label: "clawdbot schema vs upstream",
      detail: `unable to fetch (main): ${upstream.error}`,
    });
  } else {
    checks.push({
      scope: "repo",
      status: upstream.status,
      label: "clawdbot schema vs upstream",
      detail: upstream.matches
        ? `schema=v${schemaVersion} rev=${schemaRev.slice(0, 12)}...`
        : `schema=v${schemaVersion} rev=${schemaRev.slice(0, 12)}... upstream=${upstream.clawdbotRev.slice(0, 12)}...`,
    });
  }

  return checks;
}
