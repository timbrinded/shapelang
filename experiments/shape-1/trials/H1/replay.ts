// H1, side (b): replay commits under the Shape 1.0 dogfood model with providers rerun.
//
//   bun experiments/shape-1/trials/H1/replay.ts --commits <file> --work <dir> --rows <file.jsonl>
//                                                 [--now 2026-10-26T00:00:00Z] [--keep-trees]
//
// Mirrors experiments/shape-1/dogfood/tools/runs.ts `replay`: for commit C (base = first parent)
// both trees are materialised (git archive plus today's dogfood files), each tree's own
// shape/*.shape is migrated and the dogfood overlay applied (composeModel), the observers
// (tsClockScan, tsCalls) run on both trees and all three providers (plus bunTest) on the head, and
// the prototype's derive computes the change. Mechanical providers are therefore rerun at head:
// an obligation that a rerun discharges cannot remain open.
//
// Per commit it writes the full output to <work>/out/<C>.out.json.gz and one compact row to --rows.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { derive } from "../../proto/src/derive.ts";
import type { CheckInput, ObligationOut } from "../../proto/src/io-types.ts";
import { runLaws } from "../../dogfood/providers/bun-test.ts";
import { callScan } from "../../dogfood/providers/ts-calls.ts";
import { clockScan } from "../../dogfood/providers/ts-clock-scan.ts";
import { composeModel, manifestFor, materialize, treeFiles } from "../../dogfood/tools/lib.ts";

const argv = process.argv.slice(2);
const opt = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const work = resolve(opt("work") ?? "/tmp/h1-replay");
const rowsPath = resolve(opt("rows") ?? join(work, "rows.jsonl"));
const now = opt("now") ?? "2026-10-26T00:00:00Z";
const keepTrees = argv.includes("--keep-trees");
const commits = readFileSync(opt("commits") ?? "", "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
const AUTHORS: CheckInput["authors"] = [
  { identity: 'github("timbrinded")', verified: true, bot: false },
  { identity: 'github("claude[bot]")', verified: true, bot: true }
];
mkdirSync(join(work, "out"), { recursive: true });
const done = new Set<string>();
if (existsSync(rowsPath))
  for (const l of readFileSync(rowsPath, "utf8").split("\n").filter(Boolean))
    done.add((JSON.parse(l) as { commit: string }).commit);

/** Compact view of one obligation (what the H1 analysis reads). */
function compact(o: ObligationOut): Record<string, unknown> {
  return {
    key: o.key,
    kind: o.kind,
    reason: o.reason,
    questions: o.questions,
    introduced: o.introduced,
    severity: o.severity,
    tier: o.tier,
    budget: o.budget,
    force: o.force,
    owner: o.owner,
    group: o.group,
    claim: o.claim ? (o.claim.ids[0] ?? o.claim.fp) : null,
    subject: o.subject,
    acts: o.dischargers.map((d) => `${d.act}/${d.by}`),
    witness: o.witness.length,
    affected: o.affected ?? null,
    rule: o.rule ?? null,
    exploited: o.exploited,
    final: o.final
  };
}

for (const c of commits) {
  if (done.has(c)) continue;
  const t0 = performance.now();
  const baseDir = join(work, "trees", `${c.slice(0, 12)}-base`);
  const headDir = join(work, "trees", `${c.slice(0, 12)}-head`);
  let row: Record<string, unknown>;
  try {
    materialize(`${c}^`, baseDir);
    materialize(c, headDir);
    const bm = await manifestFor(treeFiles(baseDir));
    const hm = await manifestFor(treeFiles(headDir));
    const baseComp = composeModel(bm.statement, undefined, baseDir);
    const headComp = composeModel(hm.statement, undefined, headDir);
    const baseRecords = [
      (await clockScan({ root: baseDir, manifest: bm.statement, now })).envelope,
      (await callScan({ root: baseDir, manifest: bm.statement, now })).envelope
    ];
    const laws = await runLaws({
      root: headDir,
      manifest: hm.statement,
      source: headComp.source,
      now
    });
    const records = [
      (await clockScan({ root: headDir, manifest: hm.statement, now })).envelope,
      (await callScan({ root: headDir, manifest: hm.statement, now })).envelope,
      ...laws.records.map((r) => r.envelope)
    ];
    const input: CheckInput = {
      contract: "shape.check.input/v1",
      mode: "change",
      now,
      head: { revision: hm.revision, source: headComp.source, manifest: hm.statement },
      base: { revision: bm.revision, source: baseComp.source, manifest: bm.statement },
      change: { ids: [`github:timbrinded/shapelang@${c}`] },
      authors: AUTHORS,
      reviews: [],
      records,
      baseRecords,
      persisted: { base: [], head: [] },
      options: { health: true, teeth: false }
    };
    const t1 = performance.now();
    const out = derive(input);
    const deriveSeconds = (performance.now() - t1) / 1000;
    writeFileSync(join(work, "out", `${c}.out.json.gz`), gzipSync(JSON.stringify(out)));
    type E = { id: string; projection: string; digest: string };
    const own = (m: typeof bm): Map<string, string> =>
      new Map(
        (m.statement.predicate.shape as unknown as { entries: E[] }).entries
          .filter((e) => e.projection === "own")
          .map((e) => [e.id, e.digest])
      );
    const bo = own(bm);
    const ho = own(hm);
    const finest = [...ho]
      .filter(([id, d]) => bo.get(id) !== d)
      .map(([id]) => id)
      .sort();
    const removed = [...bo.keys()].filter((id) => !ho.has(id)).sort();
    row = {
      commit: c,
      ok: true,
      verdict: out.verdict,
      errors: out.errors.map((e) => ({ code: e.code, subject: e.subject })),
      rejected: out.rejected.length,
      obligations: out.obligations.filter((o) => o.introduced).map(compact),
      preexisting: out.obligations
        .filter((o) => !o.introduced)
        .map((o) => ({
          kind: o.kind,
          reason: o.reason,
          budget: o.budget,
          severity: o.severity,
          key: o.key
        })),
      groups: out.obligations.length,
      laws: laws.records.reduce<Record<string, number>>(
        (m, r) => ({ ...m, [r.result]: (m[r.result] ?? 0) + 1 }),
        {}
      ),
      lawExit: laws.exitCode,
      finest,
      removed,
      health: {
        coverage: (out.health as Record<string, unknown>).coverage ?? null,
        cells: (out.health as Record<string, unknown>).cells ?? null
      },
      seconds: Number(((performance.now() - t0) / 1000).toFixed(1)),
      deriveSeconds: Number(deriveSeconds.toFixed(1))
    };
  } catch (e) {
    row = {
      commit: c,
      ok: false,
      error: String(e instanceof Error ? (e.stack ?? e.message) : e).slice(0, 4000),
      seconds: Number(((performance.now() - t0) / 1000).toFixed(1))
    };
  }
  appendFileSync(rowsPath, `${JSON.stringify(row)}\n`);
  const r = row as {
    ok: boolean;
    verdict?: string;
    obligations?: unknown[];
    errors?: unknown[];
    seconds: number;
  };
  process.stderr.write(
    `${c.slice(0, 7)} ${r.ok ? `${r.verdict} introduced=${r.obligations?.length} errors=${r.errors?.length}` : "FAILED"} ${r.seconds}s\n`
  );
  if (!keepTrees) {
    rmSync(baseDir, { recursive: true, force: true });
    rmSync(headDir, { recursive: true, force: true });
  }
}
