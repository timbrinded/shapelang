// @ts-nocheck
// DRT7 corpus writer: generates version 7 cases with gen7.ts and writes each checker input.
//   bun experiments/shape-1/trials/DRT7/gen-corpus7.ts <outDir> <firstSeed> <count>
//       [--profile fragment|clean] [--phase2 p] [--shard i/n]
// Ids: r<seed> (fragment), c<seed> (clean). The clean profile retries (up to 24 attempts, seeds
// seed*32+k) until the prototype raises no error. Phase 2 (p of change-mode seeds, default 0.45):
// review lines or relay answers derived from the prototype's phase-1 output, so the corpus is fixed
// before either implementation is compared. Writes <outDir>/<id>.input.json and one index row per
// case to <outDir>/index.<shard>.jsonl; nothing else.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { derive } from "../../proto/src/derive.ts";
import { addReviews, genCase, mulberry32 } from "./gen7.ts";

const argv = process.argv.slice(2);
const [outDir, firstStr, countStr] = argv;
if (!outDir || !firstStr || !countStr) {
  process.stderr.write("usage: bun gen-corpus7.ts <outDir> <firstSeed> <count> [--profile fragment|clean] [--phase2 p] [--shard i/n]\n");
  process.exit(2);
}
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
const idx = `${outDir}/index.${shard[0]}.jsonl`;
for (let s = first; s < first + Number(countStr); s += 1) {
  if (s % shard[1] !== shard[0]) continue;
  const id = `${profile === "clean" ? "c" : "r"}${s}`;
  let g;
  try {
    g = genCase(s, profile);
    if (profile === "clean")
      for (let k = 1; k < 24; k += 1) {
        const out = derive(g.input);
        if (out.verdict !== "invalid" && (out.errors ?? []).length === 0) break;
        g = genCase(s * 32 + k, profile);
        g.meta.attempt = k;
      }
  } catch (e) {
    appendFileSync(idx, `${JSON.stringify({ id, seed: s, status: "gen-error", error: String(e?.stack ?? e).slice(0, 400) })}\n`);
    continue;
  }
  let input = g.input;
  let phase2 = false;
  const features = [...g.meta.features];
  if (input.mode === "change" && mulberry32(s * 7 + 1)() < p2) {
    try {
      const p1 = derive(input);
      if ((p1.obligations ?? []).length > 0) {
        const r = addReviews(input, p1, s, g.meta);
        input = r.input;
        for (const f of r.features) if (!features.includes(f)) features.push(f);
        phase2 = true;
      }
    } catch {
      // keep the phase-1 input; the failure shows in the gate run
    }
  }
  const path = `${outDir}/${id}.input.json`;
  writeFileSync(path, JSON.stringify(input));
  appendFileSync(
    idx,
    `${JSON.stringify({ id, seed: s, path, profile, attempt: g.meta.attempt ?? 0, phase2, mode: input.mode, ops: g.meta.ops, features, reviews: input.reviews.length, records: input.records.length })}\n`
  );
}
