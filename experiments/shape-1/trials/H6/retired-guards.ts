// @ts-nocheck
// H6: RefactorSensitive guards the dogfood overlay retired, comparing the migrated 0.x model
// (`shp migrate` of shape/*.shape, no overlay) with experiments/shape-1/dogfood/model.source.json.
//   bun experiments/shape-1/trials/H6/retired-guards.ts
import { join } from "node:path";
import { REPO, readModel } from "../../dogfood/tools/lib.ts";
import { loadModel } from "../../proto/src/loader.ts";

const guarded = (src) => {
  const out = new Set();
  for (const m of src.modules) for (const d of m.decls) if (d.decl === "component") for (const u of d.units ?? []) if ((u.attach ?? []).some((a) => /RefactorSensitive/.test(a.name))) out.add(`${m.module}::${d.name}.${u.name}`);
  return out;
};
const mig = guarded(loadModel(join(REPO), { maintainers: [] }).source);
const dog = guarded(readModel());
process.stdout.write(`${JSON.stringify({ migrated: mig.size, dogfood: dog.size, retired: [...mig].filter((x) => !dog.has(x)).sort(), added: [...dog].filter((x) => !mig.has(x)).sort() }, null, 1)}\n`);
