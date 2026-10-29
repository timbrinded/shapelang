// H1, side (a): what today's 0.x path-level coverage demands of each commit.
//
//   bun experiments/shape-1/trials/H1/zerox.ts --commits <file> --work <dir> --out <file.json> [--model <rev>]
//
// For each commit C (base = first parent), with today's checker library over C's own shape/*.shape:
// - demand.files: changed non-.shape files matched by an `on_change require shape_update`
//   implementation glob, before any discharge (checkCoverage with no shape update and no
//   attestation counted). Each needs a Shape update or a fresh `no_shape_change` attestation.
// - demand.guards: guarded_source_changed with no reevaluation counted (on_change ReEvaluation
//   guards on a function whose source file changed; guards the change adds are skipped, as in shp).
// - residual.*: what `shp coverage --changed-files --base-model <parent>` reports at C, i.e. the
//   demand the commit left undischarged.
// - bindings: `shp check`'s DocumentedBy-style bindings, reported separately (not coverage).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Glob } from "bun";
import { parseShapeModule } from "../../../../packages/shp-checker/src/parser.ts";
import { normalizeCheckOptions } from "../../../../packages/shp-checker/src/checker/api.ts";
import { lowerShapeModules } from "../../../../packages/shp-checker/src/checker/lowerer.ts";
import {
  attestationKey,
  checkBindings,
  checkCoverage
} from "../../../../packages/shp-checker/src/checker/rules/coverage.ts";
import { globMatches } from "../../../../packages/shp-checker/src/checker/globs.ts";
import {
  checkGuardedSources,
  reevaluationKey
} from "../../../../packages/shp-checker/src/checker/rules/guards.ts";
import type {
  CheckModuleInput,
  SemanticDiagnostic
} from "../../../../packages/shp-checker/src/checker/model.ts";

