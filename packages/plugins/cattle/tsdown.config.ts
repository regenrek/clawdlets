import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/plugin.ts"],
  outDir: "dist",
  format: "esm",
  platform: "node",
  // Bundle internal workspace packages into the plugin build output.
  // Keep external deps (including native modules) external and installed via npm.
  noExternal: [/^@clawdlets\//],
  clean: true,
  // Keep native module external; npm will install it for the user.
  external: ["better-sqlite3"],
  sourcemap: false,
});
