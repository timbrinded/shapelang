// @ts-nocheck
// DRT7 differential gate (A.11.2.4 [D23]): runs the version 7 prototype and the Lean kernel on
// every case of a list and reports the residual: cases whose core outputs (shape.check.output/v1,
// JCS bytes, A.16.31) are not byte-identical, with no normalisation and no patch flags. Cases the
// kernel rejects as outside its fragment (exit 3, shape.kernel.rejected/v1) are counted apart with
// their reasons; inputs the pre-pass finds invalid are not kernel cases (A.11.2.1) and are counted
// apart too.
//
//   bun gate7.ts run --list <cases.tsv> --shapek <shapek> --rows <rows.jsonl>
//       [--shard i/n] [--timeout ms] [--save <dir>]
//   bun gate7.ts report --out <report.json> [--text <report.txt>] <rows.jsonl>...
//
// cases.tsv: one case per line, "<id>\t<set>\t<source>", source being an input file or
// "vector:<vector dir>#<case name>" (an M0 vector case, its input inline or a file).
// A row per case: {id, set, src, status, sigs, details, reasons, verdicts, exitOk, harness,
// features, tsMs, kMs}. status is identical | residual | out-of-fragment | prepass-invalid |
// kernel-malformed | kernel-timeout | kernel-error | proto-error. --save keeps, for every case
// that is not identical, <id>.kcase.json, <id>.ts.json (prototype core output) and
// <id>.kernel.txt (kernel stdout) for triage.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { derive } from "../../proto/src/derive.ts";
import { jcs } from "../../proto/src/jcs.ts";
import { coreBytes } from "../../proto/src/render.ts";
import { diffSignatures, primary } from "./compare7.ts";
import { convert } from "./convert.ts";
import { DECISIONS, features } from "./features7.ts";

function arg(argv, k, d = null) {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
}

function readCase(src) {
  if (src.startsWith("vector:")) {
    const [dir, name] = src.slice(7).split("#");
    const e = JSON.parse(readFileSync(`${dir}/expected.json`, "utf8"));
    const c = e.cases.find((x) => x.case === name);
    if (!c) throw new Error(`no case ${name} in ${dir}`);
    return typeof c.input === "string"
      ? JSON.parse(readFileSync(resolve(dir, c.input), "utf8"))
      : c.input;
  }
  return JSON.parse(readFileSync(src, "utf8"));
}

function runOne(id, set, src, shapek, timeout, save) {
  const row = {
    id,
    set,
    src,
    status: "",
    sigs: [],
    details: {},
    reasons: [],
    verdicts: {},
    exitOk: null,
    harness: [],
    features: [],
    tsMs: 0,
    kMs: 0
  };
  let input;
  try {
    input = readCase(src);
  } catch (e) {
    row.status = "proto-error";
    row.reasons = [`unreadable: ${String(e).slice(0, 200)}`];
    return row;
  }
  let out;
  let core;
  const t0 = performance.now();
  try {
    out = derive(input);
    core = coreBytes(out);
  } catch (e) {
    row.status = "proto-error";
    row.reasons = [`derive threw: ${String(e?.stack ?? e).slice(0, 400)}`];
    return row;
  }
  row.tsMs = Math.round(performance.now() - t0);
  row.verdicts.ts = out.verdict;
  let cv;
  try {
    cv = convert(input);
  } catch (e) {
    row.status = "kernel-error";
    row.reasons = [`converter threw: ${String(e?.stack ?? e).slice(0, 400)}`];
    return row;
  }
  if (cv.kind !== "case") {
    row.status = "prepass-invalid";
    row.reasons = cv.problems.slice(0, 5);
    if (out.verdict !== "invalid")
      row.harness.push(`prepass invalid but derive verdict ${out.verdict}`);
    return row;
  }
  const k = cv.kcase;
  if (out.verdict === "invalid")
    row.harness.push("derive invalid but the pre-pass accepts the input");
  if (k.inputDigest !== out.inputDigest) row.harness.push("inputDigest differs from derive's");
  if (jcs(k.rejected) !== jcs(out.rejected ?? []))
    row.harness.push("rejected differs from derive's");
  if (
    out.health &&
    typeof out.health.clockClamped === "boolean" &&
    out.health.clockClamped !== k.clockClamped
  )
    row.harness.push("clockClamped differs from derive's");
  if (set === "fragment" || set === "clean") row.features = features(input, cv.pp, out);
  const caseText = JSON.stringify(k);
  const t1 = performance.now();
  const r = spawnSync(shapek, [], { input: caseText, maxBuffer: 1 << 30, timeout });
  row.kMs = Math.round(performance.now() - t1);
  const kout = r.stdout?.toString() ?? "";
  const keep = () => {
    if (!save) return;
    writeFileSync(`${save}/${id}.kcase.json`, caseText);
    writeFileSync(`${save}/${id}.ts.json`, core);
    writeFileSync(`${save}/${id}.kernel.txt`, kout);
  };
  if (r.error || r.signal) {
    row.status =
      r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM" ? "kernel-timeout" : "kernel-error";
    row.reasons = [String(r.error ?? r.signal).slice(0, 200)];
    keep();
    return row;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(kout);
  } catch {
    parsed = null;
  }
  if (r.status === 3 || r.status === 2) {
    row.status = r.status === 3 ? "out-of-fragment" : "kernel-malformed";
    row.reasons = parsed?.reasons ?? [kout.slice(0, 200)];
    keep();
    return row;
  }
  if (!parsed || (r.status !== 0 && r.status !== 1)) {
    row.status = "kernel-error";
    row.reasons = [`exit ${r.status}: ${kout.slice(0, 200)} ${r.stderr?.toString().slice(0, 200)}`];
    keep();
    return row;
  }
  row.verdicts.kernel = parsed.verdict;
  row.exitOk = (r.status === 1) === (parsed.verdict === "blocked");
  if (kout === core) {
    row.status = "identical";
    return row;
  }
  row.status = "residual";
  const ds = diffSignatures(JSON.parse(core), parsed);
  for (const d of ds) {
    if (!row.sigs.includes(d.sig)) row.sigs.push(d.sig);
    if (!(d.sig in row.details) && Object.keys(row.details).length < 16)
      row.details[d.sig] = d.detail;
  }
  row.sigs.sort();
  keep();
  return row;
}

