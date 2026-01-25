import { z } from "zod";

export const HCLOUD_LABEL_VALUE_MAX_LEN = 63;

function isAsciiAlphaNum(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
}

function collapseDashes(value: string): string {
  let out = "";
  let prevDash = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "-") {
      if (!prevDash) {
        out += "-";
        prevDash = true;
      }
      continue;
    }
    out += ch;
    prevDash = false;
  }
  return out;
}

function trimDashes(value: string): string {
  let start = 0;
  while (start < value.length && value[start] === "-") start++;
  let end = value.length;
  while (end > start && value[end - 1] === "-") end--;
  return value.slice(start, end);
}

export function isValidHcloudLabelValue(value: string): boolean {
  const v = String(value ?? "");
  if (v.length === 0) return true;
  if (v.length > HCLOUD_LABEL_VALUE_MAX_LEN) return false;
  if (!isAsciiAlphaNum(v[0] || "")) return false;
  if (!isAsciiAlphaNum(v[v.length - 1] || "")) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v[i]!;
    if (isAsciiAlphaNum(c)) continue;
    if (c === "-" || c === "_" || c === ".") continue;
    return false;
  }
  return true;
}

export function isValidHcloudLabelKey(key: string): boolean {
  const k = String(key ?? "");
  if (!k) return false;
  if (k.length > HCLOUD_LABEL_VALUE_MAX_LEN) return false;
  if (!isAsciiAlphaNum(k[0] || "")) return false;
  if (!isAsciiAlphaNum(k[k.length - 1] || "")) return false;
  for (let i = 0; i < k.length; i++) {
    const c = k[i]!;
    if (isAsciiAlphaNum(c)) continue;
    if (c === "-" || c === "_" || c === "." || c === "/") continue;
    return false;
  }
  return true;
}

export function toHcloudLabelValueSlug(input: string, opts: { fallback: string }): string {
  const raw = String(input ?? "").trim();
  const fallback = String(opts.fallback ?? "").trim() || "x";

  const out: string[] = [];
  for (const ch of raw) {
    if (isAsciiAlphaNum(ch)) out.push(ch.toLowerCase());
    else if (ch === "-" || ch === "_" || ch === "." || ch === " ") out.push("-");
  }

  let s = trimDashes(collapseDashes(out.join("")));
  if (!s) s = fallback;
  if (s.length > HCLOUD_LABEL_VALUE_MAX_LEN) s = s.slice(0, HCLOUD_LABEL_VALUE_MAX_LEN);
  s = trimDashes(s);
  if (!s) s = fallback;
  if (!isValidHcloudLabelValue(s)) return fallback;
  return s;
}

export const HcloudLabelsSchema = z.record(z.string().min(1), z.string());

export function validateHcloudLabelsAtPath(params: { value: unknown; ctx: z.RefinementCtx; path: (string | number)[] }): void {
  if (params.value == null) return;
  if (typeof params.value !== "object" || Array.isArray(params.value)) {
    params.ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: params.path,
      message: "labels must be an object mapping labelKey -> labelValue",
    });
    return;
  }

  for (const [rawK, rawV] of Object.entries(params.value as Record<string, unknown>)) {
    const k = String(rawK ?? "").trim();
    const v = rawV == null ? "" : String(rawV);

    if (!isValidHcloudLabelKey(k)) {
      params.ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...params.path, rawK],
        message: `invalid label key: ${k} (expected <=${HCLOUD_LABEL_VALUE_MAX_LEN} chars, alnum/._-, start+end alnum)`,
      });
    }

    if (!isValidHcloudLabelValue(v)) {
      params.ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...params.path, rawK],
        message: `invalid label value for ${k} (expected <=${HCLOUD_LABEL_VALUE_MAX_LEN} chars, alnum/._-, start+end alnum; empty ok)`,
      });
    }
  }
}
