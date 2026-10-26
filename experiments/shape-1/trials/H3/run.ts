// @ts-nocheck
// H3 driver: for every (base, head) variant of T1, T3 and T4, runs the agent-written law suite on
// both revisions, emits law records, and derives the change under every binding arm, tier, regime
// and checker. One JSON row per (variant, arm, tier, regime, checker) goes to <out>.
//
//   bun experiments/shape-1/trials/H3/run.ts --out <rows.jsonl> [--tasks T1,T3,T4] [--kernel <shapek>]
//     [--dump <dir>]   also write each stock R1c/R2u input (critical tier) for later replay
//
// Arms (where the laws are bound):
//   C  on component <K>                     Req = every unit (unit) + the module file (own)
//   N  on unit <K>.<f> for every API function the law's statement names
//   P  on unit <K>.<f> for one principal unit (the dogfood Property<F, text> convention)
// Regimes (what evidence the change carries):
//   R1c provider re-runs at head; a failing test is `contradicts` with its counterexample
//   R1i provider re-runs at head; a failing test is `inconclusive` (stock `laws run --bind`)
//   R2u no re-run, base records only; provider unauthenticated, `deps complete`
//   R2a no re-run, base records only; provider authenticated, `deps complete`
//   R2r no re-run, base records only; provider authenticated, revision-tied (default)
// Checkers: stock (proto/src) and vnew (the V-new introduced rule, variant-checker.ts).
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { elaborate } from "../../proto/src/elaborate.ts";
import { buildGov } from "../../proto/src/governance.ts";
import { computeCells } from "../../proto/src/globs.ts";
import { mergeRecords, parseRecord } from "../../proto/src/records.ts";
import { toSeconds } from "../../proto/src/util.ts";
import { TASKS, checkInput, compact, lawRecords, manifestOf, movedIdentities, runDerive, runSuite, sourceFor } from "./lib.ts";
import { buildVariant } from "./variant-checker.ts";
import { variantsOf } from "./variants.ts";

const argv = process.argv.slice(2);
const opt = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const OUT = opt("out") ?? "/dev/stdout";
const TASK_IDS = (opt("tasks") ?? "T1,T3,T4").split(",");
const KERNEL = opt("kernel");
const DUMP = opt("dump");
if (DUMP) mkdirSync(DUMP, { recursive: true });
if (OUT !== "/dev/stdout") rmSync(OUT, { force: true });

const vderive = (await import(buildVariant())).derive;

const REGIMES = [
  { id: "R1c", pv: { identity: true, depsComplete: false }, head: true, mapping: "contra" },
  { id: "R1i", pv: { identity: true, depsComplete: false }, head: true, mapping: "inconcl" },
  { id: "R2u", pv: { identity: false, depsComplete: true }, head: false, mapping: "contra" },
  { id: "R2a", pv: { identity: true, depsComplete: true }, head: false, mapping: "contra" },
  { id: "R2r", pv: { identity: true, depsComplete: false }, head: false, mapping: "contra" }
];
const ARMS = ["C", "N", "P"];
const TIERS = ["normal", "critical"];

// ---- kernel case (as kernel/test/bridge.ts: the prototype is the pre-pass) ----------------------
function krecords(list) {
  const parsed = [];
  for (const x of list ?? []) {
    const r = parseRecord(x);
    if (!r.error) parsed.push(r);
  }
  return mergeRecords(parsed).map((r) => ({ id: r.id, predicate: { shape: r.shape }, authenticated: r.signers.length > 0 }));
}
function kernelCase(input) {
  const now = toSeconds(input.now);
  const head = elaborate(input.head.source, { now });
  const base = elaborate(input.base.source, { lenient: true, now });
  const gv = buildGov(base, base.policy, input.authors ?? []);
  const owners = [];
  for (const c of base.components) for (const g of c.paths) owners.push({ side: "b", glob: g, owner: `${c.q}.*` });
  for (const c of head.components) for (const g of c.paths) owners.push({ side: "h", glob: g, owner: `${c.q}.*` });
  const cells = computeCells(owners).cells.filter((c) => typeof c.b === "string" && typeof c.h === "string").map((c) => [c.b, c.h]);
  return {
    contract: "shape.kernel.case/v1",
    mode: input.mode,
    now,
    change: input.change,
    authors: [...gv.authors],
    unmappedBot: gv.unmappedBot,
    head: { revision: input.head.revision, esf: head, manifest: input.head.manifest },
    base: { revision: input.base.revision, esf: base, manifest: input.base.manifest },
    cells,
    records: krecords(input.records),
    reviews: [],
    baseRecords: krecords(input.baseRecords)
  };
}
function runKernel(input) {
  const r = spawnSync(KERNEL, [], { input: JSON.stringify(kernelCase(input)), maxBuffer: 1 << 28 });
  try {
    const out = JSON.parse(r.stdout.toString());
    return { verdict: out.verdict, errors: (out.errors ?? []).map((e) => ({ code: e.code, subject: e.subject })), obligations: (out.obligations ?? []).map(compact) };
  } catch {
    return { crash: `exit ${r.status}: ${r.stdout.toString().slice(0, 200)} ${r.stderr.toString().slice(0, 300)}` };
  }
}

