import { isValidHcloudLabelValue, toHcloudLabelValueSlug } from "./hcloud-labels.js";

export function safeCattleLabelValue(raw: string, fallback: string): string {
  const v = String(raw ?? "").trim();
  if (isValidHcloudLabelValue(v)) return v;
  return toHcloudLabelValueSlug(v, { fallback });
}

export function buildCattleServerName(identity: string, unixSeconds: number): string {
  const ts = Math.max(0, Math.floor(unixSeconds));
  const slug = toHcloudLabelValueSlug(identity, { fallback: "id" });
  const prefix = "cattle-";
  const suffix = `-${ts}`;
  const maxSlug = 63 - prefix.length - suffix.length;
  const slugTrimmed = (maxSlug > 0 ? slug.slice(0, maxSlug) : slug).replace(/-+$/, "") || "id";
  return `${prefix}${slugTrimmed}${suffix}`;
}

