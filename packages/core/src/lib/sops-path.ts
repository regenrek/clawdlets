import path from "node:path";

function normalizeRelPath(rel: string): string {
  const normalized = rel.replace(/\\/g, "/").trim();
  const noLeadingDots = normalized.replace(/^(\.\/)+/, "");
  const noLeadingSlashes = noLeadingDots.replace(/^\/+/, "");
  return noLeadingSlashes;
}

export function relativePathForSopsRule(params: { fromDir: string; toPath: string; label: string }): string {
  const fromDir = String(params.fromDir || "").trim();
  const toPath = String(params.toPath || "").trim();
  const label = String(params.label || "").trim() || "path";

  if (!fromDir) throw new Error(`missing fromDir for ${label}`);
  if (!toPath) throw new Error(`missing toPath for ${label}`);

  const rawRel = path.relative(fromDir, toPath);
  const rel = normalizeRelPath(rawRel);

  const fail = (reason: string) => {
    throw new Error(
      [
        `invalid relative path for sops rule (${label}): ${reason}`,
        `fromDir=${fromDir}`,
        `toPath=${toPath}`,
        `relative=${JSON.stringify(rawRel)}`,
        "expected: target under fromDir (non-empty, not '.', no '..' segments)",
      ].join("; "),
    );
  };

  if (!rel || rel === ".") fail("empty/'.' relative path");
  if (rel === ".." || rel.startsWith("../")) fail("path escapes fromDir (starts with '..')");
  if (rel.includes("\\")) fail("contains backslashes after normalization");
  if (/^[A-Za-z]:/.test(rel)) fail("looks like an absolute Windows path");

  const parts = rel.split("/").filter(Boolean);
  if (parts.length === 0) fail("no path segments");
  if (parts.some((p) => p === "." || p === "..")) fail("contains '.' or '..' segments");

  return parts.join("/");
}

