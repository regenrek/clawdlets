import { z } from "zod";

import { BotIdSchema, EnvVarNameSchema, SecretNameSchema } from "./identifiers.js";

export const SECRET_KINDS = ["env", "file", "extra"] as const;
export const SecretKindSchema = z.enum(SECRET_KINDS);
export type SecretKind = z.infer<typeof SecretKindSchema>;

export const SECRET_SCOPES = ["host", "bot"] as const;
export const SecretScopeSchema = z.enum(SECRET_SCOPES);
export type SecretScope = z.infer<typeof SecretScopeSchema>;

export const SECRET_SOURCES = ["channel", "model", "provider", "custom"] as const;
export const SecretSourceSchema = z.enum(SECRET_SOURCES);
export type SecretSource = z.infer<typeof SecretSourceSchema>;

export const SecretSpecSchema = z
  .object({
    name: SecretNameSchema,
    kind: SecretKindSchema,
    scope: SecretScopeSchema,
    source: SecretSourceSchema,
    optional: z.boolean().optional(),
    help: z.string().trim().optional(),
    envVars: z.array(EnvVarNameSchema).optional(),
    bots: z.array(BotIdSchema).optional(),
    fileId: z.string().trim().optional(),
  })
  .strict();

export type SecretSpec = z.infer<typeof SecretSpecSchema>;

export const MissingSecretConfigSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("envVar"),
      bot: BotIdSchema,
      envVar: EnvVarNameSchema,
      sources: z.array(SecretSourceSchema).default(() => []),
      paths: z.array(z.string().trim()).default(() => []),
    })
    .strict(),
  z
    .object({
      kind: z.literal("secretFile"),
      scope: SecretScopeSchema,
      bot: BotIdSchema.optional(),
      fileId: z.string().trim().min(1),
      targetPath: z.string().trim().min(1),
      message: z.string().trim().min(1),
    })
    .strict(),
]);

export type MissingSecretConfig = z.infer<typeof MissingSecretConfigSchema>;

export const SecretsPlanWarningSchema = z
  .object({
    kind: z.enum(["inlineToken", "inlineApiKey", "statefulChannel", "config"]),
    message: z.string().trim().min(1),
    path: z.string().trim().optional(),
    suggestion: z.string().trim().optional(),
    channel: z.string().trim().optional(),
    bot: BotIdSchema.optional(),
  })
  .strict();

export type SecretsPlanWarning = z.infer<typeof SecretsPlanWarningSchema>;

export const SecretsPlanSchema = z
  .object({
    required: z.array(SecretSpecSchema).default(() => []),
    optional: z.array(SecretSpecSchema).default(() => []),
    missing: z.array(MissingSecretConfigSchema).default(() => []),
    warnings: z.array(SecretsPlanWarningSchema).default(() => []),
  })
  .strict();

export type SecretsPlan = z.infer<typeof SecretsPlanSchema>;
