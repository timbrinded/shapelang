import { resolve } from "node:path";
import { parseShapeModule, type ParseDiagnostic, type ParseShapeModuleResult } from "../parser.ts";
import { compareCodepointStrings } from "../shape-strings.ts";
import { checkLoweredShapeModel, normalizeCheckOptions, summarizeBaseModel } from "./api.ts";
import { lowerShapeModules } from "./lowerer.ts";
import type {
  CheckModuleInput,
  CheckModuleOrigin,
  CheckOptions,
  CheckResult,
  Model
} from "./model.ts";
import { moduleOriginForShapeFile } from "./symbols.ts";

export type IncrementalShapeDocument = {
  filePath: string;
  source: string;
  origin?: CheckModuleOrigin;
};

export type IncrementalInvalidationCause =
  | "initial_check"
  | "shape_documents_changed"
  | "check_options_changed";

export type IncrementalCheckResult = ReturnType<IncrementalShapeChecker["check"]>;
export type IncrementalInvalidationReport = IncrementalCheckResult["invalidation"];

type CachedDocument = {
  source: string;
  origin?: CheckModuleOrigin;
  parsed: ParseShapeModuleResult;
};

/**
 * Caches parsed Shape documents and the last globally lowered model.
 *
 * Every document mutation and implicit-origin change rebuilds the complete
 * effective model and fact set, because module resolution and change
 * declarations cross file boundaries. Any other options-only check reuses that
 * model and recomputes diagnostics. An exact no-op check reuses the last result,
 * and so does an options-only check while a document fails to parse.
 * `checkShapeModules` is the uncached full-check path.
 */
export class IncrementalShapeChecker {
  #documents = new Map<string, CachedDocument>();
  #model: Model | undefined;
  #modelOriginRoot: string | undefined;
  #lastResult: CheckResult | undefined;
  #lastOptionsKey: string | undefined;

  check(documents: readonly IncrementalShapeDocument[], options: CheckOptions = {}) {
    const sortedDocuments = normalizeDocuments(documents);
    const nextDocuments = new Map<string, CachedDocument>();
    const reparsedDocuments: string[] = [];
    const reusedDocuments: string[] = [];

    for (const document of sortedDocuments) {
      const cached = this.#documents.get(document.filePath);
      if (
        cached !== undefined &&
        cached.source === document.source &&
        cached.origin === document.origin
      ) {
        nextDocuments.set(document.filePath, cached);
        reusedDocuments.push(document.filePath);
        continue;
      }

      nextDocuments.set(document.filePath, {
        source: document.source,
        origin: document.origin,
        parsed: parseShapeModule(document.source, document.filePath)
      });
      reparsedDocuments.push(document.filePath);
    }

    const removedDocuments = [...this.#documents.keys()]
      .filter((filePath) => !nextDocuments.has(filePath))
      .toSorted(compareCodepointStrings);
    const initialized = this.#lastResult !== undefined;
    const documentsChanged =
      !initialized || reparsedDocuments.length > 0 || removedDocuments.length > 0;
    const optionsKey = checkOptionsKey(options);
    const optionsChanged = initialized && optionsKey !== this.#lastOptionsKey;
    const causes = invalidationCauses(initialized, documentsChanged, optionsChanged);
    const parseDiagnostics = collectParseDiagnostics(nextDocuments);
    let nextModel = this.#model;
    let nextModelOriginRoot = this.#modelOriginRoot;
    let nextResult: CheckResult;
    let derivedFacts: "rebuilt" | "reused" | "unavailable";
    let diagnostics: "recomputed" | "reused";

    if (parseDiagnostics.length > 0) {
      nextResult =
        documentsChanged || this.#lastResult === undefined
          ? {
              ok: false,
              exitCode: 2,
              diagnostics: parseDiagnostics
            }
          : this.#lastResult;

      nextModel = undefined;
      nextModelOriginRoot = undefined;
      derivedFacts = "unavailable";
      diagnostics = documentsChanged ? "recomputed" : "reused";
    } else {
      const normalizedOptions = normalizeCheckOptions(options);
      const originsChanged =
        !documentsChanged &&
        nextModel !== undefined &&
        nextModelOriginRoot !== undefined &&
        moduleOriginsChanged(nextDocuments, nextModelOriginRoot, normalizedOptions.repoRoot);
      let modelRebuilt = false;
      if (documentsChanged || originsChanged || nextModel === undefined) {
        nextModel = lowerShapeModules(
          collectModuleInputs(nextDocuments, normalizedOptions.repoRoot)
        );
        nextModelOriginRoot = normalizedOptions.repoRoot;
        modelRebuilt = true;
      }
      nextResult =
        modelRebuilt || optionsChanged || this.#lastResult === undefined
          ? checkLoweredShapeModel(nextModel, normalizedOptions)
          : this.#lastResult;
      derivedFacts = modelRebuilt ? "rebuilt" : "reused";
      diagnostics = documentsChanged || optionsChanged ? "recomputed" : "reused";
    }

    this.#documents = nextDocuments;
    this.#model = nextModel;
    this.#modelOriginRoot = nextModelOriginRoot;
    this.#lastResult = nextResult;
    this.#lastOptionsKey = optionsKey;
    return {
      result: structuredClone(nextResult),
      invalidation: {
        causes,
        reparsedDocuments,
        reusedDocuments,
        removedDocuments,
        derivedFacts,
        diagnostics
      }
    };
  }
}

function normalizeDocuments(
  documents: readonly IncrementalShapeDocument[]
): IncrementalShapeDocument[] {
  const sorted = documents.toSorted((left, right) =>
    compareCodepointStrings(left.filePath, right.filePath)
  );

  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]?.filePath === sorted[index]?.filePath) {
      throw new TypeError(`Duplicate incremental Shape document path: ${sorted[index]?.filePath}`);
    }
  }
  return sorted;
}

