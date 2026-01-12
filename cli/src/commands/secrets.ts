import { defineCommand } from "citty";
import { secretsInit } from "./secrets/init.js";
import { secretsPath } from "./secrets/path.js";
import { secretsSync } from "./secrets/sync.js";
import { secretsVerify } from "./secrets/verify.js";

export const secrets = defineCommand({
  meta: {
    name: "secrets",
    description: "Secrets workflow (/secrets + extra-files + sync).",
  },
  subCommands: {
    init: secretsInit,
    verify: secretsVerify,
    sync: secretsSync,
    path: secretsPath,
  },
});
