// @ts-nocheck
// H2 probe: maps the base state of the dogfood model (component call edges, clock facts, units,
// summaries, relations) so drift seeds can be chosen against measured facts.
//   bun experiments/shape-1/trials/H2/probe.ts <work-dir>
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { elaborate } from "../../proto/src/elaborate.ts";
import { indexManifest } from "../../proto/src/manifest.ts";
import { buildWorld } from "../../proto/src/world.ts";
import { callScan } from "../../dogfood/providers/ts-calls.ts";
import { clockScan } from "../../dogfood/providers/ts-clock-scan.ts";
import { composeModel, manifestFor, materialize, treeFiles } from "../../dogfood/tools/lib.ts";

const work = process.argv[2];
const now = "2026-10-26T00:00:00Z";
const dir = materialize("HEAD", join(work, "trees", "probe-base"));
const m = await manifestFor(treeFiles(dir));
const src = composeModel(m.statement, undefined, dir).source;
const esf = elaborate(src, { now: Math.floor(Date.parse(now) / 1000) });
const idx = indexManifest(m.statement).index;
const w = buildWorld(esf, idx, { side: "h" });
const dec = (env) => JSON.parse(Buffer.from(env.payload, "base64").toString("utf8")).predicate.shape;
const calls = dec((await callScan({ root: dir, manifest: m.statement, now })).envelope);
const clock = dec((await clockScan({ root: dir, manifest: m.statement, now })).envelope);
const comp = (pos) => (pos === "ungoverned" ? "ungoverned" : pos.endsWith(".*") ? pos.slice(0, -2) : w.unitByQ.get(pos)?.component ?? pos);
const edges = {};
for (const f of calls.facts) {
  const a = comp(w.att(f.at));
  const b = comp(w.att(f.to));
  if (a === b) continue;
  const k = `${a} -> ${b}`;
  (edges[k] ??= []).push(`${f.at} => ${f.to} (${f.n})`);
}
const clocks = clock.facts.map((f) => ({ ...f, pos: w.att(f.at) }));
const units = esf.units.map((u) => ({ q: u.q, bind: w.unitBind.get(u.q), tier: u.tier, summary: u.summary, attach: u.attach }));
const comps = esf.components.map((c) => ({ q: c.q, tier: c.tier, boundary: c.boundary, paths: c.paths, grants: c.grants, complete: c.complete }));
const claims = esf.claims.map((c) => ({ ids: c.ids, op: c.op, tier: c.tier, fp: c.fp, args: c.op === "law" ? { on: c.args.on, schema: c.args.statement?.schema, text: c.args.statement?.text } : c.args }));
writeFileSync(join(work, "probe.json"), JSON.stringify({ revision: m.revision, errors: esf.errors, worldErrors: w.errors, comps, units, claims, edges, clocks, incompleteClock: clock.scope.entries.filter((e) => !e.complete).map((e) => e.id) }, null, 1));
console.log(`rev ${m.revision} comps ${comps.length} units ${units.length} claims ${claims.length} edges ${Object.keys(edges).length} clocks ${clocks.length}`);