function collectParseDiagnostics(documents: Map<string, CachedDocument>): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  for (const cached of documents.values()) {
    if (!cached.parsed.ok) {
      diagnostics.push(...cached.parsed.diagnostics);
    }
  }
  return diagnostics;
}

function collectModuleInputs(
  documents: Map<string, CachedDocument>,
  normalizationRoot: string
): CheckModuleInput[] {
  const modules: CheckModuleInput[] = [];
  for (const [filePath, cached] of documents) {
    if (!cached.parsed.ok) {
      continue;
    }
    modules.push({
      module: cached.parsed.module,
      filePath,
      origin:
        cached.origin ?? moduleOriginForShapeFile(cached.parsed.module, filePath, normalizationRoot)
    });
  }
  return modules;
}

function moduleOriginsChanged(
  documents: Map<string, CachedDocument>,
  previousRoot: string,
  nextRoot: string
): boolean {
  if (previousRoot === nextRoot) {
    return false;
  }

  for (const [filePath, cached] of documents) {
    if (
      cached.origin === undefined &&
      cached.parsed.ok &&
      moduleOriginForShapeFile(cached.parsed.module, filePath, previousRoot) !==
        moduleOriginForShapeFile(cached.parsed.module, filePath, nextRoot)
    ) {
      return true;
    }
  }
  return false;
}

function checkOptionsKey(options: CheckOptions): string {
  const snapshot = {
    allowUnknownEffects: options.allowUnknownEffects ?? null,
    baseModules:
      options.baseModules === undefined
        ? null
        : summarizeBaseModel(options.baseModules, resolve(options.repoRoot ?? process.cwd())),
    changedFiles: options.changedFiles ?? null,
    enforceBindings: options.enforceBindings ?? null,
    includeFacts: options.includeFacts ?? null,
    repositoryFiles: options.repositoryFiles ?? null,
    repoRoot: resolve(options.repoRoot ?? process.cwd()),
    freshnessDate: options.freshnessDate ?? null
  } satisfies Record<keyof CheckOptions, unknown>;
  return JSON.stringify(snapshot);
}

function invalidationCauses(
  initialized: boolean,
  documentsChanged: boolean,
  optionsChanged: boolean
): IncrementalInvalidationCause[] {
  if (!initialized) {
    return ["initial_check"];
  }

  const causes: IncrementalInvalidationCause[] = [];
  if (documentsChanged) {
    causes.push("shape_documents_changed");
  }
  if (optionsChanged) {
    causes.push("check_options_changed");
  }
  return causes;
}
