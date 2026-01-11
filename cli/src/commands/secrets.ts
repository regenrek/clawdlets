import { defineCommand } from "citty";
import { secretsInit } from "./secrets/init.js";
import { secretsMigrate } from "./secrets/migrate.js";
import { secretsPath } from "./secrets/path.js";
import { secretsSync } from "./secrets/sync.js";
import { secretsVerify } from "./secrets/verify.js";

export const secrets = defineCommand({
  meta: {
    name: "secrets",
    description: "Secrets workflow (local template + sync).",
  },
  subCommands: {
    init: secretsInit,
    migrate: secretsMigrate,
    verify: secretsVerify,
    sync: secretsSync,
    path: secretsPath,
  },
});
