import { SecretNameSchema } from "./identifiers.js";
import { assertSafeRecordKey, createNullProtoRecord } from "./safe-record.js";

export type SecretsInitJson = {
  adminPasswordHash: string;
  tailscaleAuthKey?: string;
  secrets: Record<string, string>;
};

function getCliFlagValue(argv: string[], flagNames: string[]): string | undefined {
  let found: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";

    for (const flag of flagNames) {
      if (a === flag) {
        found = argv[i + 1];
        break;
      }

      const prefix = `${flag}=`;
      if (a.startsWith(prefix)) {
        found = a.slice(prefix.length);
        break;
      }
    }
  }

  return found;
}

export function resolveSecretsInitFromJsonArg(params: {
  fromJsonRaw: unknown;
  argv: string[];
  stdinIsTTY: boolean;
}): string | undefined {
  const raw = params.fromJsonRaw;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith("-") && trimmed !== "-") {
      throw new Error("missing --from-json value (use --from-json <path|->, --from-json=<path|->)");
    }
    if (trimmed === "-" && params.stdinIsTTY) {
      throw new Error("refusing to read --from-json - from a TTY (pipe JSON or pass --from-json <file>)");
    }
    return trimmed;
  }

  if (raw === undefined || raw === null || raw === false) return undefined;

  if (raw !== true) throw new Error("invalid --from-json value");

  const cliValue = getCliFlagValue(params.argv, ["--from-json", "--fromJson"]);
  const trimmed = String(cliValue || "").trim();
  if (!trimmed || (trimmed.startsWith("-") && trimmed !== "-")) {
    throw new Error("missing --from-json value (use --from-json <path|->, --from-json=<path|->)");
  }

  if (trimmed === "-" && params.stdinIsTTY) {
    throw new Error("refusing to read --from-json - from a TTY (pipe JSON or pass --from-json <file>)");
  }

  return trimmed;
}

export function isPlaceholderSecretValue(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  if (s === "<OPTIONAL>") return false;
  return /^<[^>]+>$/.test(s);
}

export function listSecretsInitPlaceholders(params: {
  input: SecretsInitJson;
  requiresTailscaleAuthKey: boolean;
}): string[] {
  const out = new Set<string>();

  if (isPlaceholderSecretValue(params.input.adminPasswordHash)) out.add("adminPasswordHash");

  if (params.requiresTailscaleAuthKey && params.input.tailscaleAuthKey && isPlaceholderSecretValue(params.input.tailscaleAuthKey)) {
    out.add("tailscaleAuthKey");
  }

  for (const [k, v] of Object.entries(params.input.secrets || {})) {
    if (typeof v !== "string") continue;
    if (v && isPlaceholderSecretValue(v)) out.add(`secrets.${k}`);
  }

  return Array.from(out).sort();
}

export function buildSecretsInitTemplate(params: {
  requiresTailscaleAuthKey: boolean;
  secrets?: Record<string, string>;
}): SecretsInitJson {
  const secrets = params.secrets && typeof params.secrets === "object" ? params.secrets : {};
  return {
    adminPasswordHash: "<REPLACE_WITH_YESCRYPT_HASH>",
    ...(params.requiresTailscaleAuthKey ? { tailscaleAuthKey: "<REPLACE_WITH_TSKEY_AUTH>" } : {}),
    secrets,
  };
}

export function parseSecretsInitJson(raw: string): SecretsInitJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid --from-json (expected valid JSON)");
  }

  if (!parsed || typeof parsed !== "object") throw new Error("invalid --from-json (expected JSON object)");

  const obj = parsed as any;

  const adminPasswordHash = typeof obj.adminPasswordHash === "string" ? obj.adminPasswordHash.trim() : "";
  if (!adminPasswordHash) throw new Error("invalid --from-json (missing adminPasswordHash)");

  const tailscaleAuthKey = typeof obj.tailscaleAuthKey === "string" ? obj.tailscaleAuthKey.trim() : undefined;

  if (!obj.secrets || typeof obj.secrets !== "object" || Array.isArray(obj.secrets)) {
    throw new Error("invalid --from-json (missing secrets object)");
  }
  const secrets = createNullProtoRecord<string>();
  for (const [k, v] of Object.entries(obj.secrets)) {
    if (typeof v !== "string") continue;
    const token = v.trim();
    if (!token) continue;
    const key = String(k || "").trim();
    if (!key) continue;
    assertSafeRecordKey({ key, context: "secrets init json secrets" });
    void SecretNameSchema.parse(key);
    secrets[key] = token;
  }

  return { adminPasswordHash, tailscaleAuthKey, secrets };
}

export function validateSecretsInitNonInteractive(params: {
  interactive: boolean;
  fromJson: string | undefined;
  yes: boolean;
  dryRun: boolean;
  localSecretsDirExists: boolean;
}): void {
  if (params.interactive) return;

  if (!params.fromJson) throw new Error("non-interactive secrets init requires --from-json <path|->");

  if (params.localSecretsDirExists && !params.yes && !params.dryRun) {
    throw new Error("refusing to overwrite existing secrets without --yes (or pass --dry-run)");
  }
}
