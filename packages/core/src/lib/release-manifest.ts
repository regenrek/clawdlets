import fs from "node:fs";
import { z } from "zod";
import { HostNameSchema } from "@clawdlets/shared/lib/identifiers";

const SYSTEM_RE = /^[a-z0-9_]+-[a-z0-9_]+$/;
const CHANNEL_RE = /^[a-z][a-z0-9-]*$/;
const REV_RE = /^[0-9a-f]{40}$/;
const STORE_PATH_RE = /^\/nix\/store\/[^\s]+$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const SECRETS_FORMATS = ["sops-tar"] as const;

export const RELEASE_MANIFEST_SCHEMA_VERSION = 1 as const;

const SystemSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SYSTEM_RE.test(v), { message: "invalid system (expected nix system like x86_64-linux)" });

const ChannelSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => CHANNEL_RE.test(v), { message: "invalid channel (use [a-z][a-z0-9-]*)" });

const ReleaseIdSchema = z.number().int().positive();

const IssuedAtSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => !/\s/.test(v), { message: "invalid issuedAt (must not include whitespace)" });

const SemverSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v), { message: "invalid semver" });

const RequiredFeatureSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => /^[a-z0-9][a-z0-9-]*$/.test(v), { message: "invalid required feature (use [a-z0-9-])" });

const RevSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => REV_RE.test(v), { message: "invalid rev (expected 40-char lowercase sha)" });

const ToplevelSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => STORE_PATH_RE.test(v), { message: "invalid toplevel (expected /nix/store/... with no whitespace)" });

const Sha256HexSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SHA256_HEX_RE.test(v), { message: "invalid sha256 hex (expected 64 lowercase hex chars)" });

const CacheSubstituterSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => !/\s/.test(v), { message: "invalid substituter (must not include whitespace)" });

const TrustedPublicKeySchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => !/\s/.test(v), { message: "invalid trusted public key (must not include whitespace)" });

export const ReleasePointerV1Schema = z.object({
  releaseId: ReleaseIdSchema,
  file: z.string().trim().min(1).optional(),
});

export type ReleasePointerV1 = z.infer<typeof ReleasePointerV1Schema>;

export const ReleaseManifestV1Schema = z
  .object({
    schemaVersion: z.literal(RELEASE_MANIFEST_SCHEMA_VERSION),
    host: HostNameSchema,
    system: SystemSchema,
    channel: ChannelSchema,
    releaseId: ReleaseIdSchema,
    issuedAt: IssuedAtSchema,
    minUpdaterVersion: SemverSchema.optional(),
    requiredFeatures: z.array(RequiredFeatureSchema).min(1).optional(),
    rev: RevSchema,
    toplevel: ToplevelSchema,
    secrets: z
      .object({
        digest: Sha256HexSchema,
        format: z.enum(SECRETS_FORMATS).optional(),
        url: z.string().trim().min(1).optional(),
      })
      .superRefine((v, ctx) => {
        if (v.url && !v.format) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["format"],
            message: "secrets.format is required when secrets.url is set",
          });
        }
        if (v.format && !v.url) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["url"],
            message: "secrets.url is required when secrets.format is set",
          });
        }
      }),
    cache: z
      .object({
        substituters: z.array(CacheSubstituterSchema).default([]),
        trustedPublicKeys: z.array(TrustedPublicKeySchema).default([]),
        narinfoCachePositiveTtl: z.number().int().positive().optional(),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.minUpdaterVersion && v.requiredFeatures) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minUpdaterVersion"],
        message: "use either minUpdaterVersion or requiredFeatures (not both)",
      });
    }
  });

export type ReleaseManifestV1 = z.infer<typeof ReleaseManifestV1Schema>;
export type ReleaseManifest = ReleaseManifestV1;

function parseJsonOrThrow(params: { text: string; sourceLabel: string }): unknown {
  try {
    return JSON.parse(params.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`invalid JSON (${params.sourceLabel}): ${msg}`);
  }
}

export function parseReleaseManifestJson(text: string): ReleaseManifest {
  const parsed = parseJsonOrThrow({ text, sourceLabel: "release manifest" });
  return ReleaseManifestV1Schema.parse(parsed);
}

export function parseReleaseManifestFile(path: string): ReleaseManifest {
  const text = fs.readFileSync(path, "utf8");
  return parseReleaseManifestJson(text);
}

export function parseReleasePointerJson(text: string): ReleasePointerV1 {
  const parsed = parseJsonOrThrow({ text, sourceLabel: "release pointer" });
  return ReleasePointerV1Schema.parse(parsed);
}

export function parseReleasePointerFile(path: string): ReleasePointerV1 {
  const text = fs.readFileSync(path, "utf8");
  return parseReleasePointerJson(text);
}

function toCanonicalReleasePointer(pointer: ReleasePointerV1): ReleasePointerV1 {
  const out: ReleasePointerV1 = { releaseId: pointer.releaseId };
  if (pointer.file) out.file = pointer.file;
  return out;
}

function toCanonicalReleaseManifest(manifest: ReleaseManifest): ReleaseManifest {
  const out = {} as ReleaseManifest;
  out.schemaVersion = RELEASE_MANIFEST_SCHEMA_VERSION;
  out.host = manifest.host;
  out.system = manifest.system;
  out.channel = manifest.channel;
  out.releaseId = manifest.releaseId;
  out.issuedAt = manifest.issuedAt;
  if (manifest.minUpdaterVersion) out.minUpdaterVersion = manifest.minUpdaterVersion;
  if (manifest.requiredFeatures) out.requiredFeatures = manifest.requiredFeatures;
  out.rev = manifest.rev;
  out.toplevel = manifest.toplevel;
  out.secrets = {
    digest: manifest.secrets.digest,
    ...(manifest.secrets.format ? { format: manifest.secrets.format } : {}),
    ...(manifest.secrets.url ? { url: manifest.secrets.url } : {}),
  };
  if (manifest.cache) {
    out.cache = {
      substituters: manifest.cache.substituters,
      trustedPublicKeys: manifest.cache.trustedPublicKeys,
      ...(manifest.cache.narinfoCachePositiveTtl ? { narinfoCachePositiveTtl: manifest.cache.narinfoCachePositiveTtl } : {}),
    };
  }
  return out;
}

export function formatReleasePointer(pointer: ReleasePointerV1): string {
  const canonical = toCanonicalReleasePointer(ReleasePointerV1Schema.parse(pointer));
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

export function formatReleaseManifest(manifest: ReleaseManifest): string {
  const canonical = toCanonicalReleaseManifest(ReleaseManifestV1Schema.parse(manifest));
  return `${JSON.stringify(canonical, null, 2)}\n`;
}
