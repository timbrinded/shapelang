// Builds a prototype CheckInput for Shape's own 1.0 model and runs derive on it.
//
//   bun experiments/shape-1/dogfood/tools/check.ts <mode> [options]
//
// modes:
//   audit                 head = working tree + dogfood files, no base
//   adopt                 base = today's model as `shp migrate` reads it (no overlay), head = the
//                         dogfood model, same code: what adopting the 1.0 model in one change costs
//   adopt-governance      step 1 of 2: base = migrated, head = migrated + shape.governance (owner,
//                         actors, policy, providers, templates) − migration-minted std::Owns rules
//                         + the rebinds of the 4 units 0.x bound to shared files (STEP1_REBINDS)
//   adopt-content         step 2 of 2: base = step 1's head, head = the dogfood model
//   (history replays and seeded scenarios: tools/runs.ts)
// options:
//   --records <dir|file>...      head records    --base-records <dir|file>...
//   --reviews <json>             [{identity, line}]   --authors <json>
//   --now <rfc3339>              default 2026-10-26T00:00:00Z
//   --out <file>                 full output JSON    --input-out <file>  the CheckInput
//   --human                      print renderHuman
//   --partial-summaries          variant: read every `effects complete` summary as `partial`
//                                (0.x summaries list direct effects; 1.0 complete is transitive)
import { writeFileSync } from "node:fs";
import { derive } from "../../proto/src/derive.ts";
import type { CheckInput } from "../../proto/src/io-types.ts";
import { loadModel, readEvidence, rewriteAgainst } from "../../proto/src/loader.ts";
import { renderHuman } from "../../proto/src/render.ts";
import type { Decl, SourceDoc, SourceModule } from "../../proto/src/source.ts";
import { summarize } from "./summary.ts";
import { REPO, composeModel, manifestFor, readModel, readOverlay, workingTreeFiles } from "./lib.ts";

const argv = process.argv.slice(2);
const mode = argv[0] ?? "audit";
const opt = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const many = (k: string): string[] => argv.flatMap((a, i) => (a === `--${k}` && argv[i + 1] ? [argv[i + 1] as string] : []));
const now = opt("now") ?? "2026-10-26T00:00:00Z";

async function build(): Promise<CheckInput> {
  const authors = opt("authors") ? (JSON.parse(opt("authors") as string) as CheckInput["authors"]) : [{ identity: 'github("timbrinded")', verified: true, bot: false }];
  const common = {
    contract: "shape.check.input/v1" as const,
    now,
    change: { ids: ["github:timbrinded/shapelang#dogfood"] },
    authors,
    reviews: opt("reviews") ? (JSON.parse(opt("reviews") as string) as CheckInput["reviews"]) : [],
    records: readEvidence(many("records")),
    baseRecords: readEvidence(many("base-records")),
    persisted: { base: [], head: [] },
    options: { health: true, teeth: argv.includes("--teeth") }
  };
  if (mode === "audit") {
    const hm = await manifestFor(workingTreeFiles());
    return { ...common, mode: "audit", head: { revision: hm.revision, source: readModel(), manifest: hm.statement }, base: null };
  }
  if (mode === "adopt") {
    const hm = await manifestFor(workingTreeFiles());
    const migrated = loadModel(REPO, { maintainers: ["timbrinded"] }).source;
    const baseSource = rewriteAgainst(migrated, hm.statement).source as SourceDoc;
    return {
      ...common,
      mode: "change",
      head: { revision: hm.revision, source: readModel(), manifest: hm.statement },
      base: { revision: hm.revision, source: baseSource, manifest: hm.statement }
    };
  }
  if (mode === "adopt-governance" || mode === "adopt-content") {
    // two-step adoption: step 1 lands the governance module (owner team, actors, policy,
    // providers, templates), drops the migration-minted std::Owns rules and rebinds the units
    // 0.x bound to one shared file (the migrated base's 2 E-overlaps and the 6 E-conduct they
    // cause; without the rebinds step 1's head carries those 8 errors); step 2 lands the rest
    const hm = await manifestFor(workingTreeFiles());
    const full = readOverlay();
    const step1Overlay = { ...full, modules: full.modules.flatMap((m) => step1Module(m)) };
    const step1 = composeModel(hm.statement, step1Overlay).source;
    const migrated = loadModel(REPO, { maintainers: ["timbrinded"] }).source;
    const base = mode === "adopt-governance" ? (rewriteAgainst(migrated, hm.statement).source as SourceDoc) : step1;
    const head = mode === "adopt-governance" ? step1 : readModel();
    return { ...common, mode: "change", head: { revision: hm.revision, source: head, manifest: hm.statement }, base: { revision: hm.revision, source: base, manifest: hm.statement } };
  }
  throw new Error(`unknown mode ${mode}`);
}

/** Units 0.x binds to one shared file: shape.yml (two CI units) and verify-shape-blocks.ts. */
const STEP1_REBINDS = new Set(["shape.delivery::CiPipeline.runShapeCi", "shape.delivery::CiPipeline.runExperimentalSemanticKernel", "shape.delivery::DocsSite.verifyDocs", "shape.language::DocsShapeBlockVerifier.verifyShapeCodeBlocks"]);

/**
 * Step 1's part of an overlay module: all of shape.governance; elsewhere only the unit rebinds and
 * the path globs of their components (DocsShapeBlockVerifier must claim the rest of
 * verify-shape-blocks.ts, or its other functions fall to DocsSite.* and close a calls cycle).
 */
function step1Module(m: SourceModule): SourceModule[] {
  if (m.module === "shape.governance") return [m];
  const decls = m.decls.flatMap((d): Decl[] => {
    if (d.decl !== "component") return [];
    const units = (d.units ?? []).filter((u) => STEP1_REBINDS.has(`${m.module}::${d.name}.${u.name}`) && u.bind).map((u) => ({ name: u.name, bind: u.bind }));
    if (units.length === 0) return [];
    return [d.paths ? { decl: "component", name: d.name, paths: d.paths, units } : { decl: "component", name: d.name, units }];
  });
  return decls.length > 0 ? [{ ...m, decls }] : [];
}

/** 0.x `effects complete` lists a function's own effects; 1.0 reads complete as transitive. */
function partialSummaries(src: SourceDoc | null): SourceDoc | null {
  if (!src) return src;
  return {
    ...src,
    modules: src.modules.map((m) => ({
      ...m,
      decls: m.decls.map((d) => (d.decl === "component" && d.units ? { ...d, units: d.units.map((u) => (u.effects?.mode === "complete" ? { ...u, effects: { ...u.effects, mode: "partial" as const } } : u)) } : d))
    }))
  };
}

const t0 = performance.now();
const built = await build();
const input: CheckInput = argv.includes("--partial-summaries")
  ? { ...built, head: { ...built.head, source: partialSummaries(built.head.source) }, base: built.base ? { ...built.base, source: partialSummaries(built.base.source) } : null }
  : built;
const t1 = performance.now();
const out = derive(input);
const t2 = performance.now();
if (opt("input-out")) writeFileSync(opt("input-out") as string, JSON.stringify(input));
if (opt("out")) writeFileSync(opt("out") as string, JSON.stringify(out, null, 1));
if (argv.includes("--human")) process.stdout.write(`${renderHuman(out)}\n`);
process.stdout.write(`${summarize(out)}\n`);
process.stderr.write(`build ${((t1 - t0) / 1000).toFixed(1)} s, derive ${((t2 - t1) / 1000).toFixed(1)} s; head ${input.head.revision}${input.base ? ` base ${input.base.revision}` : ""}\n`);
