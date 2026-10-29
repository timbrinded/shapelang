// Change runs of Shape's 1.0 model: history replays and seeded scenarios. Each run materialises a
// base and a head tree, composes the dogfood model from each tree's own shape/*.shape plus
// shape1.yaml, runs the providers on both (observers on the base, all three on the head), and
// derives the change.
//
//   bun experiments/shape-1/dogfood/tools/runs.ts replay <rev>... --work <dir> [--out <file>]
//   bun experiments/shape-1/dogfood/tools/runs.ts scenario <name>... --work <dir> [--out <file>]
//   scenarios: refactor-isoToday, seed-clock-freshness, break-codepoint-order, edit-law-harness,
//              readme-only, edit-checkCoverage
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { derive } from "../../proto/src/derive.ts";
import type { CheckInput, CheckOutput } from "../../proto/src/io-types.ts";
import { renderHuman } from "../../proto/src/render.ts";
import { runLaws } from "../providers/bun-test.ts";
import { callScan } from "../providers/ts-calls.ts";
import { clockScan } from "../providers/ts-clock-scan.ts";
import { summarize } from "./summary.ts";
import { REPO, composeModel, manifestFor, materialize, treeFiles } from "./lib.ts";

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const names = argv
  .slice(1)
  .filter((a, i, xs) => !a.startsWith("--") && !(i > 0 && (xs[i - 1] ?? "").startsWith("--")));
const work = resolve(opt("work") ?? "dogfood-runs");
const now = opt("now") ?? "2026-10-26T00:00:00Z";
const AUTHORS: CheckInput["authors"] = [
  { identity: 'github("timbrinded")', verified: true, bot: false },
  { identity: 'github("claude[bot]")', verified: true, bot: true }
];

interface Row {
  run: string;
  verdict: string;
  errors: Record<string, number>;
  obligations: Record<string, number>;
  bySeverity: Record<string, number>;
  introduced: number;
  groups: number;
  judgmentGroups: number;
  changedIds: number;
  coverage: unknown;
  laws: Record<string, number>;
  seconds: number;
  notes: string[];
}

const tally = <T>(xs: T[], key: (x: T) => string): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
};

async function runChange(
  label: string,
  baseDir: string,
  headDir: string,
  notes: string[]
): Promise<{ row: Row; out: CheckOutput }> {
  const t0 = performance.now();
  const bm = await manifestFor(treeFiles(baseDir));
  const hm = await manifestFor(treeFiles(headDir));
  const base = composeModel(bm.statement, undefined, baseDir).source;
  const head = composeModel(hm.statement, undefined, headDir).source;
  const baseRecords = [
    (await clockScan({ root: baseDir, manifest: bm.statement, now })).envelope,
    (await callScan({ root: baseDir, manifest: bm.statement, now })).envelope
  ];
  const laws = await runLaws({ root: headDir, manifest: hm.statement, source: head, now });
  const records = [
    (await clockScan({ root: headDir, manifest: hm.statement, now })).envelope,
    (await callScan({ root: headDir, manifest: hm.statement, now })).envelope,
    ...laws.records.map((r) => r.envelope)
  ];
  const input: CheckInput = {
    contract: "shape.check.input/v1",
    mode: "change",
    now,
    head: { revision: hm.revision, source: head, manifest: hm.statement },
    base: { revision: bm.revision, source: base, manifest: bm.statement },
    change: { ids: [`github:timbrinded/shapelang#${label}`] },
    authors: AUTHORS,
    reviews: [],
    records,
    baseRecords,
    persisted: { base: [], head: [] },
    options: { health: true, teeth: false }
  };
  const out = derive(input);
  writeFileSync(join(work, `${label}.out.json`), JSON.stringify(out, null, 1));
  writeFileSync(join(work, `${label}.human.txt`), `${renderHuman(out)}\n\n${summarize(out)}\n`);
  const bmIds = new Map(
    (
      bm.statement.predicate.shape as unknown as {
        entries: { id: string; projection: string; digest: string }[];
      }
    ).entries
      .filter((e) => e.projection === "own")
      .map((e) => [e.id, e.digest])
  );
  const changed = (
    hm.statement.predicate.shape as unknown as {
      entries: { id: string; projection: string; digest: string }[];
    }
  ).entries.filter((e) => e.projection === "own" && bmIds.get(e.id) !== e.digest).length;
  const row: Row = {
    run: label,
    verdict: out.verdict,
    errors: tally(out.errors, (e) => e.code),
    obligations: tally(
      out.obligations,
      (o) =>
        `${o.kind}${o.reason ? `/${o.reason}` : ""}${o.questions ? `/${o.questions.join("+")}` : ""}`
    ),
    bySeverity: tally(
      out.obligations,
      (o) => `${o.kind}/${o.severity}/${o.introduced ? "introduced" : "preexisting"}`
    ),
    introduced: out.obligations.filter((o) => o.introduced).length,
    groups: new Set(out.obligations.map((o) => o.group)).size,
    judgmentGroups: new Set(
      out.obligations.filter((o) => o.budget === "judgment").map((o) => o.group)
    ).size,
    changedIds: changed,
    coverage: (out.health as Record<string, unknown>).coverage,
    laws: tally(laws.records, (r) => r.result),
    seconds: Number(((performance.now() - t0) / 1000).toFixed(1)),
    notes
  };
  return { row, out };
}

