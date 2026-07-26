import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  checkShapeModules,
  compareCodepointStrings,
  IncrementalShapeChecker,
  parseShapeModule,
  type CheckModuleInput,
  type CheckOptions,
  type IncrementalShapeDocument
} from "../index.ts";

const RESOURCE_DOCUMENT: IncrementalShapeDocument = {
  filePath: "shape/resources.shape",
  source: `
    module resources

    resource AuditEvent
  `
};

const STORE_DOCUMENT: IncrementalShapeDocument = {
  filePath: "shape/store.shape",
  source: `
    module store
    import resources

    component AuditStore {
      grants Append<AuditEvent>
      fn append
        effects complete {
          Append<AuditEvent>
        }
    }
  `
};

const AUXILIARY_DOCUMENT: IncrementalShapeDocument = {
  filePath: "shape/auxiliary.shape",
  source: `
    module auxiliary

    resource Trace
  `
};

describe("IncrementalShapeChecker", () => {
  test("matches a full check and reuses an exact no-op without exposing mutable cache state", () => {
    const documents: IncrementalShapeDocument[] = [
      {
        filePath: "shape/audit.shape",
        source: `
          module audit

          trait AppendOnly<T: Resource> {
            forbid final HardDelete<T>
          }

          resource AuditEvent : AppendOnly

          component AuditStore {
            grants HardDelete<AuditEvent>
            fn purge
              effects complete {
                HardDelete<AuditEvent>
              }
          }
        `
      }
    ];
    const options = { includeFacts: true };
    const checker = new IncrementalShapeChecker();
    const first = checker.check(documents, options);
    const expected = fullCheck(documents, options);

    expect(first.result).toEqual(expected);
    expect(first.invalidation).toEqual({
      causes: ["initial_check"],
      reparsedDocuments: ["shape/audit.shape"],
      reusedDocuments: [],
      removedDocuments: [],
      derivedFacts: "rebuilt",
      diagnostics: "recomputed"
    });

    first.result.diagnostics.length = 0;
    if (first.result.facts !== undefined) {
      first.result.facts.length = 0;
    }

    const noOp = checker.check(documents, options);
    expect(noOp.result).toEqual(expected);
    expect(noOp.invalidation).toEqual({
      causes: [],
      reparsedDocuments: [],
      reusedDocuments: ["shape/audit.shape"],
      removedDocuments: [],
      derivedFacts: "reused",
      diagnostics: "reused"
    });
  });

  test("reparses only changed documents but globally rebuilds cross-module facts", () => {
    const checker = new IncrementalShapeChecker();
    const original = [STORE_DOCUMENT, RESOURCE_DOCUMENT, AUXILIARY_DOCUMENT];
    checker.check(original, { includeFacts: true });

    const changedStore: IncrementalShapeDocument = {
      ...STORE_DOCUMENT,
      source: STORE_DOCUMENT.source.replace("grants Append<AuditEvent>", "")
    };
    const changed = [AUXILIARY_DOCUMENT, changedStore, RESOURCE_DOCUMENT];
    const result = checker.check(changed, { includeFacts: true });

    expect(result.result).toEqual(fullCheck(changed, { includeFacts: true }));
    expect(result.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "missing_grant",
        component: "store::AuditStore",
        target: "resources::AuditEvent"
      })
    );
    expect(result.invalidation).toEqual({
      causes: ["shape_documents_changed"],
      reparsedDocuments: ["shape/store.shape"],
      reusedDocuments: ["shape/auxiliary.shape", "shape/resources.shape"],
      removedDocuments: [],
      derivedFacts: "rebuilt",
      diagnostics: "recomputed"
    });
  });

  test("rebuilds the two-pass model when a change declaration is edited", () => {
    const base: IncrementalShapeDocument = {
      filePath: "shape/store.shape",
      source: `
        module store

        resource AuditEvent

        component AuditStore {
          grants Read<AuditEvent>
          fn load
            effects complete {
              Read<AuditEvent>
            }
        }
      `
    };
    const unsafeChange: IncrementalShapeDocument = {
      filePath: "shape/store-update.shape",
      source: `
        module store.update

        change UpdateStoreLoad {
          modify fn store::AuditStore.load
            effects complete {
              Append<store::AuditEvent>
            }
        }
      `
    };
    const checker = new IncrementalShapeChecker();
    const unsafe = checker.check([base, unsafeChange]);
    expect(unsafe.result).toEqual(fullCheck([base, unsafeChange]));
    expect(unsafe.result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "missing_grant", effect: "Append" })
    );

    const safeChange: IncrementalShapeDocument = {
      ...unsafeChange,
      source: unsafeChange.source.replace("Append<store::AuditEvent>", "Read<store::AuditEvent>")
    };
    const safe = checker.check([safeChange, base]);
    expect(safe.result).toEqual(fullCheck([safeChange, base]));
    expect(safe.result.exitCode).toBe(0);
    expect(safe.invalidation).toEqual({
      causes: ["shape_documents_changed"],
      reparsedDocuments: ["shape/store-update.shape"],
      reusedDocuments: ["shape/store.shape"],
      removedDocuments: [],
      derivedFacts: "rebuilt",
      diagnostics: "recomputed"
    });
  });

  test("globally rebuilds after deletion so removed declarations cannot survive in cached facts", () => {
    const checker = new IncrementalShapeChecker();
    checker.check([STORE_DOCUMENT, RESOURCE_DOCUMENT]);

    const result = checker.check([STORE_DOCUMENT]);

    expect(result.result).toEqual(fullCheck([STORE_DOCUMENT]));
    expect(result.result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "unknown_name", name: "store::AuditEvent" })
    );
    expect(result.result.facts).toBeUndefined();
    expect(result.invalidation).toEqual({
      causes: ["shape_documents_changed"],
      reparsedDocuments: [],
      reusedDocuments: ["shape/store.shape"],
      removedDocuments: ["shape/resources.shape"],
      derivedFacts: "rebuilt",
      diagnostics: "recomputed"
    });
  });

  test("reuses lowered facts while recomputing changed-file and output options", () => {
    const document: IncrementalShapeDocument = {
      filePath: "shape/service.shape",
      source: `
        module service

        component Service {
          fn run
            source ts("src/service.ts#run")
            effects complete {
            }
        }

        implementation ServiceImplementation {
          paths {
            "src/**/*.ts"
          }
          conforms_to Service
          on_change require shape_update
        }
      `
    };
    const checker = new IncrementalShapeChecker();
    checker.check([document], { repoRoot: "/repo", enforceBindings: false });

    const staleOptions: CheckOptions = {
      repoRoot: "/repo",
      enforceBindings: false,
      changedFiles: ["src/service.ts"],
      includeFacts: true
    };
    const stale = checker.check([document], staleOptions);

    expect(stale.result).toEqual(fullCheck([document], staleOptions));
    expect(stale.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "missing_shape_update",
        changedFile: "src/service.ts"
      })
    );
    expect(stale.result.facts).toBeDefined();
    expect(stale.invalidation).toEqual({
      causes: ["check_options_changed"],
      reparsedDocuments: [],
      reusedDocuments: ["shape/service.shape"],
      removedDocuments: [],
      derivedFacts: "reused",
      diagnostics: "recomputed"
    });

    const currentOptions: CheckOptions = {
      ...staleOptions,
      changedFiles: ["src/service.ts", "shape/service.shape"]
    };
    const current = checker.check([document], currentOptions);
    expect(current.result).toEqual(fullCheck([document], currentOptions));
    expect(current.result.exitCode).toBe(0);
    expect(current.invalidation.derivedFacts).toBe("reused");
  });

  test("recomputes diagnostics when unknown-effect policy changes", () => {
    const document: IncrementalShapeDocument = {
      filePath: "shape/service.shape",
      source: `
        module service

        component Service {
          fn run
            effects unknown
        }
      `
    };
    const checker = new IncrementalShapeChecker();
    const strict = checker.check([document]);
    expect(strict.result.exitCode).toBe(1);

    const options: CheckOptions = { allowUnknownEffects: true };
    const permissive = checker.check([document], options);
    expect(permissive.result).toEqual(fullCheck([document], options));
    expect(permissive.result.exitCode).toBe(0);
    expect(permissive.result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "unknown_effects", severity: "warning" })
    );
    expect(permissive.invalidation).toEqual({
      causes: ["check_options_changed"],
      reparsedDocuments: [],
      reusedDocuments: ["shape/service.shape"],
      removedDocuments: [],
      derivedFacts: "reused",
      diagnostics: "recomputed"
    });
  });

  test("rebuilds implicit generated-AST origins without reparsing when repoRoot changes", () => {
    const generatedRepoRoot = resolve("virtual-generated-repo");
    const document: IncrementalShapeDocument = {
      filePath: resolve(
        generatedRepoRoot,
        "shape/generated/ast/packages/example/src/service.shape"
      ),
      source: `
        module shape.generated.ast.packages.example.src.service

        component Service {
          fn run
            effects unknown
        }
      `
    };
    const checker = new IncrementalShapeChecker();
    const generatedOptions = { repoRoot: generatedRepoRoot };
    const generated = checker.check([document], generatedOptions);

    expect(generated.result).toEqual(
      fullCheck([{ ...document, origin: "generated_ast" }], generatedOptions)
    );
    expect(
      generated.result.diagnostics.some((diagnostic) => diagnostic.kind === "unknown_effects")
    ).toBe(false);

    const authoredOptions = { repoRoot: resolve(generatedRepoRoot, "nested") };
    const authored = checker.check([document], authoredOptions);
    expect(authored.result).toEqual(
      fullCheck([{ ...document, origin: "authored" }], authoredOptions)
    );
    expect(authored.result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "unknown_effects" })
    );
    expect(authored.invalidation).toEqual({
      causes: ["check_options_changed"],
      reparsedDocuments: [],
      reusedDocuments: [document.filePath],
      removedDocuments: [],
      derivedFacts: "rebuilt",
      diagnostics: "recomputed"
    });

    const stillAuthored = checker.check([document], {
      repoRoot: resolve(generatedRepoRoot, "elsewhere")
    });
    expect(stillAuthored.invalidation.derivedFacts).toBe("reused");
    expect(stillAuthored.invalidation.reparsedDocuments).toEqual([]);

    const explicitChecker = new IncrementalShapeChecker();
    const explicitDocument: IncrementalShapeDocument = {
      ...document,
      origin: "generated_ast"
    };
    explicitChecker.check([explicitDocument], generatedOptions);
    const explicitRootChange = explicitChecker.check([explicitDocument], authoredOptions);
    expect(explicitRootChange.invalidation.derivedFacts).toBe("reused");
    expect(explicitRootChange.invalidation.reparsedDocuments).toEqual([]);
    expect(
      explicitRootChange.result.diagnostics.some(
        (diagnostic) => diagnostic.kind === "unknown_effects"
      )
    ).toBe(false);
  });

  test("keeps parse failures factless, reuses them across option changes, and recovers on edit", () => {
    const malformed: IncrementalShapeDocument = {
      filePath: "shape/service.shape",
      source: "module service\ncomponent"
    };
    const checker = new IncrementalShapeChecker();
    const first = checker.check([malformed]);

    expect(first.result.exitCode).toBe(2);
    expect(first.invalidation.derivedFacts).toBe("unavailable");
    expect(first.invalidation.diagnostics).toBe("recomputed");

    const optionOnly = checker.check([malformed], { includeFacts: true });
    expect(optionOnly.result).toEqual(first.result);
    expect(optionOnly.invalidation).toEqual({
      causes: ["check_options_changed"],
      reparsedDocuments: [],
      reusedDocuments: ["shape/service.shape"],
      removedDocuments: [],
      derivedFacts: "unavailable",
      diagnostics: "reused"
    });

    const repaired: IncrementalShapeDocument = {
      ...malformed,
      source: "module service\ncomponent Service {\n}\n"
    };
    const recovered = checker.check([repaired], { includeFacts: true });
    expect(recovered.result).toEqual(fullCheck([repaired], { includeFacts: true }));
    expect(recovered.result.exitCode).toBe(0);
    expect(recovered.invalidation.derivedFacts).toBe("rebuilt");
  });

  test("rejects duplicate file paths instead of making input order semantic", () => {
    const checker = new IncrementalShapeChecker();
    expect(() =>
      checker.check([
        RESOURCE_DOCUMENT,
        {
          ...RESOURCE_DOCUMENT,
          source: "module replacement"
        }
      ])
    ).toThrow("Duplicate incremental Shape document path: shape/resources.shape");
  });

  test("does not commit a new document snapshot when option validation throws", () => {
    const checker = new IncrementalShapeChecker();
    const expected = checker.check([RESOURCE_DOCUMENT]);
    const changedDocument = {
      ...RESOURCE_DOCUMENT,
      source: "module resources\nresource Replacement\n"
    };

    expect(() =>
      checker.check([changedDocument], {
        freshnessDate: "not-a-date" as CheckOptions["freshnessDate"]
      })
    ).toThrow("CheckOptions.freshnessDate");

    const afterFailure = checker.check([RESOURCE_DOCUMENT]);
    expect(afterFailure.result).toEqual(expected.result);
    expect(afterFailure.invalidation).toEqual({
      causes: [],
      reparsedDocuments: [],
      reusedDocuments: ["shape/resources.shape"],
      removedDocuments: [],
      derivedFacts: "reused",
      diagnostics: "reused"
    });
  });
});

function fullCheck(documents: readonly IncrementalShapeDocument[], options: CheckOptions = {}) {
  const modules = documents
    .toSorted((left, right) => compareCodepointStrings(left.filePath, right.filePath))
    .map(parseDocument);
  return checkShapeModules(modules, options);
}

function parseDocument(document: IncrementalShapeDocument): CheckModuleInput {
  const parsed = parseShapeModule(document.source, document.filePath);
  if (!parsed.ok) {
    throw new Error(
      `Expected valid test Shape: ${parsed.diagnostics[0]?.message ?? "parse failed"}`
    );
  }
  return {
    module: parsed.module,
    filePath: document.filePath,
    origin: document.origin
  };
}