// ---- main loop ----------------------------------------------------------------------------------
const emitRow = (row) => appendFileSync(OUT, `${JSON.stringify(row)}\n`);
let n = 0;
const t0 = performance.now();
for (const tid of TASK_IDS) {
  const T = TASKS[tid];
  for (const v of variantsOf(tid)) {
    const mb = await manifestOf(T, v.base);
    const mh = await manifestOf(T, v.head);
    const moved = movedIdentities(mb, mh);
    const sb = runSuite(T, v.base);
    const sh = runSuite(T, v.head);
    const suiteHead = Object.fromEntries(Object.entries(sh.perLaw).map(([k, x]) => [k, x.pass]));
    const suiteBase = Object.fromEntries(Object.entries(sb.perLaw).map(([k, x]) => [k, x.pass]));
    for (const arm of ARMS) {
      // records depend on the arm (claim fp, Req) and on signing/mapping, not on tier
      const recSrc = sourceFor(T, arm, "normal", { identity: true, depsComplete: false });
      const cache = new Map();
      const recs = (side, signed, mapping) => {
        const k = `${side}|${signed}|${mapping}`;
        if (!cache.has(k)) cache.set(k, lawRecords(T, recSrc, side === "b" ? mb : mh, side === "b" ? sb : sh, { signed, mapping }));
        return cache.get(k);
      };
      for (const tier of TIERS) {
        for (const R of REGIMES) {
          const src = sourceFor(T, arm, tier, R.pv);
          const baseRecs = recs("b", R.pv.identity, R.mapping);
          const headRecs = R.head ? recs("h", R.pv.identity, R.mapping) : [];
          const records = (R.head ? headRecs : baseRecs).map((r) => r.em.record);
          const input = checkInput(T, `${v.id}-${arm}-${tier}-${R.id}`, { man: mb, source: src }, { man: mh, source: src }, records, baseRecs.map((r) => r.em.record));
          if (DUMP && tier === "critical" && (R.id === "R1c" || R.id === "R2u")) writeFileSync(join(DUMP, `${tid}-${v.id}-${arm}-${R.id}.input.json`), JSON.stringify(input));
          const common = {
            task: tid,
            variant: v.id,
            kind: v.kind,
            breaks: v.breaks,
            breaksFeature: v.breaksFeature,
            arm,
            tier,
            regime: R.id,
            moved: moved.map((m) => `${m.id}[${m.projections.join(",")}]`),
            suiteHead,
            suiteBase,
            suiteSelfCheckFailed: sh.selfCheckFailed,
            headResults: headRecs.map((r) => ({ law: r.law, result: r.result }))
          };
          const stock = runDerive(input);
          emitRow({ ...common, checker: "stock", ...stock });
          const vout = vderive(input);
          emitRow({
            ...common,
            checker: "vnew",
            verdict: vout.verdict,
            errors: vout.errors.map((e) => ({ code: e.code, subject: e.subject })),
            rejected: vout.rejected.map((r) => ({ code: r.code, detail: r.detail })),
            obligations: vout.obligations.map(compact)
          });
          if (KERNEL && tier === "critical" && (R.id === "R1c" || R.id === "R2u" || R.id === "R2a")) emitRow({ ...common, checker: "kernel", ...runKernel(input) });
          n += 1;
        }
      }
    }
    process.stderr.write(`${tid} ${v.kind.padEnd(8)} ${v.id.padEnd(34)} head suite ${JSON.stringify(suiteHead)} moved=${moved.filter((m) => m.id.includes("#")).length} (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`);
  }
}
process.stderr.write(`${n} configurations, ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);
