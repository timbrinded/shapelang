import { resolve } from "node:path";
import { parseShapeModule, type ParseDiagnostic, type ParseShapeModuleResult } from "../parser.ts";
import { compareCodepointStrings } from "../shape-strings.ts";
import { checkLoweredShapeModel, normalizeCheckOptions } from "./api.ts";
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

export type IncrementalInvalidationReport = {
  causes: IncrementalInvalidationCause[];
  reparsedDocuments: string[];
  reusedDocuments: string[];
  removedDocuments: string[];
  derivedFacts: "rebuilt" | "reused" | "unavailable";
  diagnostics: "recomputed" | "reused";
};

export type IncrementalCheckResult = {
  result: CheckResult;
  invalidation: IncrementalInvalidationReport;
};

type CachedDocument = {
  source: string;
  origin?: CheckModuleOrigin;
  parsed: ParseShapeModuleResult;
};

/**
 * Caches parsed Shape documents and the last globally lowered model.
 *
 * Every document mutation and implicit-origin change rebuilds the complete
 * effective model and fact set because module resolution and change
 * declarations cross file boundaries. Other option-only checks reuse that
 * model, while exact no-op checks also reuse the last diagnostics.
 * `checkShapeModules` remains the uncached full-check path.
 */
export class IncrementalShapeChecker {
  #documents = new Map<string, CachedDocument>();
  #model: Model | undefined;
  #modelOriginRoot: string | undefined;
  #lastResult: CheckResult | undefined;
  #lastOptionsKey: string | undefined;
  #initialized = false;

  check(
    documents: readonly IncrementalShapeDocument[],
    options: CheckOptions = {}
  ): IncrementalCheckResult {
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
    const documentsChanged =
      !this.#initialized || reparsedDocuments.length > 0 || removedDocuments.length > 0;
    const optionsKey = checkOptionsKey(options);
    const optionsChanged = this.#initialized && optionsKey !== this.#lastOptionsKey;
    const causes = invalidationCauses(this.#initialized, documentsChanged, optionsChanged);
    const parseDiagnostics = collectParseDiagnostics(nextDocuments);

    if (parseDiagnostics.length > 0) {
      const nextResult: CheckResult =
        documentsChanged || this.#lastResult === undefined
          ? {
              ok: false,
              exitCode: 2,
              diagnostics: parseDiagnostics
            }
          : this.#lastResult;

      this.#documents = nextDocuments;
      this.#model = undefined;
      this.#modelOriginRoot = undefined;
      this.#lastResult = nextResult;
      this.#lastOptionsKey = optionsKey;
      this.#initialized = true;
      return {
        result: cloneCheckResult(nextResult),
        invalidation: {
          causes,
          reparsedDocuments,
          reusedDocuments,
          removedDocuments,
          derivedFacts: "unavailable",
          diagnostics: documentsChanged ? "recomputed" : "reused"
        }
      };
    }

    const normalizedOptions = normalizeCheckOptions(options);
    let nextModel = this.#model;
    let modelRebuilt = false;
    const originsChanged =
      !documentsChanged &&
      nextModel !== undefined &&
      this.#modelOriginRoot !== undefined &&
      moduleOriginsChanged(nextDocuments, this.#modelOriginRoot, normalizedOptions.repoRoot);
    if (documentsChanged || originsChanged || nextModel === undefined) {
      nextModel = lowerShapeModules(collectModuleInputs(nextDocuments, normalizedOptions.repoRoot));
      modelRebuilt = true;
    }

    const nextResult =
      modelRebuilt || optionsChanged || this.#lastResult === undefined
        ? checkLoweredShapeModel(nextModel, normalizedOptions)
        : this.#lastResult;

    this.#documents = nextDocuments;
    this.#model = nextModel;
    if (modelRebuilt) {
      this.#modelOriginRoot = normalizedOptions.repoRoot;
    }
    this.#lastResult = nextResult;
    this.#lastOptionsKey = optionsKey;
    this.#initialized = true;
    return {
      result: cloneCheckResult(nextResult),
      invalidation: {
        causes,
        reparsedDocuments,
        reusedDocuments,
        removedDocuments,
        derivedFacts: modelRebuilt ? "rebuilt" : "reused",
        diagnostics: documentsChanged || optionsChanged ? "recomputed" : "reused"
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
    changedFiles: options.changedFiles ?? null,
    enforceBindings: options.enforceBindings ?? null,
    includeFacts: options.includeFacts ?? null,
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

function cloneCheckResult(result: CheckResult): CheckResult {
  return structuredClone(result);
}
