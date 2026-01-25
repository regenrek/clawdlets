import { z } from "zod";

import { RUN_EVENT_LEVELS, RUN_KINDS, RUN_STATUSES } from "./run-constants.js";

export const RunKindSchema = z.enum(RUN_KINDS);
export type RunKind = z.infer<typeof RunKindSchema>;

export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunEventLevelSchema = z.enum(RUN_EVENT_LEVELS);
export type RunEventLevel = z.infer<typeof RunEventLevelSchema>;

export const RunEventSchema = z.object({
  ts: z.number().int().nonnegative(),
  level: RunEventLevelSchema,
  message: z.string().min(1),
  data: z.unknown().optional(),
  redacted: z.boolean().optional(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;