function cmdRun(argv) {
  const list = arg(argv, "list");
  const shapek = arg(argv, "shapek");
  const rows = arg(argv, "rows");
  const timeout = Number(arg(argv, "timeout", "600000"));
  const save = arg(argv, "save");
  const shard = (arg(argv, "shard", "0/1") ?? "0/1").split("/").map(Number);
  if (!list || !shapek || !rows) throw new Error("run needs --list, --shapek and --rows");
  if (save) mkdirSync(save, { recursive: true });
  const done = new Set();
  if (existsSync(rows))
    for (const l of readFileSync(rows, "utf8").split("\n").filter(Boolean))
      done.add(JSON.parse(l).id);
  const lines = readFileSync(list, "utf8").split("\n").filter(Boolean);
  lines.forEach((line, j) => {
    if (j % shard[1] !== shard[0]) return;
    const [id, set, src] = line.split("\t");
    if (done.has(id)) return;
    const row = runOne(id, set, src, shapek, timeout, save);
    appendFileSync(rows, `${JSON.stringify(row)}\n`);
  });
}

const STATUSES = [
  "identical",
  "residual",
  "out-of-fragment",
  "prepass-invalid",
  "kernel-malformed",
  "kernel-timeout",
  "kernel-error",
  "proto-error"
];

function stats(xs) {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    total: s.reduce((a, b) => a + b, 0),
    mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    p50: q(0.5),
    p99: q(0.99),
    max: s.at(-1)
  };
}

