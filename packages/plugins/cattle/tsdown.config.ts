import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/plugin.ts"],
  outDir: "dist",
  format: "esm",
  platform: "node",
  clean: true,
  skipNodeModulesBundle: true,
  sourcemap: false,
});
