import type { ClawdbotSchemaArtifact } from "./clawdbot-schema.js";

export type SchemaDiff = {
  added: string[];
  removed: string[];
  changed: Array<{ path: string; oldType: string; newType: string }>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function describeType(node: Record<string, unknown>): string {
  const typeValue = node.type;
  if (Array.isArray(typeValue)) return typeValue.map(String).join("|");
  if (typeof typeValue === "string") return typeValue;
  if (node.const !== undefined) return "const";
  if (Array.isArray(node.enum)) return "enum";
  if (Array.isArray(node.oneOf)) return "oneOf";
  if (Array.isArray(node.anyOf)) return "anyOf";
  if (Array.isArray(node.allOf)) return "allOf";
  if (isPlainObject(node.properties)) return "object";
  if (node.items !== undefined) return "array";
  return "unknown";
}

function readChannelSchemaMap(schema: Record<string, any>): Record<string, unknown> {
  const channels = schema?.properties?.channels;
  if (!isPlainObject(channels)) return {};
  const props = (channels as Record<string, any>).properties;
  if (!isPlainObject(props)) return {};
  return props as Record<string, unknown>;
}

function collectSchemaPaths(node: unknown, basePath: string, out: Map<string, string>): void {
  if (!isPlainObject(node)) return;
  out.set(basePath, describeType(node));
  const props = node.properties;
  if (isPlainObject(props)) {
    for (const [key, child] of Object.entries(props)) {
      const nextPath = basePath ? `${basePath}.${key}` : key;
      collectSchemaPaths(child, nextPath, out);
    }
  }
  const items = node.items;
  if (items !== undefined) {
    const nextPath = `${basePath}[]`;
    collectSchemaPaths(items, nextPath, out);
  }
}

function collectChannelPaths(schema: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  const channelSchemas = readChannelSchemaMap(schema);
  for (const [id, entry] of Object.entries(channelSchemas)) {
    collectSchemaPaths(entry, `channels.${id}`, out);
  }
  return out;
}

export function diffChannelSchemas(
  pinnedSchema: Record<string, unknown>,
  liveSchema: Record<string, unknown>,
): SchemaDiff {
  const pinned = collectChannelPaths(pinnedSchema);
  const live = collectChannelPaths(liveSchema);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: Array<{ path: string; oldType: string; newType: string }> = [];

  for (const [path, type] of live.entries()) {
    if (!pinned.has(path)) {
      added.push(path);
      continue;
    }
    const prevType = pinned.get(path) ?? "unknown";
    if (prevType !== type) changed.push({ path, oldType: prevType, newType: type });
  }

  for (const path of pinned.keys()) {
    if (!live.has(path)) removed.push(path);
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function diffChannelSchemasFromArtifacts(
  pinned: ClawdbotSchemaArtifact,
  live: ClawdbotSchemaArtifact,
): SchemaDiff {
  return diffChannelSchemas(pinned.schema as Record<string, unknown>, live.schema as Record<string, unknown>);
}
