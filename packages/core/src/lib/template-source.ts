export type TemplateSourceInput = {
  repo: string;
  path: string;
  ref: string;
};

export type TemplateSource = {
  repo: string;
  path: string;
  ref: string;
  spec: string;
};

function requireValue(label: string, value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new Error(`${label} missing`);
  return trimmed;
}

export function normalizeTemplateRepo(input: string): string {
  const trimmed = requireValue("template repo", input);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new Error(`template repo must be owner/repo (got: ${trimmed})`);
  }
  return trimmed;
}

export function normalizeTemplatePath(input: string): string {
  const trimmed = requireValue("template path", input).replace(/\\/g, "/");
  if (trimmed.startsWith("/")) throw new Error(`template path must be relative (got: ${trimmed})`);
  const parts = trimmed.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new Error(`template path contains invalid segment (got: ${trimmed})`);
  }
  return trimmed;
}

export function normalizeTemplateRef(input: string): string {
  const trimmed = requireValue("template ref", input);
  // Allow branch names (main, master, feature/x), tags (v1.0.0), or full 40-hex SHA
  if (!/^[A-Za-z0-9_./\-]+$/.test(trimmed)) {
    throw new Error(`template ref must be a valid git ref (branch, tag, or SHA) (got: ${trimmed})`);
  }
  return trimmed;
}

export function normalizeTemplateSource(input: TemplateSourceInput): TemplateSource {
  const repo = normalizeTemplateRepo(input.repo);
  const tplPath = normalizeTemplatePath(input.path);
  const ref = normalizeTemplateRef(input.ref);
  return {
    repo,
    path: tplPath,
    ref,
    spec: `github:${repo}/${tplPath}#${ref}`,
  };
}
