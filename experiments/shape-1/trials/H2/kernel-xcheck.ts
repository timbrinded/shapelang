// @ts-nocheck
// Differential check of selected H2 drift runs against the Lean kernel (shapek): converts each
// dumped prototype CheckInput into a shape.kernel.case/v1 exactly as kernel/test/bridge.ts does
// (prototype as pre-pass: elaboration, authors*, cells), runs both checkers, and compares the
// verdict, error codes and the introduced obligations (key, kind, severity, force, reason).
//   bun experiments/shape-1/trials/H2/kernel-xcheck.ts <shapek> <input.json>...
//   bun experiments/shape-1/trials/H2/kernel-xcheck.ts --emit <case.json> <input.json>
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { derive } from "../../proto/src/derive.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { buildGov } from "../../proto/src/governance.ts";
import { computeCells } from "../../proto/src/globs.ts";
import { mergeRecords, parseRecord } from "../../proto/src/records.ts";
import { toSeconds } from "../../proto/src/util.ts";

const [exe, ...files] = process.argv.slice(2);
// `--emit <out.json> <input.json>`: write the kernel case only (to time shapek separately)
if (exe === "--emit") {
  const { writeFileSync } = await import("node:fs");
  const [out, inp] = files;
  writeFileSync(out, JSON.stringify(kernelCase(JSON.parse(readFileSync(inp, "utf8")))));
  process.exit(0);
}

function records(list) {
  const parsed = [];
  for (const x of list ?? []) {
    const r = parseRecord(x);
    if (!r.error) parsed.push(r);
  }
  return mergeRecords(parsed).map((r) => ({ id: r.id, predicate: { shape: r.shape }, authenticated: r.signers.length > 0 }));
}

/** copied from kernel/test/bridge.ts (not exported there) */
function kernelCase(input) {
  const now = toSeconds(input.now);
  const head = elaborate(input.head.source, { now });
  const base = input.base?.source ? elaborate(input.base.source, { lenient: true, now }) : null;
  const gov = input.mode === "audit" || !base ? head : base;
  const gv = buildGov(gov, gov.policy, input.authors ?? []);
  const owners = [];
  if (base && input.mode !== "audit") {
    for (const c of base.components) for (const g of c.paths) owners.push({ side: "b", glob: g, owner: `${c.q}.*` });
    for (const c of head.components) for (const g of c.paths) owners.push({ side: "h", glob: g, owner: `${c.q}.*` });
  }
  const cells = owners.length ? computeCells(owners).cells.filter((c) => typeof c.b === "string" && typeof c.h === "string").map((c) => [c.b, c.h]) : [];
  return {
    contract: "shape.kernel.case/v1",
    mode: input.mode,
    now: Math.max(now, input.base?.committerTime ? toSeconds(input.base.committerTime) : now),
    change: input.change,
    authors: [...gv.authors],
    unmappedBot: gv.unmappedBot,
    head: { revision: input.head.revision, esf: head, manifest: input.head.manifest },
    base: input.mode === "audit" || !input.base ? null : { revision: input.base.revision, esf: base ?? { shape: { q: "", owner: "" } }, manifest: input.base.manifest },
    cells,
    records: records(input.records),
    reviews: [],
    baseRecords: records(input.baseRecords)
  };
}

const sig = (o) => `${o.kind}|${o.severity}|${o.force}|${o.reason}`;
for (const f of files) {
  const input = JSON.parse(readFileSync(f, "utf8"));
  const t0 = performance.now();
  const ts = derive(input);
  const t1 = performance.now();
  const run = spawnSync(exe, [], { input: JSON.stringify(kernelCase(input)), maxBuffer: 1 << 30 });
  const t2 = performance.now();
  let lean;
  try {
    lean = JSON.parse(run.stdout.toString());
  } catch {
    process.stdout.write(`${basename(f)}: kernel output unparsable (exit ${run.status}) ${run.stdout.toString().slice(0, 200)} ${run.stderr.toString().slice(0, 300)}\n`);
    continue;
  }
  const tsI = new Map(ts.obligations.filter((o) => o.introduced).map((o) => [o.key, o]));
  const leanI = new Map((lean.obligations ?? []).filter((o) => o.introduced).map((o) => [o.key, o]));
  const onlyTs = [...tsI.keys()].filter((k) => !leanI.has(k));
  const onlyLean = [...leanI.keys()].filter((k) => !tsI.has(k));
  const fieldDiff = [...tsI.keys()].filter((k) => leanI.has(k) && sig(tsI.get(k)) !== sig(leanI.get(k)));
  const errTs = ts.errors.map((e) => e.code).sort().join(",");
  const errLean = (lean.errors ?? []).map((e) => e.code).sort().join(",");
  process.stdout.write(
    `${basename(f)}: verdict ts=${ts.verdict} lean=${lean.verdict}; errors ts=[${errTs}] lean=[${errLean}]; introduced ts=${tsI.size} lean=${leanI.size} shared=${tsI.size - onlyTs.length} fieldDiffs=${fieldDiff.length}; ` +
      `all obligations ts=${ts.obligations.length} lean=${(lean.obligations ?? []).length}; derive ${((t1 - t0) / 1000).toFixed(1)} s, shapek ${((t2 - t1) / 1000).toFixed(1)} s\n` +
      onlyTs.map((k) => `   only-ts  ${tsI.get(k).kind} ${tsI.get(k).claim?.ids?.[0] ?? JSON.stringify(tsI.get(k).subject)}\n`).join("") +
      onlyLean.map((k) => `   only-lean ${leanI.get(k).kind} ${leanI.get(k).claim?.ids?.[0] ?? JSON.stringify(leanI.get(k).subject)}\n`).join("") +
      fieldDiff.map((k) => `   field ${tsI.get(k).claim?.ids?.[0]}: ts ${sig(tsI.get(k))} lean ${sig(leanI.get(k))}\n`).join("")
  );
}
