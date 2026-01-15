import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.join(here, ".template");

if (!process.env.CLAWDLETS_TEMPLATE_DIR) {
  process.env.CLAWDLETS_TEMPLATE_DIR = templateRoot;
}
