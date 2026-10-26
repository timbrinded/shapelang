// @ts-nocheck
// H3 dogfood arm, step 2: derive each screened mutant and each dogfood refactor as a change
// against Shape's own 1.0 model, with every dogfood provider re-run at head (bunTest, tsClockScan,
// tsCalls) -- regime R1c -- under the stock prototype and the V-new introduced rule.
//   bun experiments/shape-1/trials/H3/dogfood-run.ts prep --work <dir>
//   bun experiments/shape-1/trials/H3/dogfood-run.ts run --work <dir> --screen <screen.json> [--per 2] [--shard i/n]
// Rows go to <work>/dog-rows-<i>of<n>.jsonl.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { derive } from "../../proto/src/derive.ts";
import { runLaws } from "../../dogfood/providers/bun-test.ts";
import { callScan } from "../../dogfood/providers/ts-calls.ts";
import { clockScan } from "../../dogfood/providers/ts-clock-scan.ts";
import { composeModel, manifestFor, materialize, readOverlay, treeFiles } from "../../dogfood/tools/lib.ts";
import { applyMutant } from "../../proto/providers/laws/mutate.ts";
import { DOG_REFACTORS } from "./dogfood-refactors.ts";
import { compact } from "./lib.ts";
import { buildVariant } from "./variant-checker.ts";

const NOW = "2026-10-26T00:00:00Z";

