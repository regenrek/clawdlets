const ENV_VAR_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findEnvVarRefsInString(value: string): string[] {
  if (!value.includes("$")) return [];

  const out = new Set<string>();

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char !== "$") continue;

    const next = value[i + 1];
    const afterNext = value[i + 2];

    // Escaped: $${VAR} -> literal ${VAR}
    if (next === "$" && afterNext === "{") {
      const start = i + 3;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const name = value.slice(start, end);
        if (ENV_VAR_NAME_RE.test(name)) {
          i = end;
          continue;
        }
      }
    }

    // Substitution: ${VAR}
    if (next === "{") {
      const start = i + 2;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const name = value.slice(start, end);
        if (ENV_VAR_NAME_RE.test(name)) {
          out.add(name);
          i = end;
          continue;
        }
      }
    }
  }

  return Array.from(out);
}

function findEnvVarRefsInAny(params: {
  value: unknown;
  path: string;
  pathsByVar: Record<string, string[]>;
}): void {
  const path = params.path;
  const value = params.value;

  if (typeof value === "string") {
    const names = findEnvVarRefsInString(value);
    for (const name of names) {
      params.pathsByVar[name] = params.pathsByVar[name] || [];
      params.pathsByVar[name]!.push(path || "(root)");
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const childPath = path ? `${path}[${i}]` : `[${i}]`;
      findEnvVarRefsInAny({ value: value[i], path: childPath, pathsByVar: params.pathsByVar });
    }
    return;
  }

  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const key = String(k);
      const childPath = path ? `${path}.${key}` : key;
      findEnvVarRefsInAny({ value: v, path: childPath, pathsByVar: params.pathsByVar });
    }
  }
}

export type EnvVarRefs = {
  vars: string[];
  pathsByVar: Record<string, string[]>;
};

export function findEnvVarRefs(obj: unknown): EnvVarRefs {
  const pathsByVar: Record<string, string[]> = {};
  findEnvVarRefsInAny({ value: obj, path: "", pathsByVar });

  const vars = Object.keys(pathsByVar).sort();
  for (const v of vars) {
    pathsByVar[v] = Array.from(new Set(pathsByVar[v] || [])).sort();
  }

  return { vars, pathsByVar };
}

