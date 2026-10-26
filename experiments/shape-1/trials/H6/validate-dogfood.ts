// @ts-nocheck
// H6: differential check of the teeth closed form against derive on the dogfood model (W_decl):
// n evenly spaced mutants per operator (W1, W2, P1) realised as audit-mode inputs
// (proto/providers/teeth/validate.ts).
//   bun experiments/shape-1/trials/H6/validate-dogfood.ts --work <dir> [--per 100]
// Needs <work>/manifest.json from teeth-dogfood.ts. Writes <work>/validate.json.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readModel } from "../../dogfood/tools/lib.ts";
import { elaborateAt, manifestFor } from "../../proto/providers/common.ts";
import { validateTeeth } from "../../proto/providers/teeth/validate.ts";
import { buildWorld } from "../../proto/src/world.ts";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const WORK = resolve(opt("work", "h6-work"));
const PER = Number(opt("per", "100"));
const NOW = "2026-10-26T00:00:00Z";
const man = await manifestFor({ manifest: join(WORK, "manifest.json") });
const source = readModel();
const esf = elaborateAt(source, NOW);
const world = buildWorld(esf, man.index, { side: "h" });
const res = validateTeeth({ source, esf, world, manifest: man.statement, revision: man.revision, now: NOW, perOp: PER });
writeFileSync(join(WORK, "validate.json"), JSON.stringify(res, null, 1));
process.stderr.write(`validate: ${res.agree}/${res.sampled} agree; ${JSON.stringify(res.byOp)}; ${(res.ms / 1000).toFixed(0)} s\n`);
