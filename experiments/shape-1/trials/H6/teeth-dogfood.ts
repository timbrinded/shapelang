// @ts-nocheck
// H6 step 1: teeth on Shape's own 1.0 model (experiments/shape-1/dogfood).
//
//   bun experiments/shape-1/trials/H6/teeth-dogfood.ts --work <dir> [--validate 100] [--reuse]
//
// 1. Freezes one head manifest (working tree's tracked files + dogfood files, as the dogfood tools
//    do) and runs the three dogfood providers (bunTest, tsClockScan, tsCalls) against it, so every
//    observation is at the manifest's revision (--reuse keeps an earlier <work>/manifest.json and
//    <work>/rec-head/ if their revision matches).
// 2. Runs the teeth provider (proto/providers/teeth) twice: over W_decl alone and over W_decl plus
//    the usable observed facts; the first also with --validate n (derive agreement).
// 3. Adds three analyses the provider does not report (same closed form, restricted universes):
//    a. E10-comparable W1: unit positions x E10's 10 prelude verbs x the 79 resources;
//    b. observable W1: only mutants some base provider of the shape could report (an effect atom
//       whose resource binds a code on a presence-sound declared channel that applies to an identity
//       at the position; a hatch atom at a hatch-complete identity of its language) -> claims with
//       no observable kill ("observably vacuous");
//    c. W2 by observability: calls edges (tsCalls observes call(ts), presence) vs kinds no provider
//       observes (only an authored relation can realise them).
// Writes <work>/teeth-decl.json, <work>/teeth-obs.json, <work>/teeth-extra.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runLaws } from "../../dogfood/providers/bun-test.ts";
import { writeJsonl } from "../../dogfood/providers/common.ts";
import { callScan } from "../../dogfood/providers/ts-calls.ts";
import { clockScan } from "../../dogfood/providers/ts-clock-scan.ts";
import { REPO, manifestFor, readModel, workingTreeFiles } from "../../dogfood/tools/lib.ts";
import { elaborateAt, manifestFor as provManifest } from "../../proto/providers/common.ts";
import { worldFacts, w1Killers } from "../../proto/providers/teeth/mutants.ts";
import { runTeeth } from "../../proto/providers/teeth/provider.ts";
import { channelAt } from "../../proto/src/checker.ts";
import { channelCovered } from "../../proto/src/evidence.ts";
import { readEvidence } from "../../proto/src/loader.ts";
import { TRUST, parseAtom } from "../../proto/src/model.ts";
import { parseRecord } from "../../proto/src/records.ts";
import { UNGOVERNED, buildWorld, impl, posComp } from "../../proto/src/world.ts";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const WORK = resolve(opt("work", "h6-work"));
const VALIDATE = Number(opt("validate", "0"));
const NOW = "2026-10-26T00:00:00Z";
mkdirSync(WORK, { recursive: true });
const t0 = performance.now();
const log = (s: string): void => {
  process.stderr.write(`[${((performance.now() - t0) / 1000).toFixed(1)} s] ${s}\n`);
};

// ---- 1. frozen manifest + providers -------------------------------------------------------------
const manPath = join(WORK, "manifest.json");
const recDir = join(WORK, "rec-head");
const source = readModel();
let revision: string;
if (argv.includes("--reuse") && existsSync(manPath) && existsSync(join(recDir, "bunTest.jsonl"))) {
  revision = JSON.parse(readFileSync(manPath, "utf8")).predicate.shape.revision;
  log(`reusing manifest ${revision}`);
} else {
  const m = await manifestFor(workingTreeFiles());
  revision = m.revision;
  writeFileSync(manPath, JSON.stringify(m.statement));
  log(`manifest ${revision}`);
  const clock = await clockScan({ root: REPO, manifest: m.statement, now: NOW });
  writeJsonl(join(recDir, "tsClockScan.jsonl"), [clock.envelope]);
  const calls = await callScan({ root: REPO, manifest: m.statement, now: NOW });
  writeJsonl(join(recDir, "tsCalls.jsonl"), [calls.envelope]);
  const laws = await runLaws({ root: REPO, manifest: m.statement, source, now: NOW });
  writeJsonl(join(recDir, "bunTest.jsonl"), laws.records.map((x) => x.envelope));
  writeFileSync(
    join(WORK, "rec-head.summary.json"),
    JSON.stringify({ revision, tsClockScan: { facts: clock.facts, files: clock.files, incomplete: clock.incomplete.length }, tsCalls: { facts: calls.facts, files: calls.files }, bunTest: laws.records.map((r) => ({ law: r.law, result: r.result })) }, null, 1)
  );
  log(`providers: clock facts ${clock.facts}, call facts ${calls.facts}, law records ${laws.records.length}`);
}
const man = await provManifest({ manifest: manPath });
const records = readEvidence([recDir]);

