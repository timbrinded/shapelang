// @ts-nocheck
// DRT7 per-feature coverage report, without the kernel: for every corpus case of a list, the
// version 7 decisions it exercises (features7.ts) and the generator's own feature tags (gen-corpus7
// index rows), with the count of corpus cases per decision against the threshold of 100.
//   bun experiments/shape-1/trials/DRT7/coverage7.ts --list <corpus.tsv> --out <coverage.json>
//       [--index <corpus dir>]... [--shard i/n --rows <rows.jsonl>]
// With --rows the per-case features are written (one row per case) instead of the report; the
// report is then rebuilt from the rows files given after --merge.
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { derive } from "../../proto/src/derive.ts";
import { convert } from "./convert.ts";
import { DECISIONS, features } from "./features7.ts";

const argv = process.argv.slice(2);
const arg = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : null;
};
const many = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
const out = arg("out");
const rowsOut = arg("rows");
const shard = (arg("shard") ?? "0/1").split("/").map(Number);
const rows = [];
if (argv.includes("--merge")) {
  for (const f of argv.slice(argv.indexOf("--merge") + 1)) for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) rows.push(JSON.parse(l));
} else {
  const lines = readFileSync(arg("list"), "utf8").split("\n").filter(Boolean);
  lines.forEach((line, j) => {
    if (j % shard[1] !== shard[0]) return;
    const [id, set, src] = line.split("\t");
    const input = JSON.parse(readFileSync(src, "utf8"));
    const o = derive(input);
    const c = convert(input);
    const row = { id, set, verdict: o.verdict, features: c.kind === "case" ? features(input, c.pp, o) : [] };
    if (rowsOut) appendFileSync(rowsOut, `${JSON.stringify(row)}\n`);
    else rows.push(row);
  });
  if (rowsOut) process.exit(0);
}
const tags = {};
for (const dir of many("index"))
  for (const f of readdirSync(dir).filter((x) => x.startsWith("index.") && x.endsWith(".jsonl")))
    for (const l of readFileSync(`${dir}/${f}`, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(l);
      for (const t of r.features ?? []) tags[t] = (tags[t] ?? 0) + 1;
      for (const o of r.ops ?? []) tags[`op:${o}`] = (tags[`op:${o}`] ?? 0) + 1;
      tags[`mode:${r.mode}`] = (tags[`mode:${r.mode}`] ?? 0) + 1;
      if (r.phase2) tags.phase2 = (tags.phase2 ?? 0) + 1;
    }
const sets = [...new Set(rows.map((r) => r.set))].sort();
const coverage = Object.fromEntries(DECISIONS.map((d) => [d, Object.fromEntries([["cases", rows.filter((r) => r.features.includes(d)).length], ...sets.map((s) => [s, rows.filter((r) => r.set === s && r.features.includes(d)).length])])]));
const verdicts = {};
for (const r of rows) verdicts[`${r.set}:${r.verdict}`] = (verdicts[`${r.set}:${r.verdict}`] ?? 0) + 1;
const report = { cases: rows.length, perSet: Object.fromEntries(sets.map((s) => [s, rows.filter((r) => r.set === s).length])), threshold: 100, met: DECISIONS.every((d) => coverage[d].cases >= 100), coverage, verdicts, generatorTags: Object.fromEntries(Object.entries(tags).sort()) };
writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
process.stdout.write(`${DECISIONS.map((d) => `${d} ${coverage[d].cases}`).join("; ")}; met ${report.met}\n`);
