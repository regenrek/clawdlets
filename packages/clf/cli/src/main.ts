#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { jobs } from "./commands/jobs.js";

const main = defineCommand({
  meta: {
    name: "clf",
    description: "ClawdletFleet (bot-facing control plane CLI).",
  },
  subCommands: {
    jobs,
  },
});

{
  const [nodeBin, script, ...rest] = process.argv;
  process.argv = [nodeBin!, script!, ...rest.filter((a) => a !== "--")];
}

runMain(main);

