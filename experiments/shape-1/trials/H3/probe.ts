// @ts-nocheck
// Probe one (task, base file, head file) pair under every arm and regime, printing the verdict and
// the law obligations: bun experiments/shape-1/trials/H3/probe.ts T4 <base.ts> <head.ts>
import { readFileSync } from "node:fs";
import { TASKS, checkInput, lawRecords, manifestOf, movedIdentities, runDerive, runSuite, sourceFor } from "./lib.ts";

const [tid, baseFile, headFile] = process.argv.slice(2);
const T = TASKS[tid];
const bt = { [T.module]: readFileSync(baseFile, "utf8") };
const ht = { [T.module]: readFileSync(headFile, "utf8") };
const mb = await manifestOf(T, bt);
const mh = await manifestOf(T, ht);
console.log("moved:", JSON.stringify(movedIdentities(mb, mh)));
const sb = runSuite(T, bt);
const sh = runSuite(T, ht);
console.log("suite base:", JSON.stringify(Object.fromEntries(Object.entries(sb.perLaw).map(([k, v]) => [k, v.pass]))), sb.ms, "ms");
console.log("suite head:", JSON.stringify(Object.fromEntries(Object.entries(sh.perLaw).map(([k, v]) => [k, v.pass]))), sh.ms, "ms");
for (const arm of ["C", "N", "P"]) {
  for (const tier of ["normal", "critical"]) {
    for (const [reg, pv, useHead, mapping] of [
      ["R1c", { identity: true, depsComplete: false }, true, "contra"],
      ["R1i", { identity: true, depsComplete: false }, true, "inconcl"],
      ["R2u", { identity: false, depsComplete: true }, false, "contra"],
      ["R2a", { identity: true, depsComplete: true }, false, "contra"]
    ]) {
      const src = sourceFor(T, arm, tier, pv);
      const baseRecs = lawRecords(T, src, mb, sb, { signed: pv.identity, mapping });
      const headRecs = useHead ? lawRecords(T, src, mh, sh, { signed: pv.identity, mapping }) : [];
      const input = checkInput(T, "probe", { man: mb, source: src }, { man: mh, source: src }, useHead ? headRecs.map((r) => r.em.record) : baseRecs.map((r) => r.em.record), baseRecs.map((r) => r.em.record));
      const d = runDerive(input);
      const obs = d.obligations.map((o) => `${o.kind}:${o.claim?.split("::")[1]}:${o.reason ?? o.force}:${o.introduced ? "I" : "-"}:${o.severity}`);
      console.log(`${arm} ${tier.padEnd(8)} ${reg} ${d.verdict.padEnd(7)} err=[${d.errors.map((e) => e.code).join(",")}] rej=${d.rejected.length} ${obs.join(" ")} (${d.ms} ms)`);
    }
  }
}
