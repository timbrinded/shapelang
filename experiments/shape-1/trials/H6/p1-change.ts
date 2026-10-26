// @ts-nocheck
// H6 step 2: E10's uncaught class ("destructive effect plus a matching grant passes on all 79
// resources") realised as 1.0 *changes* on the dogfood model and run through derive in change mode.
// The teeth closed form (P1) is audit-only and counts only forbids; a change adding a grant is also
// judged by loosening (L1) and coverage, which this script measures.
//
//   bun experiments/shape-1/trials/H6/p1-change.ts --work <dir> [--limit n] [--shard i/n]
//
// Base and head are both probeSource(dogfood) (proto/providers/teeth/validate.ts): every resource
// gains a synthetic ts.call binding and a presence-sound probe observer is declared, in base AND head,
// so the probe adds no governance change. Per resource R, a component K (round robin over components
// with grants and a TS-bound `effects complete` unit u) and a verb V, the variants are:
//   E0  code edit of u only (u's digests move in the base manifest), no shape change, no fact (control)
//   E1  code edit + observed V<R> fact at u (no grant): what an agent's code-only PR looks like
//   G1  head adds `grants V<R>` to K only
//   G2  head adds the grant and `V<R>` to u's complete summary (E10's HOprobe: shape-only)
//   G3  head adds the grant + code edit + observed V<R> fact at u (the agent PR that adds both)
//   G4  head adds the grant + code edit, no fact (R bound to code no real provider observes)
// HardDelete for every variant; Truncate and DropStorage also for G2 (E10's probe used 3 verbs).
// The dogfood records (bunTest, tsClockScan, tsCalls at the head revision) are inputs to every run.
// Baseline: the same input with no mutation. A row lists obligations and errors absent from the
// baseline (by key / code+subject). Rows -> <work>/p1-rows.jsonl.
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readModel } from "../../dogfood/tools/lib.ts";
import { elaborateAt } from "../../proto/providers/common.ts";
import { probeSource } from "../../proto/providers/teeth/validate.ts";
import { derive } from "../../proto/src/derive.ts";
import { readEvidence } from "../../proto/src/loader.ts";
import { manifestStatement } from "../../proto/src/manifest.ts";
import { makeStatement, scopeRoot } from "../../proto/src/records.ts";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const WORK = resolve(opt("work", "h6-work"));
const LIMIT = Number(opt("limit", "0"));
const [SHARD, NSHARD] = (opt("shard", "0/1") as string).split("/").map(Number);
const NOW = "2026-10-26T00:00:00Z";
const BASE_REV = "b".repeat(40);
const clone = (x) => JSON.parse(JSON.stringify(x));

const headMan = JSON.parse(readFileSync(join(WORK, "manifest.json"), "utf8"));
const pred = headMan.predicate.shape;
const REV = pred.revision;
const records = readEvidence([join(WORK, "rec-head")]);
const source = readModel();
const esf = elaborateAt(source, NOW);
const probe = probeSource(source, esf);
const probeQ = `${probe.modules[0].module}::probe`;
const probeCode = (r: string): string => `ts.call(${JSON.stringify(`teeth.${r.replace(/::/g, ".")}`)})`;

function baseManifest(edited: string[]): unknown {
  const ids = new Set(edited);
  const entries = pred.entries.map((e) => (ids.has(e.id) ? { ...e, digest: `sha256:${"e".repeat(48)}${e.digest.slice(-16)}` } : e));
  return manifestStatement({ ...pred, revision: BASE_REV, entries });
}
const plainBase = baseManifest([]);

function observation(at: string, verb: string, resource: string): unknown {
  const e = pred.entries.find((x) => x.id === at && x.projection === "unit") ?? pred.entries.find((x) => x.id === at);
  const entries = [{ id: e.id, projection: e.projection, scheme: e.scheme, digest: e.digest, complete: false, deps: [] }];
  return makeStatement({
    v: "shape.evidence.v1",
    kind: "observation",
    result: "observes",
    provider: { id: probeQ, version: "0" },
    revision: REV,
    time: "2026-10-25T00:00:00Z",
    scope: { root: scopeRoot(entries), entries },
    facts: [{ type: "effect", at, verb, resource: probeCode(resource) }],
    harness: [],
    assumptions: []
  });
}

function input(head, base, extra: unknown[]) {
  return {
    contract: "shape.check.input/v1",
    mode: "change",
    now: NOW,
    head: { revision: REV, source: head, manifest: headMan },
    base: { revision: BASE_REV, source: probe, manifest: base },
    change: { ids: ["github:timbrinded/shapelang#h6"] },
    authors: [{ identity: 'github("claude[bot]")', verified: true, bot: true }],
    reviews: [],
    records: [...records, ...extra],
    baseRecords: [],
    persisted: { base: [], head: [] },
    options: { health: false, teeth: false }
  };
}

const keyOf = (o) => o.key;
const errKey = (e) => `${e.code} ${e.subject}`;
const t0 = performance.now();
const baseOut = derive(input(probe, plainBase, []));
const baseKeys = new Map(baseOut.obligations.map((o) => [keyOf(o), `${o.severity}|${o.introduced}`]));
const baseErrs = new Set(baseOut.errors.map(errKey));
process.stderr.write(`baseline: ${baseOut.verdict}, ${baseOut.obligations.length} obligations, ${baseOut.errors.length} errors (${((performance.now() - t0) / 1000).toFixed(1)} s)\n`);

