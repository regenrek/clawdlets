import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  outDir: "dist",
  format: "esm",
  platform: "node",
  clean: true,
  skipNodeModulesBundle: true,
});
