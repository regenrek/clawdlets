import { z } from "zod";
import { CattleTaskSchema, type CattleTask } from "@clawdlets/core/lib/cattle-task";
import { type ClfJobKind } from "./protocol.js";

export const ClfCattleSpawnPayloadSchema = z.object({
  identity: z.string().trim().min(1),
  task: CattleTaskSchema,
  ttl: z.string().trim().optional().default(""),
  image: z.string().trim().optional().default(""),
  serverType: z.string().trim().optional().default(""),
  location: z.string().trim().optional().default(""),
  autoShutdown: z.boolean().optional(),
  withGithubToken: z.boolean().optional().default(false),
});
export type ClfCattleSpawnPayload = z.infer<typeof ClfCattleSpawnPayloadSchema>;

export const ClfCattleReapPayloadSchema = z.object({
  dryRun: z.boolean().optional().default(false),
});
export type ClfCattleReapPayload = z.infer<typeof ClfCattleReapPayloadSchema>;

export type ClfJobPayloadByKind = {
  "cattle.spawn": ClfCattleSpawnPayload & { task: CattleTask };
  "cattle.reap": ClfCattleReapPayload;
};

export function parseClfJobPayload<K extends ClfJobKind>(kind: K, payload: unknown): ClfJobPayloadByKind[K] {
  if (kind === "cattle.spawn") return ClfCattleSpawnPayloadSchema.parse(payload) as ClfJobPayloadByKind[K];
  if (kind === "cattle.reap") return ClfCattleReapPayloadSchema.parse(payload) as ClfJobPayloadByKind[K];
  // Exhaustive guard for future extensions.
  throw new Error(`unsupported job kind: ${String(kind)}`);
}
