import process from "node:process";
import { capture } from "@clawdlets/core/lib/run";
import { withFlakesEnv } from "@clawdlets/core/lib/nix-flakes";

export function requireToplevel(value: string): string {
  const v = value.trim();
  if (!v) throw new Error("missing toplevel store path");
  if (/\s/.test(v)) throw new Error(`invalid toplevel (contains whitespace): ${v}`);
  if (!v.startsWith("/nix/store/")) throw new Error(`invalid toplevel (expected /nix/store/...): ${v}`);
  return v;
}

export async function buildHostSystemToplevelFromPackage(params: {
  repoRoot: string;
  nixBin: string;
  system: string;
  host: string;
}): Promise<string> {
  const attr = `.#packages.${params.system}.${params.host}-system`;
  const out = await capture(params.nixBin, ["build", "--json", "--no-link", attr], {
    cwd: params.repoRoot,
    env: withFlakesEnv(process.env),
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    throw new Error(`nix build --json returned invalid JSON (${String((e as Error)?.message || e)})`);
  }
  const toplevel = (parsed as any)?.[0]?.outputs?.out;
  if (!toplevel || typeof toplevel !== "string") {
    throw new Error("nix build did not return a toplevel store path");
  }
  return requireToplevel(toplevel);
}
