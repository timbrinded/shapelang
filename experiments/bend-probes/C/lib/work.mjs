// Shared paths for the C experiments. Bulky outputs and third-party installs
// live outside the repository, under $CWORK (default: the session scratchpad).
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const CDIR = join(REPO, "experiments/bend-probes/C");
export const WORK =
  process.env.CWORK ??
  "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/work/C";
export const req = createRequire(join(WORK, "package.json"));
