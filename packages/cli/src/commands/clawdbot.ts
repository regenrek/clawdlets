import { defineCommand } from "citty";
import { clawdbotSchema } from "./clawdbot/schema.js";
import { clawdbotHarden } from "./clawdbot/harden.js";

export const clawdbot = defineCommand({
  meta: { name: "clawdbot", description: "Clawdbot gateway helpers." },
  subCommands: {
    harden: clawdbotHarden,
    schema: clawdbotSchema,
  },
});
