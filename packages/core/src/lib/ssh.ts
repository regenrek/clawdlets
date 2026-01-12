function decodeBase64(value: string): Buffer | null {
  const v = value.trim();
  if (v.length === 0) return null;
  if (v.length > 16384) return null;
  if (!/^[A-Za-z0-9+/]+={0,3}$/.test(v)) return null;

  const buf = Buffer.from(v, "base64");
  if (buf.length < 4) return null;
  return buf;
}

function isSshKeyTypeToken(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9@._+-]*$/.test(value);
}

export function looksLikeSshPrivateKey(text: string): boolean {
  const s = text.trimStart();
  if (!s.startsWith("-----BEGIN ")) return false;
  return (
    s.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----") ||
    s.startsWith("-----BEGIN RSA PRIVATE KEY-----") ||
    s.startsWith("-----BEGIN PRIVATE KEY-----")
  );
}

export function parseSshPublicKeyLine(line: string): { type: string; base64: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;
  if (looksLikeSshPrivateKey(trimmed)) return null;

  const tokens = trimmed.split(/\s+/);
  for (let i = 0; i < tokens.length - 1; i++) {
    const type = tokens[i] ?? "";
    const base64 = tokens[i + 1] ?? "";
    if (!isSshKeyTypeToken(type)) continue;

    const buf = decodeBase64(base64);
    if (!buf) continue;

    const typeLen = buf.readUInt32BE(0);
    if (typeLen === 0 || typeLen > 1024) continue;
    if (4 + typeLen > buf.length) continue;
    const blobType = buf.subarray(4, 4 + typeLen).toString("utf8");
    if (blobType !== type) continue;

    return { type, base64 };
  }

  return null;
}

export function normalizeSshPublicKey(text: string): string | null {
  if (looksLikeSshPrivateKey(text)) return null;
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseSshPublicKeyLine(line);
    if (parsed) return `${parsed.type} ${parsed.base64}`;
  }
  return null;
}

export function looksLikeSshKeyContents(value: string): boolean {
  return normalizeSshPublicKey(value) !== null;
}

export function parseSshPublicKeysFromText(text: string): string[] {
  if (looksLikeSshPrivateKey(text)) {
    throw new Error("ssh private key detected (expected public key)");
  }
  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseSshPublicKeyLine(line);
    if (parsed) keys.push(`${parsed.type} ${parsed.base64}`);
  }
  return keys;
}