// component -> chosen unit (TS-bound, effects complete), and its file identity
const compDecl = new Map();
for (const m of probe.modules) for (const d of m.decls) if (d.decl === "component") compDecl.set(`${m.module}::${d.name}`, { m, d });
const idSet = new Set(pred.entries.map((e) => e.id));
const comps = [];
for (const [q, { d }] of [...compDecl].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  if (!Array.isArray(d.grants)) continue;
  const u = (d.units ?? []).filter((x) => x.effects?.mode === "complete" && (x.bind ?? "").startsWith('ts("')).sort((a, b) => (a.name < b.name ? -1 : 1))[0];
  if (!u) continue;
  const id = `ts:${JSON.parse(u.bind.slice(3, -1))}`;
  if (!idSet.has(id)) continue;
  const tier = esf.components.find((c) => c.q === q)?.tier;
  comps.push({ q, unit: u.name, id, file: `ts:${id.slice(3).split("#")[0]}`, tier });
}
const resources = esf.resources.filter((r) => !r.q.startsWith("std::")).map((r) => r.q).sort();
writeFileSync(join(WORK, "p1-setup.json"), JSON.stringify({ baseline: { verdict: baseOut.verdict, obligations: baseOut.obligations.length, errors: baseOut.errors.length }, comps, resources: resources.length }, null, 1));

function findComp(src, q) {
  const i = q.lastIndexOf("::");
  const m = src.modules.find((x) => x.module === q.slice(0, i));
  return m?.decls.find((d) => d.decl === "component" && d.name === q.slice(i + 2));
}
const jobs = [];
resources.forEach((r, i) => {
  const c = comps[i % comps.length];
  for (const v of ["E0", "E1", "G1", "G2", "G3", "G4"]) jobs.push({ r, c, verb: "HardDelete", v });
  for (const verb of ["Truncate", "DropStorage"]) jobs.push({ r, c, verb, v: "G2" });
});
// --resume: skip shape-only jobs (G1, G2) an earlier run already completed; code-edit variants are
// rerun, since rows without escalation tracking miss preexisting obligations a code edit escalates
const RESUME = argv.includes("--resume");
const done = new Set<string>();
if (RESUME) for (const f of readdirSync(WORK).filter((x) => /^p1-rows-\d+of\d+\.jsonl$/.test(x))) {
  for (const l of readFileSync(join(WORK, f), "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(l);
    if (r.crash || !["G1", "G2"].includes(r.variant)) continue;
    done.add(`${r.variant}|${r.verb}|${r.resource}`);
  }
}
const mine = jobs.filter((j) => !done.has(`${j.v}|${j.verb}|${j.r}`)).filter((_, i) => i % NSHARD === SHARD).slice(0, LIMIT > 0 ? LIMIT : undefined);
const out = join(WORK, `p1-rows-${SHARD}of${NSHARD}${RESUME ? "-r2" : ""}.jsonl`);
if (RESUME && existsSync(out)) throw new Error(`${out} exists`);
writeFileSync(out, "");
for (const j of mine) {
  const atom = `${j.verb}<${j.r}>`;
  const head = clone(probe);
  const edit = ["E0", "E1", "G3", "G4"].includes(j.v);
  const fact = ["E1", "G3"].includes(j.v);
  if (j.v.startsWith("G")) {
    const d = findComp(head, j.c.q);
    d.grants = [...d.grants, atom];
    if (j.v === "G2") {
      const u = d.units.find((x) => x.name === j.c.unit);
      u.effects = { ...u.effects, atoms: [...u.effects.atoms, { atom }] };
    }
  }
  const t = performance.now();
  let row;
  try {
    const o = derive(input(head, edit ? baseManifest([j.c.id, j.c.file]) : plainBase, fact ? [observation(j.c.id, j.verb, j.r)] : []));
    // new keys, and existing keys whose severity or introduced flag changed (escalations)
    const newObs = o.obligations.filter((x) => baseKeys.get(x.key) !== `${x.severity}|${x.introduced}`);
    const newErrs = o.errors.filter((e) => !baseErrs.has(errKey(e)));
    row = {
      variant: j.v,
      verb: j.verb,
      resource: j.r,
      component: j.c.q,
      tier: j.c.tier,
      verdict: o.verdict,
      errors: newErrs.map((e) => errKey(e)),
      obligations: newObs.map((x) => ({ escalated: baseKeys.has(x.key), kind: x.kind, severity: x.severity, tier: x.tier, force: x.force, introduced: x.introduced, questions: x.questions, exploited: x.exploited, claim: x.claim?.ids?.[0] ?? null, subject: x.subject, rule: x.rule ?? null })),
      ms: Math.round(performance.now() - t)
    };
  } catch (e) {
    row = { variant: j.v, verb: j.verb, resource: j.r, component: j.c.q, crash: String(e).slice(0, 300) };
  }
  appendFileSync(out, `${JSON.stringify(row)}\n`);
}
process.stderr.write(`done ${mine.length} rows in ${((performance.now() - t0) / 1000).toFixed(0)} s -> ${out}\n`);
