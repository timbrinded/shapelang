// @ts-nocheck
// H6: E10's control row on the 1.0 dogfood model. Every non-std resource gains `: std::AppendOnly`
// (forbid HardDelete<R>, tier final); the teeth closed form is rerun over W_decl. E10's control
// rejected 79/79 destructive-effect-plus-grant probes once AppendOnly was attached.
//   bun experiments/shape-1/trials/H6/p1-control.ts --work <dir>   (needs <work>/manifest.json)
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readModel } from "../../dogfood/tools/lib.ts";
import { manifestFor } from "../../proto/providers/common.ts";
import { runTeeth } from "../../proto/providers/teeth/provider.ts";

const argv = process.argv.slice(2);
const i = argv.indexOf("--work");
const WORK = resolve(i >= 0 ? argv[i + 1] : "h6-work");
const man = await manifestFor({ manifest: join(WORK, "manifest.json") });
const src = readModel();
let n = 0;
for (const m of src.modules)
  for (const d of m.decls)
    if (d.decl === "resource") {
      d.attach = [...(d.attach ?? []), { name: "std::AppendOnly" }];
      n += 1;
    }
const run = runTeeth({ source: src, man, records: [], time: "2026-10-26T00:00:00Z" });
const r = run.report;
const out = {
  resourcesAttached: n,
  errors: run.errors.slice(0, 10),
  operators: r.operators,
  P1: {
    resources: r.gaps.P1.resources,
    uncaught: r.gaps.P1.uncaught.length,
    caught: r.gaps.P1.caught.length
  },
  vacuous: r.vacuous,
  redundant: r.redundant.length
};
writeFileSync(join(WORK, "p1-control.json"), JSON.stringify(out, null, 1));
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
