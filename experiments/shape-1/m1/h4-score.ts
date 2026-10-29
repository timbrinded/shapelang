// @ts-nocheck
// M1 H4 scoring: runs the version 7 prototype decider on each of the 33 H4 cases (23
// fixtures/loosening pairs, 2 guard fixtures and 8 calibration cases, materialised by
// trials/H4/build.ts) and compares loosens, order and fwdQ with the frozen manual reading
// m0/h4/manual.json (A.16.36(c): the order column is the class the core output's order field
// must show, undecided for renames without was).
//
// Usage: bun experiments/shape-1/m1/h4-score.ts <workdir> [--out <results.json>]
//   <workdir> receives the materialised cases (build.ts writes nothing else); --out receives the
//   per-case rows. Nothing is written into the working directory.
//
// Per case: `shape1 check --model <case>/fwd/head --base <case>/fwd/base --synthesize
//   --maintainer alice --maintainer bob --now 2026-10-25T12:00:00Z --json`.
// Scoring: fired = the questions of the forward loosening rows (loosened or undecided);
//   decided loosens = yes iff some forward row is loosened (looser or incomparable), else no.
//   A case is an abstention when the decider's order is undecided; it is correct when it is
//   also the manual's order (the rename rows). A decided case is correct iff its order equals
//   the manual's, loosens agrees (yes ↔ looser/incomparable) and every manual fwdQ question
//   fired (and none fired when the manual says no). Anything else is wrong.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "/home/user/shapelang";
const BUILD = join(REPO, "experiments/shape-1/trials/H4/build.ts");
const CLI = join(REPO, "experiments/shape-1/proto/src/cli.ts");
const MANUAL = join(REPO, "experiments/shape-1/m0/h4/manual.json");
const NOW = "2026-10-25T12:00:00Z";

const args = process.argv.slice(2);
const work = args.find((a) => !a.startsWith("--"));
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
if (!work) throw new Error("usage: bun h4-score.ts <workdir> [--out <results.json>]");
mkdirSync(work, { recursive: true });
const casesDir = join(work, "cases");
const b = spawnSync("bun", [BUILD, casesDir], { cwd: work, encoding: "utf8" });
if (b.status !== 0) throw new Error(`build.ts failed: ${b.stderr}`);

const manual = JSON.parse(readFileSync(MANUAL, "utf8")).rows;
const rows = [];
let correct = 0;
let wrong = 0;
let abstain = 0;
for (const m of manual) {
  const dir = join(casesDir, m.case);
  const r = spawnSync(
    "bun",
    [
      CLI,
      "check",
      "--model",
      join(dir, "fwd/head"),
      "--base",
      join(dir, "fwd/base"),
      "--synthesize",
      "--maintainer",
      "alice",
      "--maintainer",
      "bob",
      "--now",
      NOW,
      "--json"
    ],
    { cwd: work, encoding: "utf8", maxBuffer: 1 << 28 }
  );
  let out = null;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    out = null;
  }
  if (!out) {
    wrong += 1;
    rows.push({ case: m.case, verdict: "error", stderr: (r.stderr ?? "").slice(-400), result: "wrong" });
    continue;
  }
  const loose = out.loosening ?? [];
  const fired = [...new Set(loose.map((x) => x.question))].sort();
  const loosened = loose.some((x) => x.answer === "loosened");
  const order = out.order;
  const loosens = loosened ? "yes" : "no";
  const exploited = loose.some((x) => x.exploited);
  const final = loose.some((x) => x.final);
  const errors = (out.errors ?? []).map((e) => `${e.code} ${e.subject}`);
  let result;
  const reasons = [];
  if (order === "undecided") {
    abstain += 1;
    result = m.order === "undecided" ? "abstain (manual undecided)" : "abstain";
    if (m.order !== "undecided") reasons.push(`manual order ${m.order}`);
  } else {
    if (order !== m.order) reasons.push(`order ${order} != ${m.order}`);
    const want = m.loosens === "rename" ? null : m.loosens;
    if (want === null) reasons.push("manual expects undecided (rename)");
    else if (want !== loosens) reasons.push(`loosens ${loosens} != ${want}`);
    for (const q of m.fwdQ) if (!fired.includes(q)) reasons.push(`fwdQ ${q} did not fire`);
    if (m.loosens === "no" && fired.length > 0) reasons.push(`fired ${fired.join(",")} on a no case`);
    result = reasons.length === 0 ? "correct" : "wrong";
    if (result === "correct") correct += 1;
    else wrong += 1;
  }
  const info = [];
  if (m.expl !== null && m.expl !== exploited) info.push(`exploited ${exploited} (manual ${m.expl})`);
  if (m.final !== final && loose.length > 0) info.push(`final ${final} (manual ${m.final})`);
  rows.push({
    case: m.case,
    manual: { loosens: m.loosens, order: m.order, fwdQ: m.fwdQ, expl: m.expl, final: m.final },
    decider: { loosens, order, fired, exploited, final, verdict: out.verdict, errors },
    result,
    reasons,
    info
  });
}
for (const r of rows)
  console.log(
    `${r.result.padEnd(28)} ${r.case.padEnd(38)} ${r.decider ? `${r.decider.order} ${r.decider.loosens} [${r.decider.fired.join(",")}]` : r.verdict}` +
      `${r.reasons?.length ? `  -- ${r.reasons.join("; ")}` : ""}${r.info?.length ? `  (info: ${r.info.join("; ")})` : ""}`
  );
const summary = { cases: rows.length, correct, wrong, abstain };
console.log(JSON.stringify(summary));
if (outFile) writeFileSync(outFile, `${JSON.stringify({ summary, rows }, null, 1)}\n`);
process.exit(wrong === 0 && abstain <= 2 ? 0 : 1);
