// Manual classification of every C4 flag after reading the code. A flag is an
// authored calls relation the call graph did not confirm (contradicted or
// unconfirmed) or an observed component edge with no authored relation.
//   true - the discrepancy is real (authored relation has no call in code, or
//          an undeclared call between the two components exists)
//   fp   - an artifact of the method (non-TypeScript endpoint, generated code,
//          shared file membership, symbol-level attribution)
// Usage: bun manual.mjs  (checks coverage against $CWORK/c4/calls.json)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORK } from "../lib/work.mjs";

const NON_TS = "the relation is realised in non-TypeScript code (CI YAML, shell, Rust/WASM, Langium grammar, Astro config)";
const DATA = "no runtime call exists (no non-type import); the relation records a data dependency under kind calls, which the docs define as 'A component calls another'";
export const MANUAL = {
  symbol: {
    "unconfirmed ShapeIncrementalChecker -> ShapeStringHelpers": ["fp", "incremental.ts calls compareCodepointStrings in shape-strings.ts, which is not a modelled fn"],
    "unconfirmed ShapeBindings -> ShapeModelLowerer": ["true", DATA],
    "unconfirmed ShapeBindings -> ShapeStringHelpers": ["fp", "globs.ts calls normalizeShapePath in shape-strings.ts, not a modelled fn"],
    "unconfirmed ShapeDiagnostics -> ShapeRuleEngine": ["true", DATA],
    "unconfirmed ShapeModelLowerer -> ShapeParser": ["true", DATA],
    "unconfirmed ShapeRuleEngine -> ShapeModelLowerer": ["true", `${DATA}; the code has the reverse edge (lowerer -> derivations.ts)`],
    "unconfirmed CiPipeline -> ExperimentalSemanticKernel": ["fp", NON_TS],
    "unconfirmed CiPipeline -> ExperimentalSemanticKernelHarness": ["fp", NON_TS],
    "unconfirmed CiPipeline -> ShpCli": ["fp", NON_TS],
    "unconfirmed DocsSite -> DocsShapeBlockVerifier": ["fp", "both components cite the same file, so calls between them are internal to the shared members"],
    "unconfirmed DocsSite -> ShapeGrammar": ["fp", NON_TS],
    "unconfirmed ShapeParser -> ShapeGrammar": ["fp", "the parser uses Langium code generated from the grammar; ShapeGrammar has no TypeScript members"],
    "unconfirmed ExperimentalSemanticKernelHarness -> ExperimentalSemanticKernel": ["fp", NON_TS],
    "unconfirmed ShapeFormatter -> ShapeParser": ["fp", "formatter.ts#formatShapeSource (not modelled) calls parseShapeModule"],
    "undeclared ShapeChecker -> ShapeParser": ["true", "checkShapeFiles calls parseShapeModule (only the coordinated_call relation mentions it)"],
    "undeclared ShapeModelLowerer -> ShapeRuleEngine": ["true", "lowering calls derivations.ts#requiresReevaluation"],
    "undeclared DocsSite -> ShapeParser": ["fp", "shared file with DocsShapeBlockVerifier, whose edge is declared"],
    "undeclared ExperimentalSemanticKernelHarness -> ShapeParser": ["true", "benchmark.ts#checkSource calls parseShapeModule"],
    "undeclared ShapeAstGenerator -> ShapeParser": ["fp", "attributed through formatter.ts#formatShapeSource; the direct dependency is on the formatter"],
    "undeclared ShapeAstGenerator -> ShapeFormatter": ["true", "formatGeneratedShape calls formatShapeSource -> formatShapeModule"],
    "undeclared ShapeEditorServices -> ShapeDiagnostics": ["true", "diagnosticToEditorDiagnostic calls formatDiagnostics"],
    "undeclared ShpCli -> ShapeParser": ["true", "loadBaseModules and loadShapeModules call parseShapeModule"],
    "undeclared ShpCli -> ShapeModelLowerer": ["fp", "attributed through query.ts#listMemoryGuardsShapeModules, a ShapeChecker-file API"]
  },
  file: {
    "unconfirmed ShapeBindings -> ShapeModelLowerer": ["true", DATA],
    "unconfirmed ShapeDiagnostics -> ShapeRuleEngine": ["true", DATA],
    "unconfirmed ShapeModelLowerer -> ShapeParser": ["true", DATA],
    "unconfirmed ShapeRuleEngine -> ShapeModelLowerer": ["true", DATA],
    "unconfirmed CiPipeline -> ExperimentalSemanticKernel": ["fp", NON_TS],
    "unconfirmed CiPipeline -> ExperimentalSemanticKernelHarness": ["fp", NON_TS],
    "unconfirmed CiPipeline -> ShpCli": ["fp", NON_TS],
    "unconfirmed DocsSite -> DocsShapeBlockVerifier": ["fp", "shared file membership"],
    "unconfirmed DocsSite -> ShapeGrammar": ["fp", NON_TS],
    "unconfirmed ShapeParser -> ShapeGrammar": ["fp", "generated Langium code; no TypeScript members"],
    "unconfirmed ExperimentalSemanticKernelHarness -> ExperimentalSemanticKernel": ["fp", NON_TS],
    "undeclared ShapeChecker -> ShapeParser": ["true", "checkShapeFiles calls parseShapeModule"],
    "undeclared ShapeChecker -> ShapeModuleResolver": ["true", "explainShapeModules calls splitFunctionReference"],
    "undeclared ShapeDiagnostics -> ShapeStringHelpers": ["true", "compareShapeDiagnostics calls compareCodepointStrings"],
    "undeclared ShapeDiagnostics -> ShapeModuleResolver": ["true", "display.ts calls splitModuleReference"],
    "undeclared ShapeModelLowerer -> ShapeRuleEngine": ["true", "change-planning.ts calls derivations.ts#hasNonEmptyDescription"],
    "undeclared ShapeModelLowerer -> ShapeBindings": ["fp", "coverage.ts is cited by both ShapeBindings and ShapeRuleEngine; attestationKey's owner is ambiguous"],
    "undeclared ShapeRuleEngine -> ShapeModuleResolver": ["true", "guards.ts calls splitFunctionReference"],
    "undeclared CiPipeline -> ShapeStringHelpers": ["true", "generate-ast-shapes.ts uses compareCodepointStrings"],
    "undeclared DocsSite -> ShapeParser": ["fp", "shared file with DocsShapeBlockVerifier"],
    "undeclared ExperimentalSemanticKernelHarness -> ShapeParser": ["true", "benchmark.ts calls parseShapeModule"],
    "undeclared ExperimentalSemanticKernelHarness -> ShapeStringHelpers": ["true", "e2e.ts calls compareCodepointStrings"],
    "undeclared ShapeAstGenerator -> ShapeStringHelpers": ["true", "fingerprints use compareCodepointStrings"],
    "undeclared ShapeAstGenerator -> ShapeFormatter": ["true", "formatGeneratedShape calls formatShapeSource"],
    "undeclared ShapeEditorServices -> ShapeStringHelpers": ["true", "editor sorts with compareCodepointStrings"],
    "undeclared ShapeEditorServices -> ShapeDiagnostics": ["true", "diagnosticToEditorDiagnostic calls formatDiagnostics"],
    "undeclared ShapeEditorServices -> ShapeModuleResolver": ["true", "editor -> display.ts -> splitModuleReference"],
    "undeclared ShapeLanguageServer -> ShapeStringHelpers": ["true", "server sorts with compareCodepointStrings"],
    "undeclared ShpCli -> ShapeParser": ["true", "loadShapeModules calls parseShapeModule"],
    "undeclared ShpCli -> ShapeStringHelpers": ["true", "ast impl uses compareCodepointStrings"]
  }
};

