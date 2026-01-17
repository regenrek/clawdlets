import { defineCommand } from "citty";
import { cattleDestroy } from "./cattle/destroy.js";
import { cattleList } from "./cattle/list.js";
import { cattleLogs } from "./cattle/logs.js";
import { cattleReap } from "./cattle/reap.js";
import { cattleSpawn } from "./cattle/spawn.js";
import { cattleSsh } from "./cattle/ssh.js";

export const cattle = defineCommand({
  meta: { name: "cattle", description: "Cattle (ephemeral agents on Hetzner Cloud)." },
  subCommands: {
    spawn: cattleSpawn,
    list: cattleList,
    destroy: cattleDestroy,
    reap: cattleReap,
    logs: cattleLogs,
    ssh: cattleSsh,
  },
});
