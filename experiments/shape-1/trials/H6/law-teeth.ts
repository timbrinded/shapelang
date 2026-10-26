// @ts-nocheck
// H6: feeds the law-adequacy kill counts into the teeth provider's law path. The dogfood bunTest
// records carry no `bound.mutants`, so the provider reports all 87 laws `unassessed`; this rewrites
// each `supports` record's bound with {total, killed} = own-law kills over the unit + callee
// mutants run by law-adequacy.ts (unsigned statements: teeth reads records, it does not verify them),
// then reruns runTeeth and keeps its laws[] verdicts (vacuous / weak / teeth / unassessed).
//   bun experiments/shape-1/trials/H6/law-teeth.ts --work <dir>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readModel } from "../../dogfood/tools/lib.ts";
import { manifestFor } from "../../proto/providers/common.ts";
import { runTeeth } from "../../proto/providers/teeth/provider.ts";
import { readEvidence } from "../../proto/src/loader.ts";

const argv = process.argv.slice(2);
const i = argv.indexOf("--work");
const WORK = resolve(i >= 0 ? argv[i + 1] : "h6-work");
const plan = JSON.parse(readFileSync(join(WORK, "law-plan.json"), "utf8"));
const rows = readdirSync(WORK).filter((f) => /^law-rows-\d+of\d+\.jsonl$/.test(f)).flatMap((f) => readFileSync(join(WORK, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const unitLaws = new Map(plan.units.map((u) => [u.unit, u.laws.filter((l) => l.kind === "tested").map((l) => l.law)]));
const counts = new Map<string, { total: number; killed: number }>();
for (const r of rows) for (const law of unitLaws.get(r.unit) ?? []) {
  const c = counts.get(law) ?? { total: 0, killed: 0 };
  c.total += 1;
  if (r.killedBy.includes(law)) c.killed += 1;
  counts.set(law, c);
}
const records = readEvidence([join(WORK, "rec-head")]).map((env) => {
  const stmt = env.payload ? JSON.parse(Buffer.from(env.payload, "base64").toString("utf8")) : env;
  const sh = stmt.predicate.shape;
  if (sh.kind === "test" && sh.result === "supports" && counts.has(sh.claim.id)) sh.bound = { ...sh.bound, mutants: counts.get(sh.claim.id) };
  return stmt;
});
const man = await manifestFor({ manifest: join(WORK, "manifest.json") });
const run = runTeeth({ source: readModel(), man, records, time: "2026-10-26T00:00:00Z" });
const laws = run.report.laws;
const tally = laws.reduce((m, l) => ((m[l.verdict] = (m[l.verdict] ?? 0) + 1), m), {});
writeFileSync(join(WORK, "law-teeth.json"), JSON.stringify({ tally, laws: laws.filter((l) => l.mutants) }, null, 1));
process.stdout.write(`${JSON.stringify({ tally, assessed: laws.filter((l) => l.mutants).map((l) => `${l.id} ${l.mutants.killed}/${l.mutants.total} ${l.verdict}`) }, null, 1)}\n`);