// ---- 2. the teeth provider ----------------------------------------------------------------------
const decl = runTeeth({ source, man, records: [], time: NOW, validate: VALIDATE });
writeFileSync(join(WORK, "teeth-decl.json"), JSON.stringify({ ...decl.report, validation: decl.validation, errors: decl.errors, ms: decl.ms }, null, 1));
log(`teeth decl: ${decl.report.operators.map((o) => `${o.op} ${o.killed}/${o.mutants}`).join(", ")}; validate ${decl.validation ? `${decl.validation.agree}/${decl.validation.sampled}` : "-"}`);
const obs = runTeeth({ source, man, records, time: NOW });
writeFileSync(join(WORK, "teeth-obs.json"), JSON.stringify({ ...obs.report, errors: obs.errors, ms: obs.ms }, null, 1));
log(`teeth obs: ${obs.report.operators.map((o) => `${o.op} ${o.killed}/${o.mutants}`).join(", ")}`);

// ---- 3. extra analyses (same closed form, restricted universes) ---------------------------------
const esf = elaborateAt(source, NOW);
const W = buildWorld(esf, man.index, { side: "h" });
const parsed = records.map((r) => parseRecord(r)).filter((p) => !("error" in p));
const observations = parsed.filter((r) => r.shape.kind === "observation" && r.shape.revision === man.revision);
const reportedVerbs = new Map<string, Set<string>>();
for (const r of observations) for (const f of r.shape.facts ?? []) if (f.type === "effect") {
  const s = reportedVerbs.get(f.resource) ?? new Set<string>();
  s.add(f.verb);
  reportedVerbs.set(f.resource, s);
}
function analyse(obsRecs) {
const { atoms: present, reachOf } = worldFacts({ esf, world: W, observations: obsRecs });
const uppers = esf.claims.filter((c) => c.op === "effects.upper");
const resources = esf.resources.filter((r) => !r.q.startsWith("std::"));
const hatchVerbs = esf.effects.map((e) => e.verb).filter((v) => v !== "Hatch" && impl(W, v, "Hatch"));
const verbs = esf.effects.map((e) => e.verb).filter((v) => v !== "Hatch" && !hatchVerbs.includes(v));
const hatchLang = new Map(esf.hatches.map((h) => [h.kind, h.lang]));
const entailed = (pos: string, atom: string): boolean => {
  const a = parseAtom(atom);
  for (const p of present.get(pos) ?? []) {
    const q = parseAtom(p);
    if (q && a && q.resource === a.resource && impl(W, q.verb, a.verb)) return true;
  }
  return false;
};
const presenceChannels = esf.providers.filter((p) => p.presence && p.produces.includes("observation")).flatMap((p) => p.observes);
const absenceChannels = esf.providers.filter((p) => p.absence && p.produces.includes("observation")).flatMap((p) => p.observes);
const codesOf = new Map<string, string[]>();
for (const r of resources) codesOf.set(r.q, r.bind ?? []);
const idsAt = (pos: string): string[] => W.codeOfPos.get(pos) ?? [];
function observable(pos: string, atom: string, channels: string[], strictVerbs = false): boolean {
  const a = parseAtom(atom);
  if (!a) return false;
  if (a.resource === TRUST) {
    const lang = hatchLang.get(a.verb) ?? null;
    return idsAt(pos).some((x) => {
      const info = W.man.ids.get(x);
      return !!info && info.hatchComplete && (lang === null ? ["ts", "rust", "verus"].includes(info.lang) : info.lang === lang);
    });
  }
  for (const code of codesOf.get(a.resource) ?? []) {
    const ch = `effect(${code})`;
    if (!channelCovered(channels, ch)) continue;
    if (strictVerbs && !(reportedVerbs.get(code)?.has(a.verb) ?? false)) continue;
    if (idsAt(pos).some((x) => { const info = W.man.ids.get(x); return !!info && channelAt(ch, info) !== null; })) return true;
  }
  return false;
}
const E10_VERBS = ["Read", "Append", "Update", "Redact", "LogicalDelete", "HardDelete", "Truncate", "DropStorage", "Export", "Import"];
const atomUniverse = [...resources.flatMap((r) => verbs.map((v) => `${v}<${r.q}>`)), ...[...hatchVerbs, "Hatch"].map((h) => `${h}<${TRUST}>`)];
const isUnit = (p: string): boolean => W.unitByQ.has(p);
interface Row { n: number; killed: number; byKiller: Record<string, number>; gap: Record<string, number> }
const blank = (): Row => ({ n: 0, killed: 0, byKiller: {}, gap: {} });
const e10 = blank();
const obsW1 = blank();
const obsW1abs = blank();
const obsW1verbs = blank();
const obsVerbKills = new Map<string, number>();
const obsKills = new Map<string, number>();
const declKills = new Map<string, number>();
const e10Survivors: string[] = [];
const killerClass = (c): string => (c.op === "authority" ? "authority" : c.op === "effects.upper" ? "summary" : c.op === "effect.forbid" ? "forbid" : c.op);
const gapClass = (pos: string, atom: string): string => {
  const comp = posComp(pos);
  return atom.endsWith(`<${TRUST}>`) ? "hatch-unforbidden" : pos === UNGOVERNED ? "ungoverned" : !comp || W.compByQ.get(comp)?.grants === null ? "open-authority" : "granted-to-component";
};
for (const pos of W.positions) {
  for (const atom of atomUniverse) {
    if (entailed(pos, atom)) continue;
    const killers = w1Killers(W, uppers, reachOf, pos, atom);
    for (const k of killers) declKills.set(k.fp, (declKills.get(k.fp) ?? 0) + 1);
    const tally = (row: Row): void => {
      row.n += 1;
      if (killers.length > 0) {
        row.killed += 1;
        for (const cls of new Set(killers.map(killerClass))) row.byKiller[cls] = (row.byKiller[cls] ?? 0) + 1;
      } else {
        const g = gapClass(pos, atom);
        row.gap[g] = (row.gap[g] ?? 0) + 1;
      }
    };
    const a = parseAtom(atom);
    if (isUnit(pos) && a && a.resource !== TRUST && E10_VERBS.includes(a.verb)) {
      tally(e10);
      if (killers.length === 0) e10Survivors.push(`${pos} ${atom}`);
    }
    if (observable(pos, atom, presenceChannels)) {
      tally(obsW1);
      for (const k of killers) obsKills.set(k.fp, (obsKills.get(k.fp) ?? 0) + 1);
    }
    if (observable(pos, atom, absenceChannels)) tally(obsW1abs);
    if (observable(pos, atom, presenceChannels, true)) {
      tally(obsW1verbs);
      for (const k of killers) obsVerbKills.set(k.fp, (obsVerbKills.get(k.fp) ?? 0) + 1);
    }
  }
}
// sibling class for E10 survivors: the atom is already present at another unit of the same component
const siblingHas = (pos: string, atom: string): boolean => {
  const comp = posComp(pos);
  return W.positions.some((p) => p !== pos && posComp(p) === comp && entailed(p, atom));
};
const e10SurvClass: Record<string, number> = {};
for (const s of e10Survivors) {
  const [pos, atom] = s.split(" ");
  const cls = siblingHas(pos, atom) ? "sibling-already-has" : "granted-no-sibling";
  e10SurvClass[cls] = (e10SurvClass[cls] ?? 0) + 1;
}
const upperClaims = esf.claims.filter((c) => c.polarity === "upper");
const claimRows = upperClaims.map((c) => ({ id: c.ids[0] ?? c.fp, fp: c.fp, op: c.op, tier: c.tier, declW1: declKills.get(c.fp) ?? 0, obsW1: obsKills.get(c.fp) ?? 0, obsW1verbs: obsVerbKills.get(c.fp) ?? 0 }));
const observablyVacuousVerbs = claimRows.filter((r) => r.declW1 > 0 && r.obsW1verbs === 0);
const observablyVacuousW1 = claimRows.filter((r) => r.declW1 > 0 && r.obsW1 === 0);
const byOp = (rows) => rows.reduce((m, r) => ((m[r.op] = (m[r.op] ?? 0) + 1), m), {});
// W2 observability: which kinds some declared provider observes, and with what soundness
const kindObs = esf.kinds.map((k) => {
  const call = k.name === "calls";
  const presence = call ? presenceChannels.some((c) => c.startsWith("call(")) : presenceChannels.some((c) => c.startsWith(`edge(${k.name}`));
  return { kind: k.name, observedPresence: presence };
});
// unit positions whose summary is `effects complete` and whose atoms could be refuted/observed at all
const sumObs = uppers.map((u) => {
  const unit = String(u.args.unit);
  const atoms = (u.args.atoms as string[]).map((x) => x.replace(/ via .+$/, ""));
  const obsAtoms = atoms.filter((a) => observable(unit, a, presenceChannels));
  return { unit, atoms: atoms.length, observableAtoms: obsAtoms.length };
});
// resources: which have any observable code at all
const resObs = resources.map((r) => ({ q: r.q, codes: r.bind ?? [], observable: (r.bind ?? []).some((code) => channelCovered(presenceChannels, `effect(${code})`)) }));
return {
  revision,
  presenceChannels,
  absenceChannels,
  positions: { total: W.positions.length, units: W.positions.filter(isUnit).length, star: W.positions.filter((p) => p.endsWith(".*")).length, ungoverned: W.positions.includes(UNGOVERNED) ? 1 : 0 },
  e10W1: { ...e10, survivorClass: e10SurvClass, survivors: e10Survivors.sort() },
  observableW1: obsW1,
  observableW1absence: obsW1abs,
  observableW1verbs: obsW1verbs,
  observablyVacuousW1verbs: { count: observablyVacuousVerbs.length, byOp: byOp(observablyVacuousVerbs), ids: observablyVacuousVerbs.map((r) => r.id).sort() },
  claimRows,
  claims: { upper: claimRows.length, byOp: byOp(claimRows), declVacuous: claimRows.filter((r) => r.declW1 === 0).map((r) => r.id) },
  observablyVacuousW1: { count: observablyVacuousW1.length, byOp: byOp(observablyVacuousW1), ids: observablyVacuousW1.map((r) => r.id).sort() },
  observablyLiveW1: claimRows.filter((r) => r.obsW1 > 0).length,
  kindObservability: kindObs,
  summaries: { total: sumObs.length, withAnyObservableAtom: sumObs.filter((s) => s.observableAtoms > 0).length },
  resourceObservability: { total: resObs.length, bound: resObs.filter((r) => r.codes.length > 0).length, observable: resObs.filter((r) => r.observable).map((r) => r.q) },
  observations: obsRecs.map((r) => ({ provider: r.shape.provider?.id, facts: (r.shape.facts ?? []).length }))
};
}
const extra = { decl: analyse([]), obs: analyse(observations), reportedVerbs: Object.fromEntries([...reportedVerbs].map(([k, v]) => [k, [...v].sort()])), ungovernedIds: [...W.man.ids.keys()].filter((x) => W.att(x) === UNGOVERNED).length, ids: W.man.ids.size };
writeFileSync(join(WORK, "teeth-extra.json"), JSON.stringify(extra, null, 1));
for (const k of ["decl", "obs"]) log(`${k}: E10-comparable W1 ${extra[k].e10W1.killed}/${extra[k].e10W1.n}; observable W1 ${extra[k].observableW1.killed}/${extra[k].observableW1.n} (reported verbs ${extra[k].observableW1verbs.killed}/${extra[k].observableW1verbs.n}); observably vacuous ${extra[k].observablyVacuousW1.count}`);
