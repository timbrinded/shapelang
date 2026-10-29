// @ts-nocheck
// H5 differential check against the Lean kernel (shapek): converts dumped prototype CheckInputs
// (replay.ts --dump-inputs) into shape.kernel.case/v1 exactly as kernel/test/bridge.ts does (the
// prototype as pre-pass: elaboration, authors*, cells), runs both checkers and compares the verdict,
// error codes and every obligation (key; kind, severity, introduced, force, reason).
//   bun experiments/shape-1/trials/H5/kernel-xcheck.ts [--raw] [--timeout s] <shapek> <input.json>... > report.txt
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { derive } from "../../proto/src/derive.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { buildGov } from "../../proto/src/governance.ts";
import { computeCells } from "../../proto/src/globs.ts";
import { mergeRecords, parseRecord } from "../../proto/src/records.ts";
import { toSeconds } from "../../proto/src/util.ts";

// Records the prototype rejected (RJ01-RJ14 validation, part of the pre-pass the kernel spec assigns
// outside the kernel) are dropped before the kernel sees them; --raw keeps them (bridge.ts behaviour).
const RAW = process.argv.includes("--raw");
let REJECTED = new Set<string>();
function records(list) {
  const parsed = [];
  for (const x of list ?? []) {
    const r = parseRecord(x);
    if (!r.error) parsed.push(r);
  }
  return mergeRecords(parsed)
    .filter((r) => RAW || !REJECTED.has(r.id))
    .map((r) => ({ id: r.id, predicate: { shape: r.shape }, authenticated: r.signers.length > 0 }));
}

/** as kernel/test/bridge.ts (copied there by trials/H2/kernel-xcheck.ts) */
function kernelCase(input) {
  const now = toSeconds(input.now);
  const head = elaborate(input.head.source, { now });
  const base = input.base?.source ? elaborate(input.base.source, { lenient: true, now }) : null;
  const gov = input.mode === "audit" || !base ? head : base;
  const gv = buildGov(gov, gov.policy, input.authors ?? []);
  const owners = [];
  if (base && input.mode !== "audit") {
    for (const c of base.components)
      for (const g of c.paths) owners.push({ side: "b", glob: g, owner: `${c.q}.*` });
    for (const c of head.components)
      for (const g of c.paths) owners.push({ side: "h", glob: g, owner: `${c.q}.*` });
  }
  const cells = owners.length
    ? computeCells(owners)
        .cells.filter((c) => typeof c.b === "string" && typeof c.h === "string")
        .map((c) => [c.b, c.h])
    : [];
  return {
    contract: "shape.kernel.case/v1",
    mode: input.mode,
    now: Math.max(now, input.base?.committerTime ? toSeconds(input.base.committerTime) : now),
    change: input.change,
    authors: [...gv.authors],
    unmappedBot: gv.unmappedBot,
    head: { revision: input.head.revision, esf: head, manifest: input.head.manifest },
    base:
      input.mode === "audit" || !input.base
        ? null
        : {
            revision: input.base.revision,
            esf: base ?? { shape: { q: "", owner: "" } },
            manifest: input.base.manifest
          },
    cells,
    records: records(input.records),
    reviews: [],
    baseRecords: records(input.baseRecords)
  };
}

const argv = process.argv.slice(2);
const ti = argv.indexOf("--timeout");
const TIMEOUT_MS = ti >= 0 ? Number(argv[ti + 1]) * 1000 : 0;
if (ti >= 0) argv.splice(ti, 2);
const [exe, ...files] = argv.filter((a) => a !== "--raw");
let timedOut = 0;
const sig = (o) => `${o.kind}|${o.severity}|${o.introduced}|${o.force}|${o.reason}`;
let agree = 0;
let n = 0;
let tsMs = 0;
let leanMs = 0;
let obs = 0;
for (const f of files) {
  const input = JSON.parse(readFileSync(f, "utf8"));
  const t0 = performance.now();
  const ts = derive(input);
  const t1 = performance.now();
  REJECTED = new Set((ts.rejected ?? []).map((r) => r.record));
  const run = spawnSync(exe, [], {
    input: JSON.stringify(kernelCase(input)),
    maxBuffer: 1 << 30,
    ...(TIMEOUT_MS ? { timeout: TIMEOUT_MS } : {})
  });
  const t2 = performance.now();
  if (run.error || run.signal) {
    timedOut += 1;
    process.stdout.write(
      `TIMEOUT ${basename(f)}: shapek stopped after ${((t2 - t1) / 1000).toFixed(0)} s (${run.signal ?? run.error})\n`
    );
    continue;
  }
  tsMs += t1 - t0;
  leanMs += t2 - t1;
  n += 1;
  let lean;
  try {
    lean = JSON.parse(run.stdout.toString());
  } catch {
    process.stdout.write(
      `${basename(f)}: kernel output unparsable (exit ${run.status}) ${run.stdout.toString().slice(0, 200)} ${run.stderr.toString().slice(0, 300)}\n`
    );
    continue;
  }
  const tsO = new Map(ts.obligations.map((o) => [o.key, o]));
  const leanO = new Map((lean.obligations ?? []).map((o) => [o.key, o]));
  const onlyTs = [...tsO.keys()].filter((k) => !leanO.has(k));
  const onlyLean = [...leanO.keys()].filter((k) => !tsO.has(k));
  const fieldDiff = [...tsO.keys()].filter(
    (k) => leanO.has(k) && sig(tsO.get(k)) !== sig(leanO.get(k))
  );
  const errTs = ts.errors
    .map((e) => e.code)
    .sort()
    .join(",");
  const errLean = (lean.errors ?? [])
    .map((e) => e.code)
    .sort()
    .join(",");
  const same =
    ts.verdict === lean.verdict &&
    errTs === errLean &&
    onlyTs.length === 0 &&
    onlyLean.length === 0 &&
    fieldDiff.length === 0;
  if (same) agree += 1;
  obs += tsO.size;
  process.stdout.write(
    `${same ? "AGREE" : "DIFFER"} ${basename(f)}: verdict ts=${ts.verdict} lean=${lean.verdict}; errors ts=[${errTs}] lean=[${errLean}]; obligations ts=${tsO.size} lean=${leanO.size} shared=${tsO.size - onlyTs.length} fieldDiffs=${fieldDiff.length}\n` +
      onlyTs
        .map(
          (k) =>
            `   only-ts  ${sig(tsO.get(k))} ${tsO.get(k).claim?.ids?.[0]} ${JSON.stringify(tsO.get(k).subject)}\n`
        )
        .join("") +
      onlyLean
        .map((k) => `   only-lean ${sig(leanO.get(k))} ${JSON.stringify(leanO.get(k).subject)}\n`)
        .join("") +
      fieldDiff
        .map(
          (k) =>
            `   field ${tsO.get(k).claim?.ids?.[0]}: ts ${sig(tsO.get(k))} lean ${sig(leanO.get(k))}\n`
        )
        .join("")
  );
}
process.stdout.write(
  `TOTAL ${agree}/${n - timedOut} cases agree (${timedOut} timed out) (verdict, errors, every obligation's key, kind, severity, introduced, force, reason); ${obs} prototype obligations compared; derive ${(tsMs / 1000).toFixed(1)} s, shapek ${(leanMs / 1000).toFixed(1)} s\n`
);
