import { defineCommand } from "citty";
import { clawdbotSchema } from "./clawdbot/schema.js";

export const clawdbot = defineCommand({
  meta: { name: "clawdbot", description: "Clawdbot gateway helpers." },
  subCommands: {
    schema: clawdbotSchema,
  },
});
