import { bot } from "./bot.js";
import { bootstrap } from "./bootstrap.js";
import { clawdbot } from "./clawdbot.js";
import { config } from "./config.js";
import { doctor } from "./doctor.js";
import { env } from "./env.js";
import { host } from "./host.js";
import { fleet } from "./fleet.js";
import { image } from "./image.js";
import { infra } from "./infra.js";
import { lockdown } from "./lockdown.js";
import { plugin } from "./plugin.js";
import { project } from "./project.js";
import { secrets } from "./secrets.js";
import { server } from "./server.js";

export const baseCommands = {
  bot,
  bootstrap,
  clawdbot,
  config,
  doctor,
  env,
  host,
  fleet,
  image,
  infra,
  lockdown,
  plugin,
  project,
  secrets,
  server,
};

export const baseCommandNames = Object.freeze(Object.keys(baseCommands));
