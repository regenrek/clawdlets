import { z } from "zod";

import { EnvVarNameSchema, SecretNameSchema } from "./identifiers.js";

export const SecretEnvSchema = z.record(EnvVarNameSchema, SecretNameSchema).default(() => ({}));

export const SecretFileIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9._-]+$/, { message: "invalid secret file id (use [a-z0-9._-]+)" });

const AbsolutePathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => v.startsWith("/"), { message: "targetPath must be an absolute path" })
  .refine(
    (v) => !v.includes("/../") && !v.endsWith("/..") && !v.includes("\u0000"),
    {
      message: "targetPath must not contain /../, end with /.., or include NUL",
    },
  );

const AllowedTargetPathSchema = AbsolutePathSchema.refine(
  (v) => v.startsWith("/var/lib/clawdlets/"),
  {
    message: "targetPath must be under /var/lib/clawdlets/",
  },
);

const FileModeSchema = z
  .string()
  .trim()
  .default("0400")
  .refine((v) => /^0[0-7]{3}$/.test(v), { message: "invalid file mode (expected 0400-style octal string)" });

const FileOwnerSchema = z.string().trim().min(1);

export const SECRET_FILE_FORMATS = ["raw", "dotenv", "json", "yaml"] as const;
export const SecretFileFormatSchema = z.enum(SECRET_FILE_FORMATS);
export type SecretFileFormat = z.infer<typeof SecretFileFormatSchema>;

export const SecretFileSpecSchema = z
  .object({
    secretName: SecretNameSchema,
    targetPath: AllowedTargetPathSchema,
    mode: FileModeSchema,
    owner: FileOwnerSchema.optional(),
    group: FileOwnerSchema.optional(),
    format: SecretFileFormatSchema.optional(),
  })
  .strict();

export type SecretFileSpec = z.infer<typeof SecretFileSpecSchema>;

export const SecretFilesSchema = z.record(SecretFileIdSchema, SecretFileSpecSchema).default(() => ({}));
