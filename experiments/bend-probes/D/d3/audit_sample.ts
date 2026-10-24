// @ts-nocheck -- research script, run with bun; Bend's checker is loaded untyped at runtime.
// D3 audit helper: (1) checks mechanically that every source ref names a def
// or law that exists in that file; (2) prints a deterministic stratified sample
// of declarations with their Bend source, for a hand audit.
//
//   bun d3/audit_sample.ts <bend-demos-dir> <d3-out-dir>

import * as fs from "node:fs";
import * as path from "node:path";

const DEMOS = process.argv[2];
const OUT = process.argv[3];
type R = {
  key: string;
  module: string;
  file: string;
  name: string;
  shapeName: string;
  ioType: boolean;
  ioParam: boolean;
  law: boolean;
  effects: string[];
  claim: string;
  calls: string[];
  reliesUnsafe: string[];
  baseEffects: string[];
};

const all: Array<R & { demo: string }> = [];
for (const f of fs
  .readdirSync(OUT)
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));
  for (const r of d.records) all.push({ ...r, demo: f.replace(/\.json$/, "") });
}

// (1) source refs
let ok = 0;
const bad: string[] = [];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const r of all) {
  const src = fs.readFileSync(path.join(DEMOS, r.demo, r.file), "utf8");
  const re = new RegExp("^(@unsafe\\s+)?(def|law)\\s+" + esc(r.name) + "\\??\\s*[(:<]", "m");
  if (re.test(src)) ok++;
  else bad.push(r.demo + "/" + r.file + "#" + r.name);
}
console.log(`source refs resolving to a def/law in the named file: ${ok}/${all.length}`);
if (bad.length) console.log("unresolved:", bad.slice(0, 20).join(", "));

// (2) sample
function body(r: R & { demo: string }): string {
  const file = r.law ? "PROOF.bend" : r.file;
  const p = path.join(DEMOS, r.demo, fs.existsSync(path.join(DEMOS, r.demo, file)) ? file : r.file);
  const lines = fs.readFileSync(p, "utf8").split("\n");
  const nm = r.law ? "Laws." + r.name : r.name;
  const i = lines.findIndex((l) => new RegExp("^def\\s+" + esc(nm) + "\\??\\s*[(:<]").test(l));
  if (i < 0) return "(not found)";
  let j = i + 1;
  while (j < lines.length && (lines[j].startsWith(" ") || lines[j] === "")) j++;
  return lines
    .slice(i > 0 && lines[i - 1] === "@unsafe" ? i - 1 : i, Math.min(j, i + 30))
    .join("\n");
}
const pick = <T>(xs: T[], n: number) =>
  xs.length <= n ? xs : Array.from({ length: n }, (_, k) => xs[Math.floor((k * xs.length) / n)]);
const strata: Array<[string, Array<R & { demo: string }>, number]> = [
  ["IO-typed", all.filter((r) => r.ioType), 20],
  ["pure", all.filter((r) => !r.ioType && !r.effects.includes("ReliesOnUnsafe")), 20],
  ["ReliesOnUnsafe", all.filter((r) => r.effects.includes("ReliesOnUnsafe")), 8]
];
for (const [name, xs, n] of strata) {
  console.log(`\n######## ${name}: ${xs.length} total, sample ${Math.min(n, xs.length)}`);
  for (const r of pick(xs, n)) {
    console.log(
      `\n=== ${r.demo} ${r.key} -> ${r.shapeName} claim=${r.claim} effects=[${r.effects.join(", ")}] ioParam=${r.ioParam} base=[${r.baseEffects.join(",")}] calls=[${r.calls.join(",")}]`
    );
    console.log(body(r));
  }
}
