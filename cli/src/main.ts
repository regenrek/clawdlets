import { defineCommand, runMain } from "citty";
import { bot } from "./commands/bot.js";
import { bootstrap } from "./commands/bootstrap.js";
import { config } from "./commands/config.js";
import { doctor } from "./commands/doctor.js";
import { host } from "./commands/host.js";
import { fleet } from "./commands/fleet.js";
import { infra } from "./commands/infra.js";
import { lockdown } from "./commands/lockdown.js";
import { project } from "./commands/project.js";
import { secrets } from "./commands/secrets.js";
import { server } from "./commands/server.js";
import { stack } from "./commands/stack.js";

const main = defineCommand({
  meta: {
    name: "clawdlets",
    description: "Clawdbot fleet helper (CLI-first; instance state in .clawdlets/).",
  },
  subCommands: {
    bot,
    bootstrap,
    config,
    doctor,
    host,
    fleet,
    infra,
    lockdown,
    project,
    secrets,
    server,
    stack,
  },
});

{
  const [nodeBin, script, ...rest] = process.argv;
  process.argv = [nodeBin!, script!, ...rest.filter((a) => a !== "--")];
}

runMain(main);
