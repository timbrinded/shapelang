// C1: run the executable laws against base and candidate of both behavioural
// review fixtures. Base = base/ files overlaid on candidate/ (base/ holds only
// the files the change touched). Usage: bun run-c1.mjs
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { REPO, CDIR, WORK, req } from "../lib/work.mjs";
import rootCauseLaws from "./laws-root-cause.mjs";
import crossObjectLaws from "./laws-cross-object.mjs";

const fc = req("fast-check");
const SEED = 42;
const RUNS = 1000;

const fixtures = [
  {
    name: "root-cause-grouping",
    laws: rootCauseLaws,
    load: async (dir) => ({ ...(await import(join(dir, "range.ts"))), ...(await import(join(dir, "metrics.ts"))) })
  },
  {
    name: "cross-object",
    laws: crossObjectLaws,
    load: async (dir) => ({ ...(await import(join(dir, "catalog.ts"))), ...(await import(join(dir, "presenter.ts"))) })
  }
];

const results = [];
for (const fixture of fixtures) {
  const src = join(REPO, "fixtures/skills/review", fixture.name);
  for (const variant of ["base", "candidate"]) {
    const dir = join(WORK, "c1", `${fixture.name}-${variant}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    cpSync(join(src, "candidate"), dir, { recursive: true });
    if (variant === "base") cpSync(join(src, "base"), dir, { recursive: true });
    const mod = await fixture.load(dir);
    for (const [law, property] of Object.entries(fixture.laws(fc, mod))) {
      const out = fc.check(property, { seed: SEED, numRuns: RUNS });
      results.push({
        fixture: fixture.name,
        variant,
        law,
        holds: !out.failed,
        runs: out.numRuns,
        counterexample: out.failed ? JSON.stringify(out.counterexample) : null,
        error: out.failed && out.errorInstance ? String(out.errorInstance.message ?? out.errorInstance) : null
      });
    }
  }
}

function lawLines(file) {
  return readFileSync(join(CDIR, "c1", file), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("//")).length;
}
const effort = {
  "root-cause-grouping": lawLines("laws-root-cause.mjs"),
  "cross-object": lawLines("laws-cross-object.mjs")
};
writeFileSync(join(WORK, "c1", "results.json"), JSON.stringify({ seed: SEED, runs: RUNS, effort, results }, null, 2));
for (const r of results) {
  console.log(
    `${r.fixture.padEnd(20)} ${r.variant.padEnd(9)} ${r.holds ? "HOLDS" : "FAILS"}  ${r.law}` +
      (r.holds ? "" : `  counterexample=${r.counterexample}${r.error ? ` (${r.error})` : ""}`)
  );
}
for (const fixture of fixtures) {
  const base = results.filter((r) => r.fixture === fixture.name && r.variant === "base");
  const cand = results.filter((r) => r.fixture === fixture.name && r.variant === "candidate");
  const separated = base.every((r) => r.holds) && cand.some((r) => !r.holds);
  console.log(`${fixture.name}: base ${base.filter((r) => r.holds).length}/${base.length} hold, candidate ${cand.filter((r) => r.holds).length}/${cand.length} hold, separated=${separated}, law lines=${effort[fixture.name]}`);
}