const results = JSON.parse(readFileSync(join(WORK, "c4/calls.json"), "utf8")).filter((r) => r.name === "shape");
for (const r of results) {
  const flags = [
    ...r.pairs.filter((p) => p.status.startsWith("contradicted") || p.status.startsWith("unconfirmed")).map((p) => `unconfirmed ${p.from} -> ${p.to}`),
    ...r.undeclared.transitive.map((u) => `undeclared ${u.from} -> ${u.to}`)
  ];
  const table = MANUAL[r.membership];
  const missing = flags.filter((f) => !table[f]);
  const stale = Object.keys(table).filter((k) => !flags.includes(k));
  if (missing.length || stale.length) throw new Error(`${r.membership}: unclassified ${missing.join("; ")} | stale ${stale.join("; ")}`);
  const count = (prefix, cls) => flags.filter((f) => f.startsWith(prefix) && table[f][0] === cls).length;
  const t = count("", "true");
  console.log(`${r.membership}-level: flags ${flags.length} (unconfirmed ${flags.filter((f) => f.startsWith("unconfirmed")).length}: true ${count("unconfirmed", "true")}; undeclared ${flags.filter((f) => f.startsWith("undeclared")).length}: true ${count("undeclared", "true")}); precision ${(100 * t / flags.length).toFixed(1)}%`);
}