const REPO = resolve(import.meta.dir, "../../../..");
const argv = process.argv.slice(2);
const opt = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const commits = readFileSync(opt("commits") ?? "", "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
const work = resolve(opt("work") ?? "/tmp/h1-zerox");
const outPath = opt("out") ?? join(work, "zerox.json");
/** --model <rev>: read the 0.x model of this revision for every commit (sensitivity: one fixed model) */
const fixedModel = opt("model");

function git(args: string[]): string {
  const r = spawnSync("git", ["-C", REPO, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function materializeShape(rev: string, dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const r = spawnSync("sh", [
    "-c",
    `git -C ${JSON.stringify(REPO)} archive ${rev} shape | tar -x -C ${JSON.stringify(dir)}`
  ]);
  if (r.status !== 0) throw new Error(`archive ${rev}: ${r.stderr.toString()}`);
}

function shapeFiles(dir: string, includeGenerated: boolean): string[] {
  const out: string[] = [];
  for (const f of new Glob("shape/**/*.shape").scanSync({ cwd: dir, onlyFiles: true })) {
    if (!includeGenerated && f.startsWith("shape/generated/ast/")) continue;
    out.push(f);
  }
  return out.sort();
}

function parseAll(dir: string, files: string[]): { modules: CheckModuleInput[]; errors: string[] } {
  const modules: CheckModuleInput[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const parsed = parseShapeModule(readFileSync(join(dir, f), "utf8"), join(dir, f));
    if (parsed.ok)
      modules.push({ module: parsed.module, filePath: join(dir, f), origin: "authored" });
    else errors.push(`${f}: ${parsed.diagnostics.length} parse diagnostics`);
  }
  return { modules, errors };
}

interface Row {
  commit: string;
  parent: string;
  subject: string;
  date: string;
  changed: string[];
  parseErrors: string[];
  implementations: number;
  demand: {
    files: string[];
    pairs: number;
    guards: string[];
    bindings: string[];
    components: string[];
  };
  residual: { files: string[]; guards: string[]; bindings: string[] };
}

const rows: Row[] = [];
for (const c of commits) {
  const parents = git(["rev-list", "--parents", "-n", "1", c]).trim().split(" ").slice(1);
  const parent = parents[0];
  if (!parent) {
    process.stderr.write(`skip ${c}: no parent in this (shallow) clone\n`);
    continue;
  }
  const [subject = "", date = ""] = git(["log", "-1", "--format=%s%n%aI", c]).split("\n");
  const changed = git(["diff", "--name-only", parent, c]).split("\n").filter(Boolean).sort();
  const headDir = join(work, "zx", c.slice(0, 12), "head");
  const baseDir = join(work, "zx", c.slice(0, 12), "base");
  materializeShape(fixedModel ?? c, headDir);
  materializeShape(fixedModel ?? parent, baseDir);
  const head = parseAll(headDir, shapeFiles(headDir, true));
  const base = parseAll(baseDir, shapeFiles(baseDir, false));
  // base modules carry repository-relative paths so attestation-free texts line up with the head
  const baseInputs: CheckModuleInput[] = base.modules.map((m) => ({
    ...m,
    filePath: join(headDir, (m.filePath ?? "").slice(baseDir.length + 1))
  }));
  const model = lowerShapeModules(head.modules);
  const real = normalizeCheckOptions({
    baseModules: baseInputs,
    changedFiles: changed,
    repoRoot: headDir
  });
  const realBase = real.base;
  if (!realBase) throw new Error("no base summary");

  // residual: exactly shp coverage (and shp check's bindings) at this commit
  const resCov = checkCoverage(model, changed, headDir, realBase);
  const resGuard = checkGuardedSources(model, changed, headDir, realBase);
  const resBind = checkBindings(model, changed, headDir, realBase);

  // demand: no shape update counts (drop .shape files from the change), no attestation or
  // reevaluation is new (the base holds every head attestation and reevaluation)
  const nonShape = changed.filter((f) => !f.endsWith(".shape"));
  const demandBase = {
    ...realBase,
    attestationKeys: new Set(model.attestations.map(attestationKey)),
    reevaluationKeys: new Set([...model.reevaluations.values()].map(reevaluationKey))
  };
  const demCov = checkCoverage(model, nonShape, headDir, demandBase);
  const demGuard = checkGuardedSources(model, nonShape, headDir, demandBase);
  // bindings demand: every binding triggered by a changed file, whether or not its docs changed
  const demBind = new Set<string>();
  for (const d of checkBindings(model, changed, headDir, demandBase))
    if (d.kind === "missing_bound_docs_change") demBind.add(d.binding);
  for (const b of model.bindings.values()) {
    if (changed.some((f) => b.whenChanged.some((e) => globMatches(e.glob, f)))) demBind.add(b.name);
  }

  const files = (ds: SemanticDiagnostic[]): string[] =>
    [
      ...new Set(ds.flatMap((d) => (d.kind === "missing_shape_update" ? [d.changedFile] : [])))
    ].sort();
  const guards = (ds: SemanticDiagnostic[]): string[] =>
    [
      ...new Set(
        ds.flatMap((d) =>
          d.kind === "guarded_source_changed" ? [`${d.guardKind}:${d.guard}@${d.changedFile}`] : []
        )
      )
    ].sort();
  const conform = new Map(model.implementations.map((i) => [i.name, i.conformsTo ?? i.name]));
  const comps = (ds: SemanticDiagnostic[]): string[] =>
    [
      ...new Set(
        ds.flatMap((d) =>
          d.kind === "missing_shape_update"
            ? [String(conform.get(d.implementation) ?? d.implementation)]
            : []
        )
      )
    ].sort();
  const binds = (ds: SemanticDiagnostic[]): string[] =>
    [
      ...new Set(ds.flatMap((d) => (d.kind === "missing_bound_docs_change" ? [d.binding] : [])))
    ].sort();
  const row: Row = {
    commit: c,
    parent,
    subject,
    date,
    changed,
    parseErrors: [...head.errors, ...base.errors.map((e) => `base ${e}`)],
    implementations: model.implementations.filter((i) => i.onChangeRequirement === "shape_update")
      .length,
    demand: {
      files: files(demCov),
      pairs: demCov.filter((d) => d.kind === "missing_shape_update").length,
      guards: guards(demGuard),
      bindings: [...demBind].sort(),
      components: comps(demCov)
    },
    residual: { files: files(resCov), guards: guards(resGuard), bindings: binds(resBind) }
  };
  rows.push(row);
  process.stderr.write(
    `${c.slice(0, 7)} changed=${changed.length} demand=${row.demand.files.length}+${row.demand.guards.length}g residual=${row.residual.files.length}+${row.residual.guards.length}g ${row.parseErrors.length ? "PARSE" : ""}\n`
  );
  rmSync(join(work, "zx", c.slice(0, 12)), { recursive: true, force: true });
}
writeFileSync(outPath, `${JSON.stringify(rows, null, 1)}\n`);
