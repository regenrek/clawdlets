import { z } from "zod";

export const CLF_PROTOCOL_VERSION = 1 as const;

export const ClfJobStatusSchema = z.enum(["queued", "running", "done", "failed", "canceled"]);
export type ClfJobStatus = z.infer<typeof ClfJobStatusSchema>;

export const ClfJobKindSchema = z.enum(["cattle.spawn", "cattle.reap"]);
export type ClfJobKind = z.infer<typeof ClfJobKindSchema>;

export const ClfJobSummarySchema = z.object({
  jobId: z.string().trim().min(1),
  kind: ClfJobKindSchema,
  status: ClfJobStatusSchema,
  requester: z.string().trim().min(1),
  idempotencyKey: z.string().trim().optional().default(""),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  runAt: z.string().trim().min(1),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  lastError: z.string().trim().optional().default(""),
  result: z.unknown().optional(),
});
export type ClfJobSummary = z.infer<typeof ClfJobSummarySchema>;

export const ClfJobsEnqueueRequestSchema = z.object({
  protocolVersion: z.literal(CLF_PROTOCOL_VERSION),
  requester: z.string().trim().min(1),
  idempotencyKey: z.string().trim().optional().default(""),
  kind: ClfJobKindSchema,
  payload: z.unknown(),
  runAt: z.string().trim().optional().default(""),
  priority: z.number().int().optional().default(0),
});
export type ClfJobsEnqueueRequest = z.infer<typeof ClfJobsEnqueueRequestSchema>;

export const ClfJobsEnqueueResponseSchema = z.object({
  protocolVersion: z.literal(CLF_PROTOCOL_VERSION),
  jobId: z.string().trim().min(1),
});
export type ClfJobsEnqueueResponse = z.infer<typeof ClfJobsEnqueueResponseSchema>;

export const ClfJobsListResponseSchema = z.object({
  protocolVersion: z.literal(CLF_PROTOCOL_VERSION),
  jobs: z.array(ClfJobSummarySchema),
});
export type ClfJobsListResponse = z.infer<typeof ClfJobsListResponseSchema>;

export const ClfJobsShowResponseSchema = z.object({
  protocolVersion: z.literal(CLF_PROTOCOL_VERSION),
  job: ClfJobSummarySchema.extend({
    payload: z.unknown(),
  }),
});
export type ClfJobsShowResponse = z.infer<typeof ClfJobsShowResponseSchema>;

export const ClfJobsCancelResponseSchema = z.object({
  protocolVersion: z.literal(CLF_PROTOCOL_VERSION),
  ok: z.literal(true),
});
export type ClfJobsCancelResponse = z.infer<typeof ClfJobsCancelResponseSchema>;
