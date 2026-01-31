import { getPinnedClawdbotSchema } from "./clawdbot-schema.js";

export type ChannelInfo = {
  id: string;
  name: string;
  category?: "core" | "plugin";
  docsUrl?: string;
  summary?: string;
  schema?: unknown;
};

type UiHints = Record<string, { label?: string; help?: string; category?: string; docsUrl?: string }>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function titleCase(value: string): string {
  return value
    .split(/[_-]/g)
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function readChannelSchemaMap(schema: Record<string, any>): Record<string, unknown> {
  const channels = schema?.properties?.channels;
  if (!isPlainObject(channels)) return {};
  const props = (channels as Record<string, any>).properties;
  if (!isPlainObject(props)) return {};
  return props as Record<string, unknown>;
}

function readUiHints(): UiHints {
  const schema = getPinnedClawdbotSchema();
  return (schema.uiHints ?? {}) as UiHints;
}

function readHint(hints: UiHints, path: string): UiHints[string] | null {
  const hint = hints[path];
  if (!hint || typeof hint !== "object") return null;
  return hint;
}

export function listPinnedChannels(): ChannelInfo[] {
  const schema = getPinnedClawdbotSchema();
  const channelSchemas = readChannelSchemaMap(schema.schema ?? {});
  const hints = readUiHints();
  return Object.keys(channelSchemas)
    .sort()
    .map((id) => {
      const hint = readHint(hints, `channels.${id}`);
      const schemaEntry = channelSchemas[id];
      const name =
        String(hint?.label || "")
          .trim() ||
        (isPlainObject(schemaEntry) && typeof (schemaEntry as any).title === "string"
          ? String((schemaEntry as any).title).trim()
          : "") ||
        titleCase(id);
      const summary = String(hint?.help || "").trim() || undefined;
      const category =
        hint?.category === "core" || hint?.category === "plugin" ? hint.category : undefined;
      const docsUrl = typeof hint?.docsUrl === "string" ? hint.docsUrl.trim() || undefined : undefined;
      return {
        id,
        name,
        category,
        docsUrl,
        summary,
        schema: schemaEntry,
      } satisfies ChannelInfo;
    });
}
