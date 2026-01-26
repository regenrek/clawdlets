import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  outDir: "dist",
  format: "esm",
  platform: "node",
  // Bundle internal workspace packages into the CLI build output.
  // External deps stay external and are installed via npm.
  noExternal: [/^@clawdlets\//],
  clean: true,
  sourcemap: false,
});
