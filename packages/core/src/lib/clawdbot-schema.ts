import schemaArtifact from "../assets/clawdbot-config.schema.json" with { type: "json" };

export type ClawdbotSchemaArtifact = {
  schema: Record<string, any>;
  uiHints: Record<string, any>;
  version: string;
  generatedAt: string;
  clawdbotRev: string;
};

export function getPinnedClawdbotSchema(): ClawdbotSchemaArtifact {
  return schemaArtifact as ClawdbotSchemaArtifact;
}
