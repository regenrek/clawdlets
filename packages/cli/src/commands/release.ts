import { defineCommand } from "citty";
import { releaseManifest } from "./release/manifest.js";
import { releasePointer } from "./release/pointer.js";

export const release = defineCommand({
  meta: {
    name: "release",
    description: "Signed desired-state release tooling (manifests, pointers, signing).",
  },
  subCommands: {
    manifest: releaseManifest,
    pointer: releasePointer,
  },
});

