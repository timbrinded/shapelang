// @ts-nocheck
// Differential bridge (one-off script): runs the TypeScript prototype and the Lean kernel on the
// prototype's worked-example fixtures and compares verdicts and core obligation fields.
// The prototype acts as the kernel's pre-pass: elaboration (ESF), signature parsing (records are
// authenticated iff a signature verified), authors* and cells.
// Run: bun experiments/shape-1/kernel/test/bridge.ts <path-to-shapek>
import { spawnSync } from "node:child_process";
import * as F from "../../proto/examples/fixtures.ts";
import { derive } from "../../proto/src/derive.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { buildGov } from "../../proto/src/governance.ts";
import { computeCells } from "../../proto/src/globs.ts";
import { mergeRecords, parseRecord } from "../../proto/src/records.ts";
import { toSeconds } from "../../proto/src/util.ts";

const exe = process.argv[2] ?? "experiments/shape-1/kernel/.lake/build/bin/shapek";

function records(list) {
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
  const base = input.base?.source ? elaborate(input.base.source, { lenient: true, now }) : null;
  const gov = input.mode === "audit" || !base ? head : base;
  const gv = buildGov(gov, gov.policy, input.authors ?? []);
  const reviews = [];
  let unsupported = null;
  for (const rv of input.reviews ?? []) {
    const actor = gv.byIdentity.get(rv.identity.trim());
    if (actor) reviews.push({ actor, line: rv.line, change: rv.change ?? input.change.ids[0] });
    else unsupported = rv.line;
  }
  const owners = [];
  if (base && input.mode !== "audit") {
    for (const c of base.components) for (const g of c.paths) owners.push({ side: "b", glob: g, owner: `${c.q}.*` });
    for (const c of head.components) for (const g of c.paths) owners.push({ side: "h", glob: g, owner: `${c.q}.*` });
  }
  const cells = owners.length ? computeCells(owners).cells.filter((c) => typeof c.b === "string" && typeof c.h === "string").map((c) => [c.b, c.h]) : [];
  return {
    unsupported,
    kcase: {
      contract: "shape.kernel.case/v1", mode: input.mode, now: Math.max(now, input.base?.committerTime ? toSeconds(input.base.committerTime) : now),
      change: input.change, authors: [...gv.authors], unmappedBot: gv.unmappedBot,
      head: { revision: input.head.revision, esf: head, manifest: input.head.manifest },
      base: input.mode === "audit" || !input.base ? null : { revision: input.base.revision, esf: base ?? { shape: { q: "", owner: "" } }, manifest: input.base.manifest },
      cells, records: records(input.records), reviews, baseRecords: records(input.baseRecords)
    }
  };
}

const FIELDS = ["kind", "severity", "tier", "force", "reason", "introduced", "binding", "exploited", "exception", "group"];

const fixtures = [
  ...["audit", "empty-base", "A", "B", "B-weak", "Bprime", "Bsecond", "C", "C-answered"].map((v) => [`ex1 ${v}`, () => F.ex1(v)]),
  ["ex2", () => F.ex2()], ["ex2 exception+approve", () => F.ex2({ exception: true, approve: true })],
  ["ex2 approve", () => F.ex2({ approve: true })], ["ex2 exception", () => F.ex2({ exception: true })],
  ["ex2 hostMarkers", () => F.ex2({ hostMarkers: true })],
  ["ex3", () => F.ex3()], ["ex3 judgeLine", () => F.ex3({ judgeLine: true })],
  ["ex4", () => F.ex4()], ["ex4 complete", () => F.ex4({ complete: true })],
  ["ex4 complete+diagnostics", () => F.ex4({ complete: true, headDiagnostics: true })],
  ["ex3s2", () => F.ex3s2()], ["ex3s2 harnessEdited", () => F.ex3s2({ harnessEdited: true })],
  ["ex3s2 dropRecord", () => F.ex3s2({ dropRecord: true })], ["ex3s2 seededClock", () => F.ex3s2({ seededClock: true })],
  ["ex3s2 removeRefactorSensitive", () => F.ex3s2({ removeRefactorSensitive: true })]
];

let agreeCases = 0;
let fieldAgree = 0;
let fieldTotal = 0;
const report = [];
for (const [name, mk] of fixtures) {
  let input;
  try {
    input = mk();
  } catch (e) {
    report.push(`${name}: fixture error ${e}`);
    continue;
  }
  const ts = derive(input);
  const { kcase, unsupported } = kernelCase(input);
  const run = spawnSync(exe, [], { input: JSON.stringify(kcase) });
  let lean;
  try {
    lean = JSON.parse(run.stdout.toString());
  } catch {
    report.push(`${name}: kernel output unparsable ${run.stdout.toString().slice(0, 200)}`);
    continue;
  }
  const diffs = [];
  if (ts.verdict !== lean.verdict) diffs.push(`verdict ts=${ts.verdict} lean=${lean.verdict}`);
  const tsErr = (ts.errors ?? []).map((e) => e.code).sort().join(",");
  const leanErr = (lean.errors ?? []).map((e) => e.code).sort().join(",");
  if (tsErr !== leanErr) diffs.push(`errors ts=[${tsErr}] lean=[${leanErr}]`);
  const tsObs = new Map((ts.obligations ?? []).map((o) => [o.key, o]));
  const leanObs = new Map((lean.obligations ?? []).map((o) => [o.key, o]));
  for (const [k, o] of tsObs) {
    const l = leanObs.get(k);
    if (!l) {
      diffs.push(`only ts: ${o.kind} ${k.slice(0, 19)} ${JSON.stringify(o.subject)} ${o.reason ?? ""}`);
      continue;
    }
    for (const f of FIELDS) {
      fieldTotal += 1;
      if (JSON.stringify(o[f] ?? null) === JSON.stringify(l[f] ?? null)) fieldAgree += 1;
      else diffs.push(`${k.slice(0, 19)} ${f} ts=${JSON.stringify(o[f])} lean=${JSON.stringify(l[f])}`);
    }
  }
  for (const [k, o] of leanObs) if (!tsObs.has(k)) diffs.push(`only lean: ${o.kind} ${k.slice(0, 19)} ${JSON.stringify(o.subject)} ${o.reason ?? ""}`);
  const tsAns = (ts.answered ?? []).map((a) => a.obligation).sort().join(",");
  const leanAns = (lean.answered ?? []).map((a) => a.obligation).sort().join(",");
  if (tsAns !== leanAns) diffs.push(`answered ts=[${tsAns.slice(0, 60)}] lean=[${leanAns.slice(0, 60)}]`);
  if (unsupported) diffs.push(`(review line not bridged: ${unsupported})`);
  if (diffs.length === 0) agreeCases += 1;
  report.push(`${diffs.length === 0 ? "AGREE" : "DIFF "} ${name} (ts ${tsObs.size} obligations, lean ${leanObs.size})`);
  for (const d of diffs) report.push(`      ${d}`);
}
console.log(report.join("\n"));
console.log(`cases agreeing: ${agreeCases}/${fixtures.length}; shared-obligation fields agreeing: ${fieldAgree}/${fieldTotal}`);