function cmdReport(argv) {
  const outPath = arg(argv, "out");
  const textPath = arg(argv, "text");
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) i += 1;
    else files.push(argv[i]);
  }
  const rows = [];
  for (const f of files)
    for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) rows.push(JSON.parse(l));
  const byId = new Map();
  for (const r of rows) byId.set(r.id, r);
  const all = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const sets = [...new Set(all.map((r) => r.set))].sort();
  const count = (rs) =>
    Object.fromEntries(STATUSES.map((s) => [s, rs.filter((r) => r.status === s).length]));
  const perSet = Object.fromEntries(
    sets.map((s) => [
      s,
      { cases: all.filter((r) => r.set === s).length, ...count(all.filter((r) => r.set === s)) }
    ])
  );
  const residual = all.filter((r) => r.status === "residual");
  const clusters = new Map();
  for (const r of residual)
    for (const s of r.sigs) {
      const c = clusters.get(s) ?? { sig: s, cases: 0, sets: {}, examples: [], detail: null };
      c.cases += 1;
      c.sets[r.set] = (c.sets[r.set] ?? 0) + 1;
      if (c.examples.length < 4) c.examples.push(r.id);
      if (!c.detail && r.details[s]) c.detail = r.details[s];
      clusters.set(s, c);
    }
  const prim = new Map();
  for (const r of residual) {
    const p = primary(r.sigs);
    const c = prim.get(p) ?? {
      sig: p,
      cases: 0,
      sets: {},
      examples: [],
      detail: r.details[p] ?? null
    };
    c.cases += 1;
    c.sets[r.set] = (c.sets[r.set] ?? 0) + 1;
    if (c.examples.length < 4) c.examples.push(r.id);
    prim.set(p, c);
  }
  const reasons = new Map();
  for (const r of all.filter(
    (x) => x.status === "out-of-fragment" || x.status === "kernel-malformed"
  ))
    for (const why of r.reasons) {
      const k = `${r.status}: ${why.replace(/[0-9a-f]{16,}/g, "…").slice(0, 160)}`;
      const c = reasons.get(k) ?? { reason: k, cases: 0, sets: {}, examples: [] };
      c.cases += 1;
      c.sets[r.set] = (c.sets[r.set] ?? 0) + 1;
      if (c.examples.length < 4) c.examples.push(r.id);
      reasons.set(k, c);
    }
  const corpus = all.filter((r) => r.set === "fragment" || r.set === "clean");
  const coverage = Object.fromEntries(
    DECISIONS.map((d) => [
      d,
      {
        cases: corpus.filter((r) => r.features.includes(d)).length,
        fragment: corpus.filter((r) => r.set === "fragment" && r.features.includes(d)).length,
        clean: corpus.filter((r) => r.set === "clean" && r.features.includes(d)).length
      }
    ])
  );
  const harness = all
    .filter((r) => r.harness.length > 0)
    .map((r) => ({ id: r.id, harness: r.harness }));
  const notCompared = all.filter(
    (r) => !["identical", "residual", "out-of-fragment", "prepass-invalid"].includes(r.status)
  );
  const report = {
    contract: "drt7.gate.report/v1",
    cases: all.length,
    totals: count(all),
    perSet,
    gate: {
      residual: residual.length,
      outOfFragment: all.filter((r) => r.status === "out-of-fragment").length,
      kernelFailures: notCompared.length,
      prepassInvalid: all.filter((r) => r.status === "prepass-invalid").length,
      zeroResidual: residual.length === 0 && notCompared.length === 0
    },
    exitCodeMismatches: all.filter((r) => r.exitOk === false).map((r) => r.id),
    harnessCheckFailures: harness,
    outOfFragmentReasons: [...reasons.values()].sort((a, b) => b.cases - a.cases),
    primaryClusters: [...prim.values()].sort(
      (a, b) => b.cases - a.cases || (a.sig < b.sig ? -1 : 1)
    ),
    signatureClusters: [...clusters.values()].sort(
      (a, b) => b.cases - a.cases || (a.sig < b.sig ? -1 : 1)
    ),
    coverage,
    coverageThreshold: 100,
    coverageMet: DECISIONS.every((d) => coverage[d].cases >= 100),
    timing: {
      protoMs: stats(all.map((r) => r.tsMs).filter((x) => x > 0)),
      kernelMs: stats(all.filter((r) => r.kMs > 0).map((r) => r.kMs))
    },
    notCompared: notCompared.map((r) => ({
      id: r.id,
      set: r.set,
      status: r.status,
      reasons: r.reasons
    }))
  };
  writeFileSync(outPath, `${JSON.stringify(report, null, 1)}\n`);
  if (textPath) {
    const L = [];
    L.push(
      `DRT7 gate: ${all.length} cases; residual ${residual.length}; out of fragment ${report.gate.outOfFragment}; kernel failures ${notCompared.length}; pre-pass invalid ${report.gate.prepassInvalid}; zero residual: ${report.gate.zeroResidual}`
    );
    L.push("");
    L.push(
      "per set: cases identical residual out-of-fragment prepass-invalid malformed timeout kernel-error proto-error"
    );
    for (const s of sets) {
      const p = perSet[s];
      L.push(
        `  ${s.padEnd(12)} ${String(p.cases).padStart(5)} ${String(p.identical).padStart(5)} ${String(p.residual).padStart(5)} ${String(p["out-of-fragment"]).padStart(5)} ${String(p["prepass-invalid"]).padStart(5)} ${String(p["kernel-malformed"]).padStart(5)} ${String(p["kernel-timeout"]).padStart(5)} ${String(p["kernel-error"]).padStart(5)} ${String(p["proto-error"]).padStart(5)}`
      );
    }
    L.push("");
    L.push("coverage (corpus cases per decision; threshold 100):");
    for (const d of DECISIONS)
      L.push(
        `  ${d.padEnd(4)} ${String(coverage[d].cases).padStart(5)}  (fragment ${coverage[d].fragment}, clean ${coverage[d].clean})`
      );
    L.push("");
    L.push("out-of-fragment and malformed reasons:");
    for (const c of report.outOfFragmentReasons)
      L.push(`  ${String(c.cases).padStart(5)}  ${c.reason}  e.g. ${c.examples.join(", ")}`);
    L.push("");
    L.push("primary clusters (each residual case once):");
    for (const c of report.primaryClusters)
      L.push(
        `  ${String(c.cases).padStart(5)}  ${c.sig}  ${JSON.stringify(c.sets)}  e.g. ${c.examples.join(", ")}${c.detail ? `\n         ${JSON.stringify(c.detail).slice(0, 300)}` : ""}`
      );
    L.push("");
    L.push("signature clusters (a case in every cluster it shows):");
    for (const c of report.signatureClusters.slice(0, 80))
      L.push(`  ${String(c.cases).padStart(5)}  ${c.sig}  e.g. ${c.examples.join(", ")}`);
    L.push("");
    L.push(
      `harness check failures: ${harness.length}; exit-code mismatches: ${report.exitCodeMismatches.length}`
    );
    L.push(
      `timing: proto ${JSON.stringify(report.timing.protoMs)}; kernel ${JSON.stringify(report.timing.kernelMs)}`
    );
    writeFileSync(textPath, `${L.join("\n")}\n`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "run") cmdRun(rest);
else if (cmd === "report") cmdReport(rest);
else {
  process.stderr.write("usage: bun gate7.ts run|report ... (see the header)\n");
  process.exit(2);
}
