import { z } from "zod";

export const CATTLE_TASK_SCHEMA_VERSION = 1 as const;

export const CattleTaskSchema = z.object({
  schemaVersion: z.literal(CATTLE_TASK_SCHEMA_VERSION),
  taskId: z.string().trim().min(1),
  type: z.literal("clawdbot.gateway.agent"),
  message: z.string().trim().min(1),
  callbackUrl: z.string().trim().optional().default(""),
});

export type CattleTask = z.infer<typeof CattleTaskSchema>;

