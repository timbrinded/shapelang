// @ts-nocheck
// Differential bridge (one-off script): runs the TypeScript prototype and the Lean kernel on the
// prototype's worked-example fixtures and compares the complete core output byte for byte (JCS,
// A.16.31), listing the differing obligation fields when they disagree.
// The prototype acts as the kernel's pre-pass (A.11.2.1): input verification (verifyInput: commits,
// trees, manifests and their signers), elaboration (ESF), record parsing and validation (records
// are authenticated iff a signature verified; rejected records are dropped), persisted records
// (persistedBase marks persisted.base), authors* and the review lines with their base actors.
// The kernel computes cells itself (A.8.1.4 [D23]); the case carries inputDigest, rejected and
// clockClamped from the prototype, which alone can compute them.
// Run: bun experiments/shape-1/kernel/test/bridge.ts <path-to-shapek>
import { spawnSync } from "node:child_process";
import * as F from "../../proto/examples/fixtures.ts";
import { derive } from "../../proto/src/derive.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { buildGov } from "../../proto/src/governance.ts";
import { verifyInput } from "../../proto/src/input.ts";
import { H } from "../../proto/src/jcs.ts";
import { mergeRecords, parseRecord } from "../../proto/src/records.ts";
import { coreBytes } from "../../proto/src/render.ts";
import { toSeconds } from "../../proto/src/util.ts";

const exe = process.argv[2] ?? "experiments/shape-1/kernel/.lake/build/bin/shapek";

function records(list, rejected, persistedBase) {
  const parsed = [];
  for (const x of list ?? []) {
    const r = parseRecord(x);
    if (!r.error) parsed.push(r);
  }
  return mergeRecords(parsed)
    .map((r) => ({
      id: r.id,
      rejected: rejected.has(r.id),
      predicate: { shape: r.shape },
      authenticated: r.signers.length > 0,
      persistedBase: persistedBase.has(r.id)
    }));
}

function kernelCase(input, ts) {
  const v = verifyInput(input);
  if (!v.ok) return { unsupported: `invalid input: ${v.problems.join("; ")}`, kcase: null };
  const rejected = new Set((ts.rejected ?? []).map((r) => r.record));
  const nowRaw = toSeconds(input.now);
  const now = Math.max(nowRaw, v.base?.committerTime ?? nowRaw);
  const hasBase = input.mode !== "audit" && !!v.base;
  const head = elaborate(v.head.source, { now, std: v.head.std });
  head.errors = [
    ...head.errors,
    ...v.head.shapeErrors.map((e) => ({ code: e.code, subject: e.subject, causes: [], dischargers: [] })),
    ...(ts.errors ?? [])
      .filter((e) => e.code === "E-evidence-path" || e.code === "E-evidence-rewrite")
      .map((e) => ({ code: e.code, subject: e.subject, causes: [], dischargers: [] }))
  ];
  const unreadable = hasBase && !!v.base?.unreadable;
  const base = hasBase && !unreadable ? elaborate(v.base.source, { lenient: true, now, std: v.base.std }) : null;
  if (base)
    base.errors = [
      ...base.errors,
      ...(v.base?.defects ?? []).map((d) => ({ code: d.code, subject: d.subject, causes: [], dischargers: [] }))
    ];
  const gov = base ?? head;
  const gv = buildGov(gov, gov.policy, gov.policy, input.authors ?? [], unreadable);
  const ids = input.change?.ids ?? [];
  const reviews = [];
  for (const rv of input.reviews ?? []) {
    if (rv.change && !ids.includes(rv.change)) continue;
    reviews.push({
      actor: gv.byIdentity.get(String(rv.identity ?? "").trim()) ?? null,
      identity: String(rv.identity ?? "").trim(),
      line: String(rv.line ?? "").trim(),
      change: rv.change ?? null,
      ref: `review:${H(rv).slice(7, 23)}`
    });
  }
  const mid = unreadable ? null : gov.shape.manifest;
  const auth = (r) => !!mid && !!r && r.manifestSigners.includes(mid);
  const pBase = new Set(
    (input.persisted?.base ?? []).map((p) => {
      const r = parseRecord(p.record);
      return r.error ? "" : r.id;
    })
  );
  const recs = [...(input.records ?? []), ...(input.persisted?.head ?? []).map((p) => p.record)];
  return {
    unsupported: null,
    kcase: {
      contract: "shape.kernel.case/v1",
      mode: input.mode,
      now,
      change: input.change,
      authors: [...gv.authors],
      unmappedBot: gv.unmappedBot,
      head: { revision: v.head.revision, esf: head, manifest: input.head.manifest, manifestAuthenticated: auth(v.head) },
      base: !hasBase
        ? null
        : {
            revision: v.base.revision,
            esf: unreadable ? null : base,
            manifest: input.base.manifest,
            manifestAuthenticated: auth(v.base)
          },
      records: records(recs, rejected, pBase),
      reviews,
      baseRecords: records(input.baseRecords, rejected, new Set()),
      inputDigest: ts.inputDigest,
      rejected: ts.rejected ?? [],
      clockClamped: ts.health?.clockClamped ?? false,
      options: input.options ?? { health: true, teeth: false }
    }
  };
}

