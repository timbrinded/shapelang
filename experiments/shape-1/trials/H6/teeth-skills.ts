// @ts-nocheck
// H6 step 4: teeth on the fixtures/skills models (0.x shapes migrated by the prototype's loader).
//   bun experiments/shape-1/trials/H6/teeth-skills.ts --work <dir>
// Each model's shape files are copied under <work>/skills/<case>/shape/ (guard cases keep their
// .shape files directly in base/ and candidate/); the manifest is built from the fixture's own
// files (repository-relative paths when the shape cites `fixtures/skills/...`, else relative to the
// fixture root, as unix-system-visualiser/connected does). Unit sources are rewritten against it.
// Writes <work>/teeth-skills.json.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { manifestFor } from "../../proto/providers/common.ts";
import { runTeeth } from "../../proto/providers/teeth/provider.ts";
import { loadModel, rewriteAgainst } from "../../proto/src/loader.ts";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const WORK = resolve(opt("work", "h6-work"));
const REPO = resolve(import.meta.dir, "../../../..");
const SK = join(REPO, "fixtures/skills");
const NOW = "2026-10-26T00:00:00Z";
const CASES = [
  ["guard/equivalent-relocation/base", "guard/equivalent-relocation/base", "."],
  ["guard/equivalent-relocation/candidate", "guard/equivalent-relocation/candidate", "."],
  ["guard/policy-removal/base", "guard/policy-removal/base", "."],
  ["guard/policy-removal/candidate", "guard/policy-removal/candidate", "."],
  ["index/coverage-gaps", "index/coverage-gaps", "shape"],
  ["index/missing-ast", "index/missing-ast", "shape"],
  ["preflight/complete-route", "preflight/complete-route", "shape"],
  ["preflight/guarded-unknown", "preflight/guarded-unknown", "shape"],
  ["preflight/invalid-baseline", "preflight/invalid-baseline", "shape"],
  ["review/cross-object", "review/cross-object", "shape"],
  ["review/root-cause-grouping", "review/root-cause-grouping", "shape"],
  ["review/stale-model", "review/stale-model", "shape"],
  ["unix-system-visualiser/connected", "unix-system-visualiser/connected", "shape"],
  ["unix-system-visualiser/invalid-model", "unix-system-visualiser/invalid-model", "shape"]
];

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir).sort()) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

const rows = [];
for (const [name, rel, shapeSub] of CASES) {
  const root = join(SK, rel);
  const modelDir = join(WORK, "skills", name);
  rmSync(modelDir, { recursive: true, force: true });
  mkdirSync(join(modelDir, "shape"), { recursive: true });
  const shapeFiles = walk(join(root, shapeSub)).filter((f) => f.endsWith(".shape"));
  for (const f of shapeFiles) cpSync(f, join(modelDir, "shape", relative(join(root, shapeSub), f)));
  const text = shapeFiles.map((f) => readFileSync(f, "utf8")).join("\n");
  const repoRel = text.includes('ts("fixtures/skills/');
  const codeFiles = walk(root).filter(
    (f) => !f.endsWith(".shape") && !f.includes("/.research/") && !f.endsWith(".gitignore")
  );
  const files = codeFiles.map((f) => ({
    path: relative(repoRel ? REPO : root, f).replace(/\\/g, "/"),
    mode: "100644",
    bytes: new Uint8Array(readFileSync(f))
  }));
  const row = { case: name, shapeFiles: shapeFiles.length, codeFiles: files.length };
  try {
    const man = await manifestFor({ files, revision: "0".repeat(40) });
    const loaded = loadModel(modelDir, { maintainers: ["alice", "bob"] });
    const source = rewriteAgainst(loaded.source, man.statement).source ?? loaded.source;
    const run = runTeeth({ source, man, records: [], time: NOW });
    const r = run.report;
    Object.assign(row, {
      errors: run.errors,
      claims: r.claims.length,
      claimOps: r.claims.reduce((m, c) => ((m[c.op] = (m[c.op] ?? 0) + 1), m), {}),
      notAssessed: r.notAssessed.length,
      operators: r.operators,
      vacuous: r.vacuous,
      redundant: r.claims
        .filter((c) => c.redundantWith.length > 0)
        .map((c) => `${c.id} <= ${c.redundantWith.join(",")}`),
      unusedGrants: r.unusedGrants,
      gapsW1: r.gaps.W1,
      gapsW2: r.gaps.W2.filter((g) => g.killed < g.total),
      P1: {
        resources: r.gaps.P1.resources,
        uncaught: r.gaps.P1.uncaught,
        caught: r.gaps.P1.caught
      },
      laws: r.laws.map((l) => `${l.id}:${l.verdict}`)
    });
  } catch (e) {
    row.crash = String(e).slice(0, 400);
  }
  rows.push(row);
  process.stderr.write(
    `${name}: ${row.crash ? `CRASH ${row.crash.slice(0, 120)}` : `claims ${row.claims}, vacuous ${row.vacuous.length}, redundant ${row.redundant.length}, unused ${row.unusedGrants.length}, errors ${row.errors.length}`}\n`
  );
}
writeFileSync(join(WORK, "teeth-skills.json"), JSON.stringify(rows, null, 1));
void existsSync;
