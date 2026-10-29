// @ts-nocheck
// DRT random runner: generates cases with gen.ts and runs the differential.
//   bun run-random.ts <shapek> <out.jsonl> <saveDir> <timeoutMs> <firstSeed> <count> [--shard i/n] [--profile fragment|refute] [--phase2 p]
// Per seed: genCase(seed); with probability p (change mode) a phase-2 variant adds review lines
// derived from the prototype's phase-1 output (approve refs, judge/reject lines); then diffOne.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { derive } from "../../proto/src/derive.ts";
import { diffOne } from "./drtlib.ts";
import { addReviews, genCase, mulberry32 } from "./gen.ts";

const argv = process.argv.slice(2);
const [exe, outFile, saveDir, timeoutStr, firstStr, countStr] = argv;
let shard = [0, 1];
let profile = "fragment";
let p2 = 0.45;
for (let i = 6; i < argv.length; i += 1) {
  if (argv[i] === "--shard") shard = argv[++i].split("/").map(Number);
  else if (argv[i] === "--profile") profile = argv[++i];
  else if (argv[i] === "--phase2") p2 = Number(argv[++i]);
}
mkdirSync(saveDir, { recursive: true });
const first = Number(firstStr);
for (let s = first; s < first + Number(countStr); s += 1) {
  if (s % shard[1] !== shard[0]) continue;
  let g;
  try {
    g = genCase(s, profile);
  } catch (e) {
    appendFileSync(
      outFile,
      `${JSON.stringify({ seed: s, status: "gen-error", error: String(e?.stack ?? e).slice(0, 400) })}\n`
    );
    continue;
  }
  let input = g.input;
  let phase2 = false;
  if (input.mode === "change" && mulberry32(s * 7 + 1)() < p2) {
    try {
      const p1 = derive(input);
      if ((p1.obligations ?? []).length > 0) {
        input = addReviews(input, p1, s);
        phase2 = true;
      }
    } catch {
      // the phase-1 failure shows up again in diffOne
    }
  }
  const r = diffOne(input, exe, Number(timeoutStr));
  if (r.status !== "agree") {
    writeFileSync(`${saveDir}/s${s}.input.json`, JSON.stringify(input));
    if (r.kcase) writeFileSync(`${saveDir}/s${s}.kcase.json`, JSON.stringify(r.kcase));
    if (r.tsFull) writeFileSync(`${saveDir}/s${s}.ts.json`, JSON.stringify(r.tsFull));
    if (r.lean) writeFileSync(`${saveDir}/s${s}.lean.json`, JSON.stringify(r.lean));
  }
  const row = {
    seed: s,
    profile,
    phase2,
    mode: input.mode,
    ops: g.meta.ops,
    features: g.meta.features,
    reviews: input.reviews.length,
    records: input.records.length,
    status: r.status,
    diffs: r.diffs ?? [],
    stats: r.stats ?? null,
    error: r.error ?? null,
    errors: r.errors ?? null,
    rejected: (r.tsFull?.rejected ?? []).map((x) => x.code),
    tsMs: Math.round(r.tsMs ?? 0),
    leanMs: Math.round(r.leanMs ?? 0)
  };
  appendFileSync(outFile, `${JSON.stringify(row)}\n`);
}
