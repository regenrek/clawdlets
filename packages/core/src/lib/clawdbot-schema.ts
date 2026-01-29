import schemaArtifact from "../assets/clawdbot-config.schema.json" with { type: "json" };
import { z } from "zod";

export type ClawdbotSchemaArtifact = {
  schema: Record<string, any>;
  uiHints: Record<string, any>;
  version: string;
  generatedAt: string;
  clawdbotRev: string;
};

const ClawdbotSchemaArtifactObject = z.object({}).catchall(z.any());

export const ClawdbotSchemaArtifactSchema = z.object({
  schema: ClawdbotSchemaArtifactObject,
  uiHints: ClawdbotSchemaArtifactObject,
  version: z.string().min(1),
  generatedAt: z.string().min(1),
  clawdbotRev: z.string().min(1),
});

export function parseClawdbotSchemaArtifact(input: unknown):
  | { ok: true; value: ClawdbotSchemaArtifact }
  | { ok: false; error: string } {
  const parsed = ClawdbotSchemaArtifactSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data as ClawdbotSchemaArtifact };
  return { ok: false, error: "schema payload missing required fields" };
}

let cachedPinnedSchema: ClawdbotSchemaArtifact | null = null;

export function getPinnedClawdbotSchema(): ClawdbotSchemaArtifact {
  if (cachedPinnedSchema) return cachedPinnedSchema;
  const parsed = parseClawdbotSchemaArtifact(schemaArtifact);
  if (!parsed.ok) throw new Error(`invalid pinned clawdbot schema: ${parsed.error}`);
  cachedPinnedSchema = parsed.value;
  return cachedPinnedSchema;
}
