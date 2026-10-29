// @ts-nocheck
// H6: the W2 (added edge) closed form on the dogfood model, per E10 comparison row: calls mutants by
// module pair and structural class, the specific edges E10 named, and kernel-isolation routes over
// every kind. Uses closedW2 (proto/providers/teeth/validate.ts) over W_decl edges.
//   bun experiments/shape-1/trials/H6/w2-edges.ts --work <dir>   (needs <work>/manifest.json)
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readModel } from "../../dogfood/tools/lib.ts";
import { elaborateAt, manifestFor } from "../../proto/providers/common.ts";
import { closedW2 } from "../../proto/providers/teeth/validate.ts";
import { buildWorld } from "../../proto/src/world.ts";

const argv = process.argv.slice(2);
const i = argv.indexOf("--work");
const WORK = resolve(i >= 0 ? argv[i + 1] : "h6-work");
const NOW = "2026-10-26T00:00:00Z";
const man = await manifestFor({ manifest: join(WORK, "manifest.json") });
const esf = elaborateAt(readModel(), NOW);
const W = buildWorld(esf, man.index, { side: "h" });
const comps = W.nodes.filter((n) => W.compByQ.has(n)).sort();
const declared = new Set(
  esf.claims
    .filter((c) => c.op === "edge.exists")
    .map((c) => `${c.args.from}|${c.args.kind}|${c.args.to}`)
);
const adj = new Map();
for (const e of declared) {
  const [a, k, b] = e.split("|");
  if (k !== "calls") continue;
  adj.set(a, [...(adj.get(a) ?? []), b]);
}
const reach = (from) => {
  const seen = new Set();
  const st = [from];
  while (st.length) {
    for (const y of adj.get(st.pop()) ?? []) {
      if (seen.has(y)) continue;
      seen.add(y);
      st.push(y);
    }
  }
  return seen;
};
const mod = (q) => q.slice(0, q.lastIndexOf("::"));
const pairs = {};
const classes = {};
for (const a of comps)
  for (const b of comps) {
    if (a === b || declared.has(`${a}|calls|${b}`)) continue;
    const killed = closedW2(esf, W, a, "calls", b);
    const key = `${mod(a)} -> ${mod(b)}`;
    const row = pairs[key] ?? { killed: 0, survived: 0 };
    row[killed ? "killed" : "survived"] += 1;
    pairs[key] = row;
    const cls = reach(b).has(a) ? "back-edge" : reach(a).has(b) ? "shortcut" : "new-coupling";
    const c = classes[cls] ?? { killed: 0, survived: 0 };
    c[killed ? "killed" : "survived"] += 1;
    classes[cls] = c;
  }
const named = [
  ["shape.tooling::ShapeAnalyzer", "shape.checker::ShapeChecker"],
  ["shape.tooling::ShapeAuthoring", "shape.checker::ShapeChecker"],
  ["shape.checker::ShapeChecker", "shape.tooling::ShapeAuthoring"],
  [
    "shape.checker.incremental::ShapeIncrementalChecker",
    "shape.runtime::ExperimentalSemanticKernel"
  ],
  ["shape.delivery::DocsSite", "shape.runtime::ExperimentalSemanticKernel"],
  ["shape.language::DocsShapeBlockVerifier", "shape.runtime::ExperimentalSemanticKernel"],
  ["shape.delivery::ReleasePipeline", "shape.runtime::ExperimentalSemanticKernel"]
].map(([a, b]) => ({ edge: `${a} -calls-> ${b}`, killed: closedW2(esf, W, a, "calls", b) }));
// every kind into the kernel, from the three isolated sources and from everyone
const kernel = "shape.runtime::ExperimentalSemanticKernel";
const intoKernel = esf.kinds
  .filter((k) => k.to === "component")
  .map((k) => {
    let killed = 0;
    let total = 0;
    for (const a of comps) {
      if (a === kernel || declared.has(`${a}|${k.name}|${kernel}`)) continue;
      total += 1;
      if (closedW2(esf, W, a, k.name, kernel)) killed += 1;
    }
    return { kind: k.name, total, killed };
  });
const out = { calls: { classes, pairs }, named, intoKernel };
writeFileSync(join(WORK, "w2-edges.json"), JSON.stringify(out, null, 1));
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