const FIELDS = [
  "kind",
  "severity",
  "tier",
  "force",
  "reason",
  "introduced",
  "binding",
  "exploited",
  "exception",
  "group"
];

const fixtures = [
  ...["audit", "empty-base", "A", "B", "B-weak", "Bprime", "Bsecond", "C", "C-answered"].map(
    (v) => [`ex1 ${v}`, () => F.ex1(v)]
  ),
  ["ex2", () => F.ex2()],
  ["ex2 exception+approve", () => F.ex2({ exception: true, approve: true })],
  ["ex2 approve", () => F.ex2({ approve: true })],
  ["ex2 exception", () => F.ex2({ exception: true })],
  ["ex2 hostMarkers", () => F.ex2({ hostMarkers: true })],
  ["ex3", () => F.ex3()],
  ["ex3 judgeLine", () => F.ex3({ judgeLine: true })],
  ["ex4", () => F.ex4()],
  ["ex4 complete", () => F.ex4({ complete: true })],
  ["ex4 complete+diagnostics", () => F.ex4({ complete: true, headDiagnostics: true })],
  ["ex3s2", () => F.ex3s2()],
  ["ex3s2 harnessEdited", () => F.ex3s2({ harnessEdited: true })],
  ["ex3s2 dropRecord", () => F.ex3s2({ dropRecord: true })],
  ["ex3s2 seededClock", () => F.ex3s2({ seededClock: true })],
  ["ex3s2 removeRefactorSensitive", () => F.ex3s2({ removeRefactorSensitive: true })]
];

let agreeCases = 0;
let byteEqual = 0;
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
  const { kcase, unsupported } = kernelCase(input, ts);
  if (!kcase) {
    report.push(`SKIP  ${name}: ${unsupported}`);
    continue;
  }
  const run = spawnSync(exe, [], { input: JSON.stringify(kcase) });
  let lean;
  try {
    lean = JSON.parse(run.stdout.toString());
  } catch {
    report.push(`${name}: kernel output unparsable ${run.stdout.toString().slice(0, 200)}`);
    continue;
  }
  const bytesEqual = run.stdout.toString() === coreBytes(ts);
  if (bytesEqual) byteEqual += 1;
  const diffs = [];
  if (ts.verdict !== lean.verdict) diffs.push(`verdict ts=${ts.verdict} lean=${lean.verdict}`);
  const tsErr = (ts.errors ?? [])
    .map((e) => e.code)
    .sort()
    .join(",");
  const leanErr = (lean.errors ?? [])
    .map((e) => e.code)
    .sort()
    .join(",");
  if (tsErr !== leanErr) diffs.push(`errors ts=[${tsErr}] lean=[${leanErr}]`);
  const tsObs = new Map((ts.obligations ?? []).map((o) => [o.key, o]));
  const leanObs = new Map((lean.obligations ?? []).map((o) => [o.key, o]));
  for (const [k, o] of tsObs) {
    const l = leanObs.get(k);
    if (!l) {
      diffs.push(
        `only ts: ${o.kind} ${k.slice(0, 19)} ${JSON.stringify(o.subject)} ${o.reason ?? ""}`
      );
      continue;
    }
    for (const f of FIELDS) {
      fieldTotal += 1;
      if (JSON.stringify(o[f] ?? null) === JSON.stringify(l[f] ?? null)) fieldAgree += 1;
      else
        diffs.push(
          `${k.slice(0, 19)} ${f} ts=${JSON.stringify(o[f])} lean=${JSON.stringify(l[f])}`
        );
    }
  }
  for (const [k, o] of leanObs)
    if (!tsObs.has(k))
      diffs.push(
        `only lean: ${o.kind} ${k.slice(0, 19)} ${JSON.stringify(o.subject)} ${o.reason ?? ""}`
      );
  const tsAns = (ts.answered ?? [])
    .map((a) => a.obligation)
    .sort()
    .join(",");
  const leanAns = (lean.answered ?? [])
    .map((a) => a.obligation)
    .sort()
    .join(",");
  if (tsAns !== leanAns)
    diffs.push(`answered ts=[${tsAns.slice(0, 60)}] lean=[${leanAns.slice(0, 60)}]`);
  if (unsupported) diffs.push(`(review line not bridged: ${unsupported})`);
  if (diffs.length === 0) agreeCases += 1;
  report.push(
    `${diffs.length === 0 ? "AGREE" : "DIFF "} ${name} (ts ${tsObs.size} obligations, lean ${leanObs.size}; core bytes ${bytesEqual ? "identical" : "differ"})`
  );
  for (const d of diffs) report.push(`      ${d}`);
}
console.log(report.join("\n"));
console.log(
  `cases agreeing: ${agreeCases}/${fixtures.length}; byte-identical core output: ${byteEqual}/${fixtures.length}; shared-obligation fields agreeing: ${fieldAgree}/${fieldTotal}`
);
