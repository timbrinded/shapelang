// @ts-nocheck
// H2 drift seeds and controls. Each seed is one edit applied to a fresh copy of the repository
// (HEAD plus the dogfood files). `expect` names the obligation(s) that would surface the drift
// at this change under the 1.0 model (MODEL.md §4.4, §5.3, §7.3), written before any run;
// `predict` is the a-priori guess of what the prototype will do with the dogfood providers.
//
// Exp: { kind, claim?: substrings of the claim id (any), at?: substring that must occur in the
// obligation's subject, facts, witness or affected identities, code?: error code }
import { Tree, codeFiles } from "./harness.ts";

const CK = "packages/shp-checker/src";
const CLI = "packages/shp-cli/src";

const clockAt = (at: string, claims: string[]) => [{ kind: "contradiction", claim: claims, at }];
const unbound = (unit: string) => ({ kind: "error", code: "E-unbound", at: unit });

export interface Seed {
  id: string;
  cat: "S" | "R" | "E" | "M" | "N" | "L" | "C";
  kind: "drift" | "control";
  title: string;
  expect: { A?: unknown[]; X?: unknown[] };
  predict: { A: string; X?: string };
  apply: (t: Tree) => void;
}

export const SEEDS: Seed[] = [
  // ---- S: an undeclared call between components ----------------------------------------------
  {
    id: "S01",
    cat: "S",
    kind: "drift",
    title: "ShapeAnalyzer calls ShapeChecker directly (AnalyzerStaysAdvisory path)",
    expect: {
      A: [{ kind: "contradiction", claim: ["AnalyzerStaysAdvisory"] }],
      X: [{ kind: "contradiction", claim: ["AnalyzerStaysAdvisory", "ShapeAnalyzer"] }]
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) => {
      t.pre(
        `${CK}/analyzer-shape.ts`,
        'import { checkShapeModules as h2Check } from "./checker/api.ts";\n'
      );
      t.ins(
        `${CK}/analyzer-shape.ts`,
        "  const declaredEffectsByPath = collectDeclaredEffectsBySourcePath(modules);\n  const warnings: AnalyzerWarning[] = [];\n",
        "  if (hints.length < 0) h2Check([]);\n"
      );
    }
  },
  {
    id: "S02",
    cat: "S",
    kind: "drift",
    title:
      "ShapeAnalyzer calls ShapeEditorServices, which calls ShapeChecker (2-hop forbidden path)",
    expect: {
      A: [{ kind: "contradiction", claim: ["AnalyzerStaysAdvisory"] }],
      X: [{ kind: "contradiction", claim: ["AnalyzerStaysAdvisory", "ShapeAnalyzer"] }]
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) => {
      t.pre(
        `${CK}/analyzer-shape.ts`,
        'import { getCompletions as h2Completions } from "./editor.ts";\n'
      );
      t.ins(
        `${CK}/analyzer-shape.ts`,
        "  const declaredEffectsByPath = collectDeclaredEffectsBySourcePath(modules);\n  const warnings: AnalyzerWarning[] = [];\n",
        '  if (hints.length < 0) h2Completions("");\n'
      );
    }
  },
  {
    id: "S03",
    cat: "S",
    kind: "drift",
    title:
      "ShpCli runs the Rust semantic kernel as a subprocess (cross-language call into ExperimentalSemanticKernel)",
    expect: { A: [{ kind: "contradiction", claim: ["ExperimentalSemanticKernelIsolation"] }] },
    predict: { A: "miss (no observer of process-level calls)", X: "miss" },
    apply: (t) => {
      t.rep(
        `${CLI}/commands/inspect/impl.ts`,
        "): Promise<void> {\n  if (!flags.json) {",
        '): Promise<void> {\n  if (providedFiles.length < 0) Bun.spawnSync(["cargo", "run", "--manifest-path", "experiments/semantic-kernel/Cargo.toml"]);\n  if (!flags.json) {'
      );
    }
  },
  {
    id: "S04",
    cat: "S",
    kind: "drift",
    title:
      "ShpCli calls the kernel harness (declared Harness->Kernel completes a forbidden path to the kernel)",
    expect: {
      A: [{ kind: "contradiction", claim: ["ExperimentalSemanticKernelIsolation"] }],
      X: [{ kind: "contradiction", claim: ["ExperimentalSemanticKernelIsolation", "ShpCli"] }]
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) => {
      t.pre(
        `${CLI}/commands/inspect/impl.ts`,
        'import { createKernelRequestV1 as h2Request } from "../../../../../experiments/semantic-kernel/harness/protocol.ts";\n'
      );
      t.rep(
        `${CLI}/commands/inspect/impl.ts`,
        "): Promise<void> {\n  if (!flags.json) {",
        "): Promise<void> {\n  if (providedFiles.length < 0) h2Request([]);\n  if (!flags.json) {"
      );
    }
  },
  {
    id: "S05",
    cat: "S",
    kind: "drift",
    title: "ShapeGrammar calls ShapeParser (new calls cycle Grammar<->Parser)",
    expect: {
      A: [{ kind: "contradiction", claim: ["no_runtime_dependency_cycles"], at: "ShapeGrammar" }],
      X: [
        {
          kind: "contradiction",
          claim: ["no_runtime_dependency_cycles", "ShapeGrammar"],
          at: "ShapeParser"
        }
      ]
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) => {
      t.pre(
        `${CK}/language/shape-module.ts`,
        'import { parseShapeModule as h2Parse } from "../parser.ts";\n'
      );
      t.ins(
        `${CK}/language/shape-module.ts`,
        "export function createShapeServices(): ShapeServices {\n",
        '  if (Number.NaN > 0) h2Parse("");\n'
      );
    }
  },
  {
    id: "S06",
    cat: "S",
    kind: "drift",
    title: "ShapeStringHelpers calls ShapeFormatter (new calls cycle)",
    expect: {
      A: [
        { kind: "contradiction", claim: ["no_runtime_dependency_cycles"], at: "ShapeStringHelpers" }
      ],
      X: [
        {
          kind: "contradiction",
          claim: ["no_runtime_dependency_cycles", "ShapeStringHelpers"],
          at: "ShapeFormatter"
        }
      ]
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) => {
      t.pre(
        `${CK}/shape-strings.ts`,
        'import { formatShapeSource as h2Format } from "./formatter.ts";\n'
      );
      t.ins(
        `${CK}/shape-strings.ts`,
        "export function normalizeShapePath(path: string): string {\n",
        '  if (path.length < 0) h2Format("");\n'
      );
    }
  },
  {
    id: "S07",
    cat: "S",
    kind: "drift",
    title: "ShapeDiagnostics calls ShapeChecker (joins the existing checker SCC)",
    expect: {
      A: [
        { kind: "contradiction", claim: ["no_runtime_dependency_cycles"], at: "ShapeDiagnostics" }
      ],
      X: [
        {
          kind: "contradiction",
          claim: ["no_runtime_dependency_cycles", "ShapeDiagnostics"],
          at: "ShapeChecker"
        }
      ]
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) => {
      t.pre(
        `${CK}/checker/display.ts`,
        'import { normalizeCheckOptions as h2Options } from "./api.ts";\n'
      );
      t.ins(
        `${CK}/checker/display.ts`,
        "export function localNameOf(name: string): string {\n",
        "  if (name.length < 0) h2Options({});\n"
      );
    }
  },
  {
    id: "S08",
    cat: "S",
    kind: "drift",
    title: "ShapeRuleEngine calls ShapeBindings (undeclared edge inside the existing checker SCC)",
    expect: {
      A: [{ kind: "contradiction", claim: ["no_runtime_dependency_cycles"] }],
      X: [{ kind: "contradiction", claim: ["ShapeRuleEngine"], at: "ShapeBindings" }]
    },
    predict: { A: "hit (new fact in the SCC's support)", X: "hit" },
    apply: (t) => {
      t.pre(
        `${CK}/checker/rules/guards.ts`,
        'import { checkBindings as h2Bindings } from "./coverage.ts";\n'
      );
      t.ins(
        `${CK}/checker/rules/guards.ts`,
        "export function buildGuardContexts(model: Model): GuardContext[] {\n",
        '  if (model === undefined) h2Bindings(model, [], "");\n'
      );
    }
  },
  {
    id: "S09",
    cat: "S",
    kind: "drift",
    title: "ShapeAuthoring calls ShapeFormatter (undeclared, no forbid covers it)",
    expect: { X: [{ kind: "contradiction", claim: ["ShapeAuthoring"], at: "ShapeFormatter" }] },
    predict: { A: "miss (no claim excludes the edge)", X: "hit" },
    apply: (t) => {
      t.pre(`${CK}/critic.ts`, 'import { formatShapeSource as h2Format } from "./formatter.ts";\n');
      t.ins(
        `${CK}/critic.ts`,
        "): GuardedTargetWithoutReevaluationAdvisory[] {\n",
        '  if (existingFiles.length < 0) h2Format("");\n'
      );
    }
  },
  {
    id: "S10",
    cat: "S",
    kind: "drift",
    title: "ShapeLanguageServer calls ShapeParser (undeclared, no forbid covers it)",
    expect: { X: [{ kind: "contradiction", claim: ["ShapeLanguageServer"], at: "ShapeParser" }] },
    predict: { A: "miss (no claim excludes the edge)", X: "hit" },
    apply: (t) => {
      t.pre(
        `${CLI}/lsp/server.ts`,
        'import { parseShapeModule as h2Parse } from "@shape/shp-checker";\n'
      );
      t.ins(
        `${CLI}/lsp/server.ts`,
        "export function startShapeLanguageServer(): void {\n",
        '  if (process.argv.length < 0) h2Parse("");\n'
      );
    }
  },
  {
    id: "S11",
    cat: "S",
    kind: "drift",
    title: "ShapeEditorServices calls ShapeAnalyzer (undeclared, no forbid covers it)",
    expect: { X: [{ kind: "contradiction", claim: ["ShapeEditorServices"], at: "ShapeAnalyzer" }] },
    predict: { A: "miss (no claim excludes the edge)", X: "hit" },
    apply: (t) => {
      t.pre(`${CK}/editor.ts`, 'import { analyzeSourceText as h2Analyze } from "./analyzer.ts";\n');
      t.ins(
        `${CK}/editor.ts`,
        'export function getCompletions(source: string, prefix = ""): string[] {\n',
        '  if (prefix.length < 0) h2Analyze("", "");\n'
      );
    }
  },
  {
    id: "S12",
    cat: "S",
    kind: "drift",
    title: "ExperimentalSemanticKernelHarness calls ShapeFormatter (undeclared, low tier)",
    expect: {
      X: [
        {
          kind: "contradiction",
          claim: ["ExperimentalSemanticKernelHarness"],
          at: "ShapeFormatter"
        }
      ]
    },
    predict: { A: "miss (no claim excludes the edge)", X: "hit" },
    apply: (t) => {
      t.pre(
        "experiments/semantic-kernel/harness/protocol.ts",
        'import { formatShapeSource as h2Format } from "../../../packages/shp-checker/src/formatter.ts";\n'
      );
      t.ins(
        "experiments/semantic-kernel/harness/protocol.ts",
        "export function createKernelRequestV1(facts: readonly Fact[]): KernelRequestV1 {\n",
        '  if (facts.length < 0) h2Format("");\n'
      );
    }
  },

  // ---- R: a declared call removed --------------------------------------------------------------
  {
    id: "R01",
    cat: "R",
    kind: "drift",
    title:
      "ShapeChecker stops calling ShapeBindings (relation ShapeCheckerUsesBindings no longer realised)",
    expect: { A: [{ kind: "contradiction", claim: ["ShapeCheckerUsesBindings"] }] },
    predict: { A: "miss (refutation needs an absence-sound call observer)", X: "hit (refuted)" },
    apply: (t) =>
      t.rep(
        `${CK}/checker/api.ts`,
        "    ...(normalizedOptions.enforceBindings === false\n      ? []\n      : checkBindings(\n          model,\n          normalizedOptions.changedFiles ?? [],\n          normalizedOptions.repoRoot,\n          normalizedOptions.base\n        ))\n",
        "    ...([] as SemanticDiagnostic[])\n"
      )
  },
  {
    id: "R02",
    cat: "R",
    kind: "drift",
    title:
      "ShapeEditorServices.formatOnSave stops calling ShapeFormatter (ShapeEditorUsesFormatter)",
    expect: { A: [{ kind: "contradiction", claim: ["ShapeEditorUsesFormatter"] }] },
    predict: { A: "miss", X: "hit (refuted)" },
    apply: (t) =>
      t.rep(
        `${CK}/editor.ts`,
        "  return formatShapeSource(source, filePath);\n",
        "  void filePath;\n  return { ok: true, formatted: source };\n"
      )
  },
  {
    id: "R03",
    cat: "R",
    kind: "drift",
    title: "shp fmt stops calling ShapeFormatter (ShpCliUsesFormatter)",
    expect: { A: [{ kind: "contradiction", claim: ["ShpCliUsesFormatter"] }] },
    predict: { A: "miss", X: "hit (refuted)" },
    apply: (t) =>
      t.rep(
        `${CLI}/commands/fmt/impl.ts`,
        "    const result = formatShapeSource(source, file);\n",
        "    const result = { ok: true as const, formatted: source, diagnostics: [] as { filePath: string; message: string }[] };\n"
      )
  },
  {
    id: "R04",
    cat: "R",
    kind: "drift",
    title:
      "ShapeRuleEngine inlines isReevaluationRequirement (ShapeRuleEngineUsesPreludeRegistry, behaviour kept)",
    expect: { A: [{ kind: "contradiction", claim: ["ShapeRuleEngineUsesPreludeRegistry"] }] },
    predict: { A: "miss", X: "hit (refuted)" },
    apply: (t) =>
      t.rep(
        `${CK}/checker/derivations.ts`,
        "  return isReevaluationRequirement(guard.requirement);\n",
        '  const normalized = guard.requirement.replace(/\\s+/g, "").toLowerCase();\n  return normalized === "reevaluation" || normalized === "reevaluation<self>";\n'
      )
  },
  {
    id: "R05",
    cat: "R",
    kind: "drift",
    title:
      "ShapeAuthoring inlines isReevaluationRequirement (ShapeAuthoringUsesPreludeRegistry, behaviour kept)",
    expect: { A: [{ kind: "contradiction", claim: ["ShapeAuthoringUsesPreludeRegistry"] }] },
    predict: { A: "miss", X: "hit (refuted)" },
    apply: (t) =>
      t.rep(
        `${CK}/critic.ts`,
        "(entry) => isGuardRequireDecl(entry) && isReevaluationRequirement(entry.requirement)",
        '(entry) => isGuardRequireDecl(entry) && ["reevaluation", "reevaluation<self>"].includes(entry.requirement.replace(/\\s+/g, "").toLowerCase())'
      )
  },
  {
    id: "R06",
    cat: "R",
    kind: "drift",
    title:
      "ShapeIncrementalChecker stops calling compareCodepointStrings (ShapeIncrementalCheckerUsesStringHelpers)",
    expect: { A: [{ kind: "contradiction", claim: ["ShapeIncrementalCheckerUsesStringHelpers"] }] },
    predict: { A: "miss", X: "hit (refuted)" },
    apply: (t) =>
      t.rep(
        `${CK}/checker/incremental.ts`,
        "    compareCodepointStrings(left.filePath, right.filePath)\n  );",
        "    left.filePath < right.filePath ? -1 : left.filePath > right.filePath ? 1 : 0\n  );"
      )
  },
  {
    id: "R07",
    cat: "R",
    kind: "drift",
    title: "shp lsp stops starting the language server (ShpCliUsesLanguageServer)",
    expect: { A: [{ kind: "contradiction", claim: ["ShpCliUsesLanguageServer"] }] },
    predict: { A: "miss", X: "hit (refuted)" },
    apply: (t) =>
      t.rep(
        `${CLI}/commands/lsp/impl.ts`,
        "  startShapeLanguageServer();\n",
        "  void startShapeLanguageServer;\n"
      )
  },

  // ---- E: an undeclared effect through a bound resource ----------------------------------------
  {
    id: "E01",
    cat: "E",
    kind: "drift",
    title: "Date.now() in ShapeRuleEngine.checkFreshness (CheckerNeverReadsClock, critical)",
    expect: {
      A: clockAt("guards.ts#checkFreshness", [
        "CheckerNeverReadsClock",
        "checkFreshness/effects.upper",
        "ShapeRuleEngine"
      ])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.ins(
        `${CK}/checker/rules/guards.ts`,
        "export function checkFreshness(model: Model, asOf: IsoDateString): SemanticDiagnostic[] {\n  const diagnostics: SemanticDiagnostic[] = [];\n",
        "  const startedAt = Date.now();\n  void startedAt;\n"
      )
  },
  {
    id: "E02",
    cat: "E",
    kind: "drift",
    title: "new Date() in ShapeModelLowerer.lowerChange",
    expect: {
      A: clockAt("changes.ts#lowerChange", [
        "CheckerNeverReadsClock",
        "lowerChange/effects.upper",
        "ShapeModelLowerer"
      ])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.ins(
        `${CK}/checker/lowering/changes.ts`,
        "export function lowerChange(change: ChangeDecl, context: LoweringContext, model: Model): void {\n",
        "  const loweredAt = new Date().toISOString();\n  void loweredAt;\n"
      )
  },
  {
    id: "E03",
    cat: "E",
    kind: "drift",
    title: "performance.now() in a ShapeStringHelpers helper no unit binds (normalizeShapePath)",
    expect: {
      A: clockAt("shape-strings.ts#normalizeShapePath", [
        "CheckerNeverReadsClock",
        "ShapeStringHelpers"
      ])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.ins(
        `${CK}/shape-strings.ts`,
        "export function normalizeShapePath(path: string): string {\n",
        "  const t0 = performance.now();\n  void t0;\n"
      )
  },
  {
    id: "E04",
    cat: "E",
    kind: "drift",
    title: "process.hrtime() in ShapeDiagnostics.compareShapeDiagnostics",
    expect: {
      A: clockAt("diagnostics.ts#compareShapeDiagnostics", [
        "CheckerNeverReadsClock",
        "compareShapeDiagnostics/effects.upper",
        "ShapeDiagnostics"
      ])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.ins(
        `${CK}/checker/diagnostics.ts`,
        "export function compareShapeDiagnostics(left: ShapeDiagnostic, right: ShapeDiagnostic): number {\n",
        "  void process.hrtime();\n"
      )
  },
  {
    id: "E05",
    cat: "E",
    kind: "drift",
    title: "Date.now() in the IncrementalShapeChecker.check method",
    expect: {
      A: clockAt("incremental.ts#IncrementalShapeChecker.check", [
        "CheckerNeverReadsClock",
        "ShapeIncrementalChecker"
      ])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.ins(
        `${CK}/checker/incremental.ts`,
        "  ): IncrementalCheckResult {\n    const sortedDocuments = normalizeDocuments(documents);\n",
        "    const checkedAt = Date.now();\n    void checkedAt;\n"
      )
  },
  {
    id: "E06",
    cat: "E",
    kind: "drift",
    title: "Date.now() in ShapeFormatter.formatShapeModule (ClockReadOnlyAtCliBoundary, normal)",
    expect: {
      A: clockAt("formatter.ts#formatShapeModule", [
        "ClockReadOnlyAtCliBoundary",
        "formatShapeModule/effects.upper",
        "ShapeFormatter"
      ])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.ins(
        `${CK}/formatter.ts`,
        "export function formatShapeModule(module: ShapeModule): string {\n  const chunks: string[] = [];\n",
        "  const formattedAt = Date.now();\n  void formattedAt;\n"
      )
  },
  {
    id: "E07",
    cat: "E",
    kind: "drift",
    title: "performance.now() in ShapeAnalyzer.analyzeSourceText",
    expect: {
      A: clockAt("analyzer.ts#analyzeSourceText", [
        "ClockReadOnlyAtCliBoundary",
        "analyzeSourceText/effects.upper",
        "ShapeAnalyzer"
      ])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.ins(
        `${CK}/analyzer.ts`,
        "export function analyzeSourceText(sourcePath: string, source: string): AnalyzerHint[] {\n",
        "  const scanStarted = performance.now();\n  void scanStarted;\n"
      )
  },
  {
    id: "E08",
    cat: "E",
    kind: "drift",
    title:
      "Date.now() in ShpCli inspect (granted at the CLI, but forbidden outside isoToday and main)",
    expect: {
      A: clockAt("inspect/impl.ts#inspect", [
        "ClockReadOnlyAtCliBoundary",
        "inspectShapeModel/effects.upper"
      ])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.rep(
        `${CLI}/commands/inspect/impl.ts`,
        "): Promise<void> {\n  if (!flags.json) {",
        "): Promise<void> {\n  const inspectedAt = Date.now();\n  void inspectedAt;\n  if (!flags.json) {"
      )
  },
  {
    id: "E09",
    cat: "E",
    kind: "drift",
    title: "new Date() at top level of a DocsSite script test (authority, low tier)",
    expect: { A: clockAt("verify-shape-blocks.test.ts", ["DocsSite"]) },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.append(
        "docs-site/scripts/verify-shape-blocks.test.ts",
        "\nconst h2StartedAt = new Date();\nvoid h2StartedAt;\n"
      )
  },
  {
    id: "E10",
    cat: "E",
    kind: "drift",
    title: "Date.now() in ShapeParser.parseShapeModule",
    expect: {
      A: clockAt("parser.ts#parseShapeModule", [
        "ClockReadOnlyAtCliBoundary",
        "parseShapeModule/effects.upper",
        "ShapeParser"
      ])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.ins(
        `${CK}/parser.ts`,
        "): ParseShapeModuleResult {\n  const services = createShapeServices();\n",
        "  const parsedAt = Date.now();\n  void parsedAt;\n"
      )
  },
  {
    id: "E11",
    cat: "E",
    kind: "drift",
    title: "Date.now() in ShapePreludeRegistry.isReevaluationRequirement",
    expect: {
      A: clockAt("prelude.ts#isReevaluationRequirement", [
        "CheckerNeverReadsClock",
        "isReevaluationRequirement/effects.upper",
        "ShapePreludeRegistry"
      ])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.ins(
        `${CK}/prelude.ts`,
        "export function isReevaluationRequirement(requirement: string): boolean {\n",
        "  const checkedAt = Date.now();\n  void checkedAt;\n"
      )
  },
  {
    id: "E12",
    cat: "E",
    kind: "drift",
    title:
      "Clock read through an alias (const clock = Date; clock.now()) in ShapeChecker.staleAttestationPruner",
    expect: {
      A: [
        {
          kind: "contradiction",
          claim: ["CheckerNeverReadsClock", "staleAttestationPruner/effects.upper", "ShapeChecker"],
          at: "api.ts"
        },
        { kind: "coverage", at: "api.ts" }
      ]
    },
    predict: {
      A: "coverage only (the scan marks the file incomplete, no fact)",
      X: "coverage only"
    },
    apply: (t) =>
      t.ins(
        `${CK}/checker/api.ts`,
        "): (module: ShapeModule) => AttestationRemoval {\n",
        "  const clock = Date;\n  void clock.now();\n"
      )
  },
  {
    id: "E13",
    cat: "E",
    kind: "drift",
    title:
      "ShapeChecker.explainShapeModules calls ShpCli.isoToday (clock read reached through a call)",
    expect: {
      A: [
        {
          kind: "contradiction",
          claim: ["explainShapeModules/effects.upper"],
          at: "freshness.ts#isoToday"
        },
        { kind: "contradiction", claim: ["no_runtime_dependency_cycles"], at: "ShpCli" }
      ]
    },
    predict: { A: "hit (summary contradiction via a call hop, plus a cycle)", X: "hit" },
    apply: (t) => {
      t.pre(
        `${CK}/checker/query.ts`,
        'import { isoToday as h2IsoToday } from "../../../shp-cli/src/freshness.ts";\n'
      );
      t.ins(
        `${CK}/checker/query.ts`,
        "export function explainShapeModules(\n  modules: ShapeModule[] | CheckModuleInput[],\n  symbol: string\n): string {\n",
        "  if (symbol.length < 0) void h2IsoToday();\n"
      );
    }
  },
  {
    id: "E14",
    cat: "E",
    kind: "drift",
    title: "New ShapeRuleEngine helper reads Date.now(); checkCoverage calls it",
    expect: {
      A: [
        {
          kind: "contradiction",
          claim: ["CheckerNeverReadsClock", "ShapeRuleEngine"],
          at: "coverage.ts#coverageClock"
        },
        { kind: "contradiction", claim: ["checkCoverage/effects.upper"] }
      ]
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) => {
      t.rep(
        `${CK}/checker/rules/coverage.ts`,
        "export function checkCoverage(\n  model: Model,\n  changedFiles: string[],\n  repoRoot: string,\n  base?: BaseModel\n): SemanticDiagnostic[] {\n",
        "export function checkCoverage(\n  model: Model,\n  changedFiles: string[],\n  repoRoot: string,\n  base?: BaseModel\n): SemanticDiagnostic[] {\n  void coverageClock();\n"
      );
      t.append(
        `${CK}/checker/rules/coverage.ts`,
        "\nfunction coverageClock(): number {\n  return Date.now();\n}\n"
      );
    }
  },
  {
    id: "E15",
    cat: "E",
    kind: "drift",
    title: "globalThis.Date.now() in ShapeBindings.checkBindings",
    expect: {
      A: clockAt("coverage.ts#checkBindings", [
        "CheckerNeverReadsClock",
        "checkBindings/effects.upper",
        "ShapeBindings"
      ])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.rep(
        `${CK}/checker/rules/coverage.ts`,
        "export function checkBindings(\n  model: Model,\n  changedFiles: string[],\n  repoRoot: string,\n  base?: BaseModel\n): SemanticDiagnostic[] {\n",
        "export function checkBindings(\n  model: Model,\n  changedFiles: string[],\n  repoRoot: string,\n  base?: BaseModel\n): SemanticDiagnostic[] {\n  void globalThis.Date.now();\n"
      )
  },
  {
    id: "E16",
    cat: "E",
    kind: "drift",
    title:
      "performance.now() in ExperimentalSemanticKernelHarness.createKernelRequestV1 (low tier)",
    expect: {
      A: clockAt("protocol.ts#createKernelRequestV1", ["ExperimentalSemanticKernelHarness"])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.ins(
        "experiments/semantic-kernel/harness/protocol.ts",
        "export function createKernelRequestV1(facts: readonly Fact[]): KernelRequestV1 {\n",
        "  const requestedAt = performance.now();\n  void requestedAt;\n"
      )
  },
  {
    id: "E17",
    cat: "E",
    kind: "drift",
    title:
      "ShapeFormatter writes a .shape file (Write<ShapeSource>, fs.path resource code; ungranted)",
    expect: {
      A: [
        {
          kind: "contradiction",
          claim: ["ShapeFormatter", "formatShapeModule/effects.upper"],
          at: "formatter.ts#formatShapeModule"
        }
      ]
    },
    predict: { A: "miss (no fs.path observer); coverage at most", X: "miss" },
    apply: (t) => {
      t.pre(`${CK}/formatter.ts`, 'import { writeFileSync as h2Write } from "node:fs";\n');
      t.ins(
        `${CK}/formatter.ts`,
        "export function formatShapeModule(module: ShapeModule): string {\n  const chunks: string[] = [];\n",
        '  if (chunks.length > 0) h2Write("shape/h2.shape", "");\n'
      );
    }
  },
  {
    id: "E18",
    cat: "E",
    kind: "drift",
    title: "new Date() in ShapeAuthoring.generateShapeUpdateDraft",
    expect: {
      A: clockAt("authoring.ts#generateShapeUpdateDraft", [
        "ClockReadOnlyAtCliBoundary",
        "generateShapeUpdateDraft/effects.upper",
        "ShapeAuthoring"
      ])
    },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.ins(
        `${CK}/authoring.ts`,
        "export function generateShapeUpdateDraft(input: ShapeUpdateInput): string {\n",
        "  const draftedAt = new Date().toISOString();\n  void draftedAt;\n"
      )
  },

  // ---- M: a function moved ---------------------------------------------------------------------
  {
    id: "M01",
    cat: "M",
    kind: "drift",
    title: "Move checkFreshness to a new file in ShapeRuleEngine (rules/freshness.ts)",
    expect: { A: [unbound("checkFreshness")] },
    predict: { A: "hit (E-unbound)", X: "hit" },
    apply: (t) => {
      const fn = t.cutFunction(`${CK}/checker/rules/guards.ts`, "export function checkFreshness(");
      t.write(
        `${CK}/checker/rules/freshness.ts`,
        'import type { Model, SemanticDiagnostic } from "../model.ts";\nimport type { IsoDateString } from "../iso-date.ts";\nimport { isIsoCalendarDate } from "../iso-date.ts";\nimport { describeProvenance } from "../provenance.ts";\nimport { allContexts } from "./context.ts";\n\n' +
          fn
      );
      t.rep(
        `${CK}/checker/rules.ts`,
        'import { checkFreshness, checkGuardedChanges, checkGuardedSources } from "./rules/guards.ts";',
        'import { checkGuardedChanges, checkGuardedSources } from "./rules/guards.ts";\nimport { checkFreshness } from "./rules/freshness.ts";'
      );
    }
  },
  {
    id: "M02",
    cat: "M",
    kind: "drift",
    title:
      "Move unquoteShapeString from ShapeStringHelpers into formatter.ts (ShapeFormatter), re-exported",
    expect: { A: [unbound("unquoteShapeString")] },
    predict: { A: "hit (E-unbound)", X: "hit" },
    apply: (t) => {
      const fn = t.cutFunction(`${CK}/shape-strings.ts`, "export function unquoteShapeString(");
      t.append(`${CK}/shape-strings.ts`, 'export { unquoteShapeString } from "./formatter.ts";\n');
      t.rep(`${CK}/formatter.ts`, 'import { unquoteShapeString } from "./shape-strings.ts";\n', "");
      t.append(`${CK}/formatter.ts`, `\n${fn}`);
    }
  },
  {
    id: "M03",
    cat: "M",
    kind: "drift",
    title:
      "Move replaceWindowsBinary (clock read under exception UpdateTempTokenReadsClock) to update/windows.ts",
    expect: {
      A: [
        {
          kind: "contradiction",
          claim: ["ClockReadOnlyAtCliBoundary"],
          at: "windows.ts#replaceWindowsBinary"
        }
      ]
    },
    predict: {
      A: "hit (the exception names the old identity, so the moved read is new and unmatched)",
      X: "hit"
    },
    apply: (t) => {
      const p = `${CLI}/commands/update/impl.ts`;
      const fn = t.cutFunction(p, "async function replaceWindowsBinary(");
      t.write(
        `${CLI}/commands/update/windows.ts`,
        'import { spawn } from "node:child_process";\nimport { copyFile, cp, rm, writeFile } from "node:fs/promises";\nimport { basename, dirname, join } from "node:path";\nimport { windowsReplacementScript, type ReplaceResult } from "./impl";\n\nexport ' +
          fn
      );
      t.pre(p, 'import { replaceWindowsBinary } from "./windows";\n');
    }
  },
  {
    id: "M04",
    cat: "M",
    kind: "drift",
    title:
      "Move isoToday (the excepted clock reader) into shape-files.ts, re-exported from freshness.ts",
    expect: {
      A: [
        unbound("isoToday"),
        {
          kind: "contradiction",
          claim: ["ClockReadOnlyAtCliBoundary"],
          at: "shape-files.ts#isoToday"
        }
      ]
    },
    predict: { A: "hit (E-unbound and a new clock contradiction)", X: "hit" },
    apply: (t) => {
      const fn = t.cutFunction(`${CLI}/freshness.ts`, "export function isoToday(");
      t.append(`${CLI}/freshness.ts`, 'export { isoToday } from "./shape-files";\n');
      t.pre(
        `${CLI}/shape-files.ts`,
        'import { parseIsoCalendarDate as h2ParseIso, type IsoDateString as H2IsoDate } from "@shape/shp-checker";\n'
      );
      t.append(
        `${CLI}/shape-files.ts`,
        `\n${fn.replace("parseIsoCalendarDate(", "h2ParseIso(").replace("): IsoDateString", "): H2IsoDate")}`
      );
    }
  },
  {
    id: "M05",
    cat: "M",
    kind: "drift",
    title:
      "Move isReevaluationRequirement out of ShapePreludeRegistry into an ungoverned file, re-exported",
    expect: { A: [unbound("isReevaluationRequirement")] },
    predict: { A: "hit (E-unbound)", X: "hit" },
    apply: (t) => {
      const fn = t.cutFunction(`${CK}/prelude.ts`, "export function isReevaluationRequirement(");
      t.write(`${CK}/reevaluation.ts`, fn);
      t.pre(`${CK}/prelude.ts`, 'export { isReevaluationRequirement } from "./reevaluation.ts";\n');
    }
  },
  {
    id: "M06",
    cat: "M",
    kind: "drift",
    title:
      "Move getEditorDiagnostics (calls the checker) from ShapeEditorServices into analyzer-shape.ts",
    expect: {
      A: [
        unbound("getEditorDiagnostics"),
        { kind: "contradiction", claim: ["AnalyzerStaysAdvisory"] }
      ]
    },
    predict: { A: "hit (E-unbound and the forbidden path)", X: "hit" },
    apply: (t) => {
      const fn = t.cutFunction(`${CK}/editor.ts`, "export function getEditorDiagnostics(");
      t.rep(
        `${CK}/editor.ts`,
        "function diagnosticToEditorDiagnostic(",
        "export function diagnosticToEditorDiagnostic("
      );
      t.pre(`${CK}/editor.ts`, 'export { getEditorDiagnostics } from "./analyzer-shape.ts";\n');
      t.pre(
        `${CK}/analyzer-shape.ts`,
        'import { parseShapeModule } from "./parser.ts";\nimport { checkShapeModules } from "./checker/api.ts";\nimport { diagnosticToEditorDiagnostic, type EditorDiagnostic } from "./editor.ts";\n'
      );
      t.append(`${CK}/analyzer-shape.ts`, `\n${fn}`);
    }
  },

  // ---- N: a symbol renamed ---------------------------------------------------------------------
  {
    id: "N01",
    cat: "N",
    kind: "drift",
    title: "Rename checkCoverage -> checkCoverageRules (all TS references)",
    expect: { A: [unbound("checkCoverage")] },
    predict: { A: "hit (E-unbound)", X: "hit" },
    apply: (t) => t.renameWord(codeFiles(t.dir), "checkCoverage", "checkCoverageRules")
  },
  {
    id: "N02",
    cat: "N",
    kind: "drift",
    title: "Rename formatShapeModule -> formatShapeModuleText (all TS references)",
    expect: { A: [unbound("formatShapeModule")] },
    predict: { A: "hit (E-unbound)", X: "hit" },
    apply: (t) => t.renameWord(codeFiles(t.dir), "formatShapeModule", "formatShapeModuleText")
  },
  {
    id: "N03",
    cat: "N",
    kind: "drift",
    title: "Rename isoToday -> currentIsoDay (the clock exception names the unit)",
    expect: {
      A: [
        unbound("isoToday"),
        {
          kind: "contradiction",
          claim: ["ClockReadOnlyAtCliBoundary"],
          at: "freshness.ts#currentIsoDay"
        }
      ]
    },
    predict: { A: "hit (E-unbound and a new clock contradiction)", X: "hit" },
    apply: (t) => t.renameWord(codeFiles(t.dir), "isoToday", "currentIsoDay")
  },
  {
    id: "N04",
    cat: "N",
    kind: "drift",
    title:
      "Rename type RawAstFile -> RawSyntaxFile (resource SourceSyntaxTree binds ts.type(...#RawAstFile))",
    expect: {
      A: [
        { kind: "error", at: "RawAstFile" },
        { kind: "error", at: "SourceSyntaxTree" }
      ]
    },
    predict: { A: "miss (resource codes are not checked against the manifest)", X: "miss" },
    apply: (t) => t.renameWord(codeFiles(t.dir), "RawAstFile", "RawSyntaxFile")
  },
  {
    id: "N05",
    cat: "N",
    kind: "drift",
    title:
      "Rename file prelude.ts -> prelude-registry.ts (ShapePreludeRegistry's literal path glob)",
    expect: { A: [unbound("ShapePreludeRegistry")] },
    predict: { A: "hit (E-unbound)", X: "hit" },
    apply: (t) => {
      for (const f of codeFiles(t.dir)) {
        const s = t.read(f);
        if (s.includes('/prelude.ts"'))
          t.write(f, s.replaceAll('/prelude.ts"', '/prelude-registry.ts"'));
      }
      t.mv(`${CK}/prelude.ts`, `${CK}/prelude-registry.ts`);
    }
  },
  {
    id: "N06",
    cat: "N",
    kind: "drift",
    title: "Rename compareAnalyzerHintsToShape -> compareHintsToShape (all TS references)",
    expect: { A: [unbound("compareAnalyzerHintsToShape")] },
    predict: { A: "hit (E-unbound)", X: "hit" },
    apply: (t) =>
      t.renameWord(codeFiles(t.dir), "compareAnalyzerHintsToShape", "compareHintsToShape")
  },
  {
    id: "N07",
    cat: "N",
    kind: "drift",
    title:
      "Rename docs page reference/cli.md -> reference/cli-reference.md (law CliDocumented names the file)",
    expect: {
      A: [
        { kind: "error", at: "cli.md" },
        { kind: "unestablished", claim: ["CliDocumented"] }
      ]
    },
    predict: { A: "unclear", X: "unclear" },
    apply: (t) =>
      t.mv(
        "docs-site/src/content/docs/reference/cli.md",
        "docs-site/src/content/docs/reference/cli-reference.md"
      )
  },

  // ---- L: a law-covered function's behaviour changed --------------------------------------------
  {
    id: "L01",
    cat: "L",
    kind: "drift",
    title:
      "formatShapeModule stops sorting declarations (FormatterIdempotent: order changes the output)",
    expect: { A: [{ kind: "contradiction", claim: ["FormatterIdempotent"] }] },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.rep(
        `${CK}/formatter.ts`,
        "  const declarations = [...module.declarations].sort((left, right) =>\n    compareCodepointStrings(declarationSortKey(left), declarationSortKey(right))\n  );\n",
        "  const declarations = [...module.declarations];\n"
      )
  },
  {
    id: "L02",
    cat: "L",
    kind: "drift",
    title: "checkFreshness enforces non-ISO review_by values (FreshnessEnforcesOnlyIsoDates)",
    expect: { A: [{ kind: "contradiction", claim: ["FreshnessEnforcesOnlyIsoDates"] }] },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.rep(
        `${CK}/checker/rules/guards.ts`,
        "    if (!info.reviewBy || !isIsoCalendarDate(info.reviewBy) || info.reviewBy >= asOf) {",
        "    if (!info.reviewBy || info.reviewBy >= asOf) {"
      )
  },
  {
    id: "L03",
    cat: "L",
    kind: "drift",
    title:
      "inspectShapeModules reverses document order (InspectionCodepointOrder, change inside the law's unit)",
    expect: { A: [{ kind: "contradiction", claim: ["InspectionCodepointOrder"] }] },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.rep(
        `${CK}/checker/inspection.ts`,
        "    .toSorted(compareDocuments);\n  const resources",
        "    .toSorted(compareDocuments)\n    .reverse();\n  const resources"
      )
  },
  {
    id: "L04",
    cat: "L",
    kind: "drift",
    title:
      "compareCodepointStrings made locale-aware (InspectionCodepointOrder, change in a cross-file dependency)",
    expect: { A: [{ kind: "contradiction", claim: ["InspectionCodepointOrder"] }] },
    predict: {
      A: "contradiction raised but preexisting (Req is the law's unit, not its dependencies)",
      X: "same"
    },
    apply: (t) =>
      t.ins(
        `${CK}/shape-strings.ts`,
        "export function compareCodepointStrings(left: string, right: string): number {\n",
        "  if (left.toLowerCase() !== right.toLowerCase()) return left.localeCompare(right);\n"
      )
  },
  {
    id: "L05",
    cat: "L",
    kind: "drift",
    title:
      "normalizeShapeSourcePath keeps the line suffix (SourcePathRulesShared, change inside the unit)",
    expect: { A: [{ kind: "contradiction", claim: ["SourcePathRulesShared"] }] },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.rep(
        `${CK}/shape-strings.ts`,
        "  return normalizeShapePath(lineMatch?.[1] ?? withoutAnchor);",
        "  return normalizeShapePath(lineMatch ? withoutAnchor : withoutAnchor);"
      )
  },
  {
    id: "L06",
    cat: "L",
    kind: "drift",
    title:
      "normalizeShapePath stops stripping './' (SourcePathRulesShared, change in a same-file callee)",
    expect: { A: [{ kind: "contradiction", claim: ["SourcePathRulesShared"] }] },
    predict: { A: "hit if the unit digest's environment includes same-file callees", X: "same" },
    apply: (t) =>
      t.rep(
        `${CK}/shape-strings.ts`,
        '  return path.replaceAll("\\\\", "/").replace(/^\\.\\//, "");',
        '  return path.replaceAll("\\\\", "/");'
      )
  },
  {
    id: "L07",
    cat: "L",
    kind: "drift",
    title:
      "Update drafts claim empty complete summaries (UpdateDraftsPreferUnknown, change in a same-file helper)",
    expect: { A: [{ kind: "contradiction", claim: ["UpdateDraftsPreferUnknown"] }] },
    predict: { A: "hit if same-file callees move the unit digest", X: "same" },
    apply: (t) =>
      t.rep(
        `${CK}/authoring.ts`,
        '    "  effects unknown"\n  ].join("\\n");\n}',
        '    "  effects complete {}"\n  ].join("\\n");\n}'
      )
  },
  {
    id: "L08",
    cat: "L",
    kind: "drift",
    title:
      "checkLoweredShapeModel stops sorting diagnostics (CheckIsDeterministic on checkShapeModules, same-file callee; guarded unit)",
    expect: {
      A: [
        { kind: "contradiction", claim: ["CheckIsDeterministic"] },
        { kind: "unestablished", claim: ["checkLoweredShapeModel/RefactorSensitive"] }
      ]
    },
    predict: {
      A: "guard obligation; law contradiction if the test sees it",
      X: "same, guard stale"
    },
    apply: (t) =>
      t.rep(
        `${CK}/checker/api.ts`,
        "    diagnostics: diagnostics.toSorted(compareShapeDiagnostics),\n",
        "    diagnostics,\n"
      )
  },
  {
    id: "L09",
    cat: "L",
    kind: "drift",
    title:
      "IncrementalShapeChecker.check never reuses diagnostics (IncrementalReusesDiagnosticsOnNoop)",
    expect: { A: [{ kind: "contradiction", claim: ["IncrementalReusesDiagnosticsOnNoop"] }] },
    predict: { A: "hit", X: "hit" },
    apply: (t) =>
      t.rep(
        `${CK}/checker/incremental.ts`,
        '        diagnostics: documentsChanged || optionsChanged ? "recomputed" : "reused"\n',
        '        diagnostics: "recomputed"\n'
      )
  },
  {
    id: "L10",
    cat: "L",
    kind: "drift",
    title:
      "checkLoweredShapeModel runs binding checks before semantic rules (RefactorSensitive memory: pipeline order)",
    expect: { A: [{ kind: "unestablished", claim: ["checkLoweredShapeModel/RefactorSensitive"] }] },
    predict: { A: "hit (guard, reason missing: no base judgment)", X: "hit (guard, reason stale)" },
    apply: (t) =>
      t.rep(
        `${CK}/checker/api.ts`,
        "    ...model.diagnostics,\n    ...runSemanticChecks(model, normalizedOptions),\n    ...(normalizedOptions.enforceBindings === false\n      ? []\n      : checkBindings(\n          model,\n          normalizedOptions.changedFiles ?? [],\n          normalizedOptions.repoRoot,\n          normalizedOptions.base\n        ))\n",
        "    ...model.diagnostics,\n    ...(normalizedOptions.enforceBindings === false\n      ? []\n      : checkBindings(\n          model,\n          normalizedOptions.changedFiles ?? [],\n          normalizedOptions.repoRoot,\n          normalizedOptions.base\n        )),\n    ...runSemanticChecks(model, normalizedOptions)\n"
      )
  },
  {
    id: "L11",
    cat: "L",
    kind: "drift",
    title:
      "checkGuardedChanges reports nothing (untested Property laws GuardsFirePropertyLevel and siblings)",
    expect: {
      A: [
        {
          kind: "unestablished",
          claim: [
            "GuardsFirePropertyLevel",
            "TransformGuardsFireOnMatchingTransform",
            "OtherGuardTargetsUseCoarseMatching",
            "GuardsNeverWaiveFinalForbids",
            "checkGuardedChanges/RefactorSensitive"
          ]
        }
      ]
    },
    predict: { A: "hit (unestablished, introduced)", X: "hit" },
    apply: (t) =>
      t.rep(
        `${CK}/checker/rules/guards.ts`,
        "  return evaluateGuards(buildGuardContexts(model), model.changeEvents).map(\n    guardViolationDiagnostic\n  );",
        "  return evaluateGuards(buildGuardContexts(model), model.changeEvents)\n    .filter(() => false)\n    .map(guardViolationDiagnostic);"
      )
  },
  {
    id: "L12",
    cat: "L",
    kind: "drift",
    title:
      "normalizeShapeSourcePath drops only short line suffixes (SourcePathRulesShared broken outside the sampled spellings)",
    expect: { A: [{ kind: "contradiction", claim: ["SourcePathRulesShared"] }] },
    predict: { A: "miss (the generator only spells :12 and :3-9)", X: "miss" },
    apply: (t) =>
      t.rep(
        `${CK}/shape-strings.ts`,
        "  const lineMatch = /^(.*):\\d+(?:-\\d+)?$/.exec(withoutAnchor);",
        "  const lineMatch = /^(.*):\\d{1,2}(?:-\\d)?$/.exec(withoutAnchor);"
      )
  },

  // ---- C: controls (should raise nothing) -------------------------------------------------------
  {
    id: "C00",
    cat: "C",
    kind: "control",
    title: "No edit (baseline)",
    expect: {},
    predict: { A: "nothing" },
    apply: () => undefined
  },
  {
    id: "C01",
    cat: "C",
    kind: "control",
    title: "Comment-only edit inside ShapeRuleEngine.checkCoverage",
    expect: {},
    predict: { A: "nothing (inert comments do not move digests)" },
    apply: (t) =>
      t.rep(
        `${CK}/checker/rules/coverage.ts`,
        "export function checkCoverage(\n  model: Model,\n  changedFiles: string[],\n  repoRoot: string,\n  base?: BaseModel\n): SemanticDiagnostic[] {\n",
        "export function checkCoverage(\n  model: Model,\n  changedFiles: string[],\n  repoRoot: string,\n  base?: BaseModel\n): SemanticDiagnostic[] {\n  // Coverage reads only the changed-file list the caller supplies.\n"
      )
  },
  {
    id: "C02",
    cat: "C",
    kind: "control",
    title: "Formatting-only edit of checkFreshness (line breaks, blank line)",
    expect: {},
    predict: { A: "nothing (digests ignore formatting)" },
    apply: (t) =>
      t.rep(
        `${CK}/checker/rules/guards.ts`,
        "    if (!info.reviewBy || !isIsoCalendarDate(info.reviewBy) || info.reviewBy >= asOf) {\n      continue;\n    }\n",
        "    if (\n      !info.reviewBy ||\n      !isIsoCalendarDate(info.reviewBy) ||\n      info.reviewBy >= asOf\n    ) {\n      continue;\n    }\n\n"
      )
  },
  {
    id: "C03",
    cat: "C",
    kind: "control",
    title: "README edit",
    expect: {},
    predict: { A: "nothing" },
    apply: (t) => t.append("README.md", "\nA control line for the H2 drift trial.\n")
  },
  {
    id: "C04",
    cat: "C",
    kind: "control",
    title: "Rename a local variable in ShapeFormatter.formatShapeModule (chunks -> parts)",
    expect: {},
    predict: { A: "no drift obligation; coverage on ShapeFormatter (call(ts) unobserved)" },
    apply: (t) => {
      const p = `${CK}/formatter.ts`;
      const s = t.read(p);
      const i = s.indexOf("export function formatShapeModule(");
      const j = s.indexOf("function formatDeclaration(", i);
      t.write(p, s.slice(0, i) + s.slice(i, j).replace(/\bchunks\b/g, "parts") + s.slice(j));
    }
  },
  {
    id: "C05",
    cat: "C",
    kind: "control",
    title: "Extract the line-suffix regex of normalizeShapeSourcePath into a module constant",
    expect: {},
    predict: { A: "no drift obligation; coverage on ShapeStringHelpers" },
    apply: (t) => {
      t.rep(
        `${CK}/shape-strings.ts`,
        "  const lineMatch = /^(.*):\\d+(?:-\\d+)?$/.exec(withoutAnchor);",
        "  const lineMatch = LINE_SUFFIX.exec(withoutAnchor);"
      );
      t.append(`${CK}/shape-strings.ts`, "\nconst LINE_SUFFIX = /^(.*):\\d+(?:-\\d+)?$/;\n");
    }
  },
  {
    id: "C06",
    cat: "C",
    kind: "control",
    title: "Swap the order of two top-level functions in shape-strings.ts",
    expect: {},
    predict: { A: "nothing or file-level coverage only" },
    apply: (t) => {
      const a = t.cutFunction(`${CK}/shape-strings.ts`, "export function normalizeShapePath(");
      t.append(`${CK}/shape-strings.ts`, `\n${a}`);
    }
  },
  {
    id: "C07",
    cat: "C",
    kind: "control",
    title: "Extract a pure helper isPastDue from checkFreshness (same component, behaviour kept)",
    expect: {},
    predict: { A: "no drift obligation; coverage on ShapeRuleEngine" },
    apply: (t) => {
      t.rep(
        `${CK}/checker/rules/guards.ts`,
        "    if (!info.reviewBy || !isIsoCalendarDate(info.reviewBy) || info.reviewBy >= asOf) {",
        "    if (!info.reviewBy || !isIsoCalendarDate(info.reviewBy) || !isPastDue(info.reviewBy, asOf)) {"
      );
      t.append(
        `${CK}/checker/rules/guards.ts`,
        "\nfunction isPastDue(reviewBy: string, asOf: string): boolean {\n  return reviewBy < asOf;\n}\n"
      );
    }
  },
  {
    id: "C08",
    cat: "C",
    kind: "control",
    title: "Clock read in ungoverned code (experiments/shape-1/proto/src/util.ts)",
    expect: {},
    predict: { A: "nothing (no claim governs ungoverned code)" },
    apply: (t) =>
      t.append(
        "experiments/shape-1/proto/src/util.ts",
        "\nexport function h2Stamp(): number {\n  return Date.now();\n}\n"
      )
  },
  {
    id: "C09",
    cat: "C",
    kind: "control",
    title: "Clock read in ShpCli.main (granted, excepted, and in main's complete summary)",
    expect: {},
    predict: { A: "no drift obligation; coverage on ShpCli" },
    apply: (t) =>
      t.ins(
        `${CLI}/index.ts`,
        "async function main(): Promise<void> {\n",
        "  const startedAt = Date.now();\n  void startedAt;\n"
      )
  },
  {
    id: "C10",
    cat: "C",
    kind: "control",
    title: "Rename an unbound private helper in formatter.ts (indent -> indentText)",
    expect: {},
    predict: { A: "no drift obligation; coverage on ShapeFormatter" },
    apply: (t) => t.renameWord([`${CK}/formatter.ts`], "indent", "indentText")
  },
  {
    id: "C11",
    cat: "C",
    kind: "control",
    title: "Docs edit in a page no law names (guides/ci.md)",
    expect: {},
    predict: { A: "nothing (DocsSite is low tier: coverage is health only)" },
    apply: (t) =>
      t.append(
        "docs-site/src/content/docs/guides/ci.md",
        "\nThis sentence is a control edit for the H2 drift trial.\n"
      )
  },
  {
    id: "C12",
    cat: "C",
    kind: "control",
    title: "Whitespace-only edit of a 0.x shape file (shape/checker.shape)",
    expect: {},
    predict: { A: "nothing (no claim changes)" },
    apply: (t) => t.append("shape/checker.shape", "\n\n")
  },
  {
    id: "C13",
    cat: "C",
    kind: "control",
    title: "Add a unit test file inside ShapeChecker's path glob",
    expect: {},
    predict: { A: "no drift obligation; coverage on ShapeChecker" },
    apply: (t) =>
      t.write(
        `${CK}/checker/h2-control.test.ts`,
        'import { expect, test } from "bun:test";\nimport { localNameOf } from "./display.ts";\n\ntest("localNameOf keeps unqualified names", () => {\n  expect(localNameOf("A")).toBe("A");\n});\n'
      )
  }
];