/** An exact unique replacement [from, to], or a word rename inside one function's braces. */
export function applyEdit(id: string, text: string, e): string {
  if (Array.isArray(e)) {
    const [from, to] = e;
    if (text.split(from).length !== 2) throw new Error(`${id}: anchor not unique or missing: ${from.slice(0, 60)}`);
    return text.replace(from, to);
  }
  const i = text.indexOf(e.renameIn);
  if (i < 0 || text.indexOf(e.renameIn, i + 1) >= 0) throw new Error(`${id}: function anchor not unique or missing`);
  const open = text.indexOf(") {\n", i) >= 0 ? text.indexOf("{", text.indexOf(")", text.indexOf("(", i))) : -1;
  let depth = 0;
  let j = open;
  for (; j < text.length; j += 1) {
    if (text[j] === "{") depth += 1;
    else if (text[j] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = text.slice(i, j + 1);
  const re = new RegExp(`\\b${e.from}\\b`, "g");
  if (!re.test(body)) throw new Error(`${id}: ${e.from} not in function`);
  if (new RegExp(`\\b${e.to}\\b`).test(body)) throw new Error(`${id}: ${e.to} already used`);
  return text.slice(0, i) + body.replace(re, e.to) + text.slice(j + 1);
}
const AUTHORS = [
  { identity: 'github("timbrinded")', verified: true, bot: false },
  { identity: 'github("claude[bot]")', verified: true, bot: true }
];
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k: string, d?: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const work = resolve(opt("work", "h3-dog"));
mkdirSync(join(work, "trees"), { recursive: true });

async function providers(dir: string, manifest, source) {
  const clock = await clockScan({ root: dir, manifest, now: NOW });
  const calls = await callScan({ root: dir, manifest, now: NOW });
  const laws = await runLaws({ root: dir, manifest, source, now: NOW });
  return { clock, calls, laws };
}

if (cmd === "prep") {
  const t0 = performance.now();
  const dir = materialize("HEAD", join(work, "trees", "base"));
  const m = await manifestFor(treeFiles(dir));
  const overlay = readOverlay();
  const source = composeModel(m.statement, overlay, dir).source;
  const p = await providers(dir, m.statement, source);
  const base = {
    revision: m.revision,
    manifest: m.statement,
    source,
    overlay,
    baseRecords: [p.clock.envelope, p.calls.envelope, ...p.laws.records.map((r) => r.envelope)],
    lawVerdicts: p.laws.verdicts.map((v) => ({ law: v.law, holds: v.holds }))
  };
  writeFileSync(join(work, "base.json"), JSON.stringify(base));
  rmSync(dir, { recursive: true, force: true });
  process.stdout.write(`base ${m.revision}: ${base.baseRecords.length} records, ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);
  process.exit(0);
}

if (cmd !== "run") throw new Error("usage: dogfood-run.ts prep|run ...");
const base = JSON.parse(readFileSync(join(work, "base.json"), "utf8"));
const vderive = (await import(buildVariant())).derive;

// variants: screened mutants the law test kills (at most --per per law and location, deduplicated)
// plus the refactors in dogfood-refactors.ts
const per = Number(opt("per", "2"));
const variants = [];
if (opt("screen")) {
  // --screen takes a comma list of screen files; their per-law entries are merged
  const screen = opt("screen").split(",").flatMap((f) => JSON.parse(readFileSync(f, "utf8")));
  const seen = new Set();
  for (const l of screen) {
    for (const where of ["unit", "callee", "import"]) {
      let k = 0;
      for (const c of l.candidates ?? []) {
        if (c.where !== where || !c.killed || k >= per) continue;
        const path = c.path ?? l.path;
        const key = `${path}|${c.mutant.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        k += 1;
        variants.push({ id: `M-${l.law.split("::")[1]}-${where}-${k}`, kind: "mutant", where, law: l.law, at: c.at, path, mutant: c.mutant });
      }
    }
  }
}
for (const r of DOG_REFACTORS) variants.push({ id: r.id, kind: "refactor", where: r.where, law: r.law, at: r.at, path: r.path, edits: r.edits, note: r.note });
const only = opt("only") ? new Set(opt("only").split(",")) : null;
const [si, sn] = (opt("shard") ?? "0/1").split("/").map(Number);
const list = variants.filter((v) => !only || only.has(v.id)).filter((_, i) => i % sn === si);
const outPath = join(work, `dog-rows-${si}of${sn}.jsonl`);
process.stderr.write(`${variants.length} variants; this shard ${list.length}\n`);

for (const v of list) {
  const t0 = performance.now();
  try {
    const dir = materialize("HEAD", join(work, "trees", `h-${si}`));
    const file = join(dir, v.path);
    const text = readFileSync(file, "utf8");
    let next = text;
    if (v.kind === "mutant") next = applyMutant(text, v.mutant);
    else for (const e of v.edits) next = applyEdit(v.id, next, e);
    writeFileSync(file, next);
    const hm = await manifestFor(treeFiles(dir));
    const head = composeModel(hm.statement, base.overlay, dir).source;
    const p = await providers(dir, hm.statement, head);
    const input = {
      contract: "shape.check.input/v1",
      mode: "change",
      now: NOW,
      head: { revision: hm.revision, source: head, manifest: hm.statement },
      base: { revision: base.revision, source: base.source, manifest: base.manifest },
      change: { ids: [`github:timbrinded/shapelang#h3-${v.id}`] },
      authors: AUTHORS,
      reviews: [],
      records: [p.clock.envelope, p.calls.envelope, ...p.laws.records.map((r) => r.envelope)],
      baseRecords: base.baseRecords,
      persisted: { base: [], head: [] },
      options: { health: true, teeth: false }
    };
    if (opt("dump")) writeFileSync(join(opt("dump"), `${v.id}.input.json`), JSON.stringify(input));
    const t1 = performance.now();
    const outs = { stock: derive(input), vnew: vderive(input) };
    const t2 = performance.now();
    const moved = [];
    const bi = new Map();
    for (const e of base.manifest.predicate.shape.entries) bi.set(`${e.id}@${e.projection}`, e.digest);
    for (const e of hm.statement.predicate.shape.entries) if (bi.get(`${e.id}@${e.projection}`) !== e.digest && e.id.startsWith(`ts:${v.path}`)) moved.push(`${e.id}@${e.projection}`);
    for (const [checker, out] of Object.entries(outs)) {
      const row = {
        variant: v.id,
        kind: v.kind,
        where: v.where,
        law: v.law,
        at: v.at,
        path: v.path,
        mutant: v.mutant?.id ?? null,
        note: v.note ?? null,
        checker,
        moved,
        verdict: out.verdict,
        errors: out.errors.map((e) => ({ code: e.code, subject: e.subject })),
        rejected: out.rejected.map((r) => ({ code: r.code, detail: r.detail })),
        obligations: out.obligations.filter((o) => o.introduced || o.kind === "contradiction" || o.kind === "unestablished").map(compact),
        nObligations: out.obligations.length,
        lawVerdicts: p.laws.verdicts.map((x) => ({ law: x.law, holds: x.holds })),
        seconds: { total: Number(((performance.now() - t0) / 1000).toFixed(1)), derive: Number(((t2 - t1) / 2000).toFixed(1)) }
      };
      appendFileSync(outPath, `${JSON.stringify(row)}\n`);
    }
    const s = outs.stock;
    const lawObs = s.obligations.filter((o) => (o.kind === "contradiction" || o.kind === "unestablished") && o.claim?.ids?.some((i) => i === v.law));
    const vlawObs = outs.vnew.obligations.filter((o) => (o.kind === "contradiction" || o.kind === "unestablished") && o.claim?.ids?.some((i) => i === v.law));
    process.stderr.write(`${v.id} ${v.where} stock=${s.verdict} vnew=${outs.vnew.verdict} target-law stock=[${lawObs.map((o) => `${o.kind}:${o.force ?? o.reason}:${o.introduced ? "I" : "-"}:${o.severity}`).join(",")}] vnew=[${vlawObs.map((o) => `${o.kind}:${o.introduced ? "I" : "-"}:${o.severity}`).join(",")}] (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`);
  } catch (e) {
    appendFileSync(outPath, `${JSON.stringify({ variant: v.id, crash: String(e?.stack ?? e) })}\n`);
    process.stderr.write(`${v.id} CRASH ${String(e)}\n`);
  }
}
if (existsSync(join(work, "trees", `h-${si}`))) rmSync(join(work, "trees", `h-${si}`), { recursive: true, force: true });