function edit(dir: string, path: string, from: string | RegExp, to: string): void {
  const p = join(dir, path);
  const text = readFileSync(p, "utf8");
  const next = text.replace(from, to);
  if (next === text) throw new Error(`edit did not apply to ${path}`);
  writeFileSync(p, next);
}

const SCENARIOS: Record<string, { note: string; apply: (dir: string) => void }> = {
  "readme-only": {
    note: "a README edit",
    apply: (d) => edit(d, "README.md", /$/, "\nA dogfood scenario line.\n")
  },
  "refactor-isoToday": {
    note: "refactor ShpCli.isoToday (Example 3's guarded unit) without changing behaviour",
    apply: (d) =>
      edit(
        d,
        "packages/shp-cli/src/freshness.ts",
        "const today = parseIsoCalendarDate(new Date().toISOString().slice(0, 10));",
        "const isoNow = new Date().toISOString();\n  const today = parseIsoCalendarDate(isoNow.slice(0, 10));"
      )
  },
  "seed-clock-freshness": {
    note: "seed a Date.now() read into ShapeRuleEngine.checkFreshness (Example 3's seeded drift)",
    apply: (d) =>
      edit(
        d,
        "packages/shp-checker/src/checker/rules/guards.ts",
        "  const diagnostics: SemanticDiagnostic[] = [];\n\n  for (const { kind, info } of allContexts(model)) {\n    if (!info.reviewBy",
        "  const diagnostics: SemanticDiagnostic[] = [];\n  const startedAt = Date.now();\n  void startedAt;\n\n  for (const { kind, info } of allContexts(model)) {\n    if (!info.reviewBy"
      )
  },
  "break-codepoint-order": {
    note: "make compareCodepointStrings locale-aware (breaks InspectionCodepointOrder)",
    apply: (d) =>
      edit(
        d,
        "packages/shp-checker/src/shape-strings.ts",
        "export function compareCodepointStrings(left: string, right: string): number {\n",
        "export function compareCodepointStrings(left: string, right: string): number {\n  if (left.toLowerCase() !== right.toLowerCase()) return left.localeCompare(right);\n"
      )
  },
  "edit-law-harness": {
    note: "edit the law kit (the bunTest harness of every tested law)",
    apply: (d) =>
      edit(
        d,
        "experiments/shape-1/dogfood/laws/lawkit.ts",
        "/** mulberry32: small, fast, deterministic. */",
        "/** mulberry32: small, fast, deterministic (harness edit). */"
      )
  },
  "edit-checkCoverage": {
    note: "edit ShapeRuleEngine.checkCoverage (a RefactorSensitive unit with untested laws)",
    apply: (d) => {
      const p = "packages/shp-checker/src/checker/rules/coverage.ts";
      const text = readFileSync(join(d, p), "utf8");
      const i = text.indexOf("export function checkCoverage(");
      if (i < 0) throw new Error("checkCoverage not found");
      const j = text.indexOf("{", i) + 1;
      // a statement, not a comment: inert comments do not move digests
      writeFileSync(
        join(d, p),
        `${text.slice(0, j)}\n  const dogfoodScenario = 0;\n  void dogfoodScenario;\n${text.slice(j)}`
      );
    }
  }
};

const rows: Row[] = [];
if (cmd === "replay") {
  for (const rev of names) {
    const base = materialize(`${rev}^`, join(work, "trees", `${rev}-base`));
    const head = materialize(rev, join(work, "trees", `${rev}-head`));
    const { row } = await runChange(`replay-${rev}`, base, head, [`git ${rev}`]);
    rows.push(row);
    process.stderr.write(`${JSON.stringify(row)}\n`);
  }
} else if (cmd === "scenario") {
  const base = materialize("HEAD", join(work, "trees", "scenario-base"));
  for (const name of names) {
    const s = SCENARIOS[name];
    if (!s) throw new Error(`unknown scenario ${name}`);
    const head = materialize("HEAD", join(work, "trees", `scenario-${name}`));
    s.apply(head);
    const { row } = await runChange(`scenario-${name}`, base, head, [s.note]);
    rows.push(row);
    process.stderr.write(`${JSON.stringify(row)}\n`);
  }
} else throw new Error("usage: runs.ts replay <rev>... | scenario <name>... --work <dir>");
writeFileSync(opt("out") ?? join(work, `${cmd}.rows.json`), `${JSON.stringify(rows, null, 1)}\n`);
void REPO;
