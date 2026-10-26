// @ts-nocheck
// DRT corpus writer: generates random cases (gen.ts) and writes each prototype CheckInput to disk.
//   bun gen-corpus.ts <outDir> <firstSeed> <count> [--profile fragment|refute] [--phase2 p] [--shard i/n]
// Phase 2 (p of change-mode seeds): review lines derived from the unpatched prototype's phase-1
// output are added, so the corpus is fixed before any patch is applied.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { derive } from "../../proto/src/derive.ts";
import { addReviews, genCase, mulberry32 } from "./gen.ts";

const argv = process.argv.slice(2);
const [outDir, firstStr, countStr] = argv;
let profile = "fragment";
let p2 = 0.45;
let shard = [0, 1];
for (let i = 3; i < argv.length; i += 1) {
  if (argv[i] === "--profile") profile = argv[++i];
  else if (argv[i] === "--phase2") p2 = Number(argv[++i]);
  else if (argv[i] === "--shard") shard = argv[++i].split("/").map(Number);
}
mkdirSync(outDir, { recursive: true });
const first = Number(firstStr);
for (let s = first; s < first + Number(countStr); s += 1) {
  if (s % shard[1] !== shard[0]) continue;
  const id = `${profile === "fragment" ? "r" : profile === "clean" ? "c" : profile}${s}`;
  let g;
  try {
    g = genCase(s, profile);
    // clean profile: retry (up to 8 attempts) until the unpatched prototype raises no error at all
    if (profile === "clean")
      for (let k = 1; k < 8; k += 1) {
        const out = derive(g.input);
        if (out.verdict !== "invalid" && (out.errors ?? []).length === 0) break;
        g = genCase(s * 16 + k, profile);
        g.meta.attempt = k;
      }
  } catch (e) {
    appendFileSync(`${outDir}/index.${shard[0]}.jsonl`, `${JSON.stringify({ id, seed: s, status: "gen-error", error: String(e).slice(0, 300) })}\n`);
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
      // keep the phase-1 input; the failure shows in the differential run
    }
  }
  const path = `${outDir}/${id}.input.json`;
  writeFileSync(path, JSON.stringify(input));
  appendFileSync(`${outDir}/index.${shard[0]}.jsonl`, `${JSON.stringify({ id, seed: s, path, profile, phase2, mode: input.mode, ops: g.meta.ops, features: g.meta.features, reviews: input.reviews.length, records: input.records.length })}\n`);
}
