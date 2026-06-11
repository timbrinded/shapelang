import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkShapeModules,
  formatShapeSource,
  formatDiagnostics,
  generateShapeFromAstJson,
  parseShapeModule,
  type SourceSpan
} from "./index.ts";
import {
  buildCodeSemanticGraphFromAstJson,
  BUNDLED_TREE_SITTER_LANGUAGES,
  bundledTreeSitterParserLibsDir,
  configureBundledTreeSitterParsers,
  generateShapeFromCodeSemanticGraph,
  parseSourceFilesToCodeSemanticGraph,
  treeSitterParserLibraryName,
  type CodeSemanticGraph
} from "./ast-generation-core.ts";
import { signatureText } from "./ast-generation-tokens.ts";
import { stableJson, stableShapeId } from "./ast-generation-utils.ts";
import { detectLinuxMuslRuntime } from "./ast-generation.ts";
import { formatAstTestDiagnostics } from "./test-support.ts";

function requireGeneratedOutput(result: ReturnType<typeof generateShapeFromCodeSemanticGraph>) {
  if (!result.ok) {
    throw new Error(formatAstTestDiagnostics(result.diagnostics));
  }
  return result.value;
}

describe("AST to Shape generation", () => {
  test("does not treat missing glibc report fields as musl without loader evidence", () => {
    expect(detectLinuxMuslRuntime({}, "x64", () => false)).toBe(false);
    expect(
      detectLinuxMuslRuntime({ componentVersions: { glibc: "2.39" } }, "x64", () => true)
    ).toBe(false);
    expect(detectLinuxMuslRuntime({}, "x64", (path) => path === "/lib/ld-musl-x86_64.so.1")).toBe(
      true
    );
  });

  test("uses wide deterministic suffixes for generated identity names", () => {
    expect(stableShapeId("src/generated/very/long/path/main.ts:node-a", "Generated")).toMatch(
      /_[0-9a-f]{16}$/
    );
  });

  test("serializes canonical JSON keys by codepoint order", () => {
    expect(stableJson({ b: 1, a: 2, A: 3 })).toBe('{"A":3,"a":2,"b":1}');
    const privateUse = "\ue000";
    const astral = "😀";
    const payload = stableJson({ [astral]: 1, [privateUse]: 2 });
    expect(payload.indexOf(JSON.stringify(privateUse))).toBeLessThan(
      payload.indexOf(JSON.stringify(astral))
    );
  });

  test("keeps braces inside literals out of fingerprint signatures", () => {
    expect(
      signatureText('fn handle(label = "{open}", value: Value) { value }', "typescript")
    ).toContain("value: Value)");
  });

  test("keeps full brace-less declarations in fingerprint signatures", () => {
    expect(signatureText("fn handle(\n  a: A,\n  b: B\n);", "rust")).toContain("b: B");
  });

  test("projects Rust AST JSON into a semantic draft plus optional raw trace", () => {
    const ast = rustAuditAstJson();
    const graphResult = buildCodeSemanticGraphFromAstJson(ast);

    expect(graphResult.ok).toBe(true);
    if (!graphResult.ok) {
      throw new Error(formatAstTestDiagnostics(graphResult.diagnostics));
    }

    expect(graphResult.value.rawNodes).toHaveLength(ast.files[0]?.nodes.length ?? 0);
    const output = requireGeneratedOutput(
      generateShapeFromCodeSemanticGraph(graphResult.value, {
        moduleName: "generated.audit",
        rawModuleName: "generated.audit.raw"
      })
    );

    expect(output.semanticShape).toContain("resource AuditEvent : GeneratedCandidate");
    expect(output.semanticShape).toContain("component AuditStore : GeneratedCandidate");
    expect(output.semanticShape).toContain("fn append_event");
    expect(output.semanticShape).toContain("kind calls");
    expect(output.semanticShape).toContain("trait GeneratedAstAnchor");
    expect(output.semanticShape).toContain("fingerprint ast.semantic_subtree_v1");
    expect(output.semanticShape).toContain('storage ast.anchor("src/audit/store.rs:9-11")');
    expect(output.semanticShape).not.toContain('storage ast.anchor("{\\"target\\"');
    expect(output.semanticShape).toContain("kind generated_from");
    expect(output.semanticShape).toContain("expects AuditStoreAstAnchor fingerprint");
    expect(output.semanticShape).toContain("fn AuditStore.append_event generated from");
    expect(output.semanticShape).toContain("implementation AuditStoreImpl");
    expect(output.semanticShape).not.toContain("AuditStoreImpl_");
    expect(output.semanticShape).not.toContain("GeneratedAstNode");
    expect(output.rawShape).toContain("GeneratedAstNode");
    expect(output.rawShape).toContain("kind ast_child");

    const semantic = parseShapeModule(output.semanticShape);
    expect(semantic.ok).toBe(true);
    if (!semantic.ok) {
      throw new Error(semantic.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    }
    const formattedSemantic = formatShapeSource(output.semanticShape);
    expect(formattedSemantic.ok).toBe(true);
    if (formattedSemantic.ok) {
      expect(formattedSemantic.formatted).toBe(output.semanticShape);
    }
    const semanticCheck = checkShapeModules([semantic.module]);
    expect(semanticCheck.exitCode).toBe(1);
    expect(formatDiagnostics(semanticCheck)).toContain("unknown effects");

    const rawShape = output.rawShape ?? "";
    const raw = parseShapeModule(rawShape);
    expect(raw.ok).toBe(true);
    if (!raw.ok) {
      throw new Error(raw.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    }
    const formattedRaw = formatShapeSource(rawShape);
    expect(formattedRaw.ok).toBe(true);
    if (formattedRaw.ok) {
      expect(formattedRaw.formatted).toBe(rawShape);
    }
    expect(checkShapeModules([raw.module]).exitCode).toBe(0);
  });

  for (const fixture of languageAstFixtures()) {
    test(`generates parseable semantic Shape for ${fixture.language}`, () => {
      const result = generateShapeFromAstJson(fixture.ast, {
        moduleName: `generated.${fixture.language}`
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(formatAstTestDiagnostics(result.diagnostics));
      }
      expect(result.value.semanticShape).toContain(fixture.expected);
      expect(parseShapeModule(result.value.semanticShape).ok).toBe(true);
    });
  }

  test("attaches Go receiver methods to their component instead of a file module", () => {
    const result = generateShapeFromAstJson(goReceiverAstJson(), {
      moduleName: "generated.go"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(formatAstTestDiagnostics(result.diagnostics));
    }
    expect(result.value.semanticShape).toContain("component AuditStore : GeneratedCandidate");
    expect(result.value.semanticShape).toContain("  fn AppendEvent");
    expect(result.value.semanticShape).not.toContain("component StoreModule");
  });

  test("extracts Go named receiver field calls", () => {
    const result = generateShapeFromAstJson(goReceiverCallAstJson(), {
      moduleName: "generated.go"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(formatAstTestDiagnostics(result.diagnostics));
    }
    expect(result.value.semanticShape).toContain("kind calls");
    expect(result.value.semanticShape).toContain("connects AuditStore -> AuditRepo");
  });

  test("skips self-referential receiver calls", () => {
    const result = generateShapeFromAstJson({
      language: "typescript",
      files: [
        {
          path: "src/tree.ts",
          root: "root",
          nodes: [
            { id: "root", kind: "program", children: ["node"] },
            {
              id: "node",
              kind: "class_declaration",
              attributes: { name: "TreeNode" },
              text: "class TreeNode { child: TreeNode; walk() { this.child.walk(); } }",
              children: ["walk"]
            },
            {
              id: "walk",
              kind: "method_definition",
              attributes: { name: "walk" },
              text: "walk() { this.child.walk(); }"
            }
          ]
        }
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(formatAstTestDiagnostics(result.diagnostics));
    }
    expect(result.value.semanticShape).not.toContain("kind calls");
  });

  test("keeps anchor names stable while semantic fingerprints change with function bodies", () => {
    const before = buildCodeSemanticGraphFromAstJson(functionFingerprintAst("fn main() {}"));
    const after = buildCodeSemanticGraphFromAstJson(
      functionFingerprintAst("fn main() { let x = 1; }")
    );

    expect(before.ok).toBe(true);
    expect(after.ok).toBe(true);
    if (!before.ok || !after.ok) {
      throw new Error("failed to build test graphs");
    }

    const beforeAnchor = requireAstAnchor(before.value, "MainModule.main");
    const afterAnchor = requireAstAnchor(after.value, "MainModule.main");
    expect(beforeAnchor.name).toBe(afterAnchor.name);
    expect(beforeAnchor.fingerprint.value).not.toBe(afterAnchor.fingerprint.value);
  });

  test("flags authored AST relations when regenerated anchor fingerprints change", () => {
    const versionOne = buildCodeSemanticGraphFromAstJson(functionFingerprintAst("fn main() {}"));
    const versionTwo = buildCodeSemanticGraphFromAstJson(
      functionFingerprintAst("fn main() { let x = 1; }")
    );

    expect(versionOne.ok).toBe(true);
    expect(versionTwo.ok).toBe(true);
    if (!versionOne.ok || !versionTwo.ok) {
      throw new Error("failed to build test graphs");
    }

    const firstAnchor = requireAstAnchor(versionOne.value, "MainModule.main");
    const secondAnchor = requireAstAnchor(versionTwo.value, "MainModule.main");
    expect(firstAnchor.name).toBe(secondAnchor.name);
    expect(firstAnchor.fingerprint.value).not.toBe(secondAnchor.fingerprint.value);

    const authoredPin = parseShapeModule(`
      module reviewed.main
      import shape.generated.ast.main

      relation ReviewedMainEvidence {
        kind generated_from
        connects MainModule -> ${firstAnchor.name}
        expects ${firstAnchor.name} fingerprint ${firstAnchor.fingerprint.provider}("${firstAnchor.fingerprint.value}")
      }
    `);
    expect(authoredPin.ok).toBe(true);
    if (!authoredPin.ok) {
      throw new Error(formatAstTestDiagnostics(authoredPin.diagnostics));
    }

    const generatedVersionOne = parseShapeModule(
      requireGeneratedOutput(
        generateShapeFromCodeSemanticGraph(versionOne.value, {
          moduleName: "shape.generated.ast.main"
        })
      ).semanticShape
    );
    const generatedVersionTwo = parseShapeModule(
      requireGeneratedOutput(
        generateShapeFromCodeSemanticGraph(versionTwo.value, {
          moduleName: "shape.generated.ast.main"
        })
      ).semanticShape
    );
    expect(generatedVersionOne.ok).toBe(true);
    expect(generatedVersionTwo.ok).toBe(true);
    if (!generatedVersionOne.ok || !generatedVersionTwo.ok) {
      throw new Error("generated fingerprint Shape did not parse");
    }

    const matching = checkShapeModules([
      { module: generatedVersionOne.module, filePath: "shape/generated/ast/main.shape" },
      { module: authoredPin.module }
    ]);
    expect(
      matching.diagnostics.some((diagnostic) => diagnostic.kind === "fingerprint_mismatch")
    ).toBe(false);

    const stale = checkShapeModules([
      { module: generatedVersionTwo.module, filePath: "shape/generated/ast/main.shape" },
      { module: authoredPin.module }
    ]);
    const staleOutput = formatDiagnostics(stale);
    expect(stale.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "fingerprint_mismatch",
        relation: "reviewed.main::ReviewedMainEvidence",
        endpoint: `shape.generated.ast.main::${firstAnchor.name}`,
        expected: firstAnchor.fingerprint.value,
        actual: secondAnchor.fingerprint.value
      })
    );
    expect(staleOutput).toContain("stale fingerprint expectation");
    expect(staleOutput).toContain("relation ReviewedMainEvidence expects");
  });

  test("does not churn semantic fingerprints for unrelated or formatting-only edits", () => {
    const base = buildCodeSemanticGraphFromAstJson(
      multiFunctionFingerprintAst("fn main(){let x=1;}", "fn helper() {}")
    );
    const unrelatedChanged = buildCodeSemanticGraphFromAstJson(
      multiFunctionFingerprintAst(
        "fn main() { let   x = 1; } // comment",
        "fn helper() { let y = 2; }"
      )
    );

    expect(base.ok).toBe(true);
    expect(unrelatedChanged.ok).toBe(true);
    if (!base.ok || !unrelatedChanged.ok) {
      throw new Error("failed to build test graphs");
    }

    const baseAnchor = requireAstAnchor(base.value, "MainModule.main");
    const changedAnchor = requireAstAnchor(unrelatedChanged.value, "MainModule.main");
    expect(baseAnchor.fingerprint.value).toBe(changedAnchor.fingerprint.value);
  });

  test("does not churn fingerprints for CRLF inside string literals", () => {
    const lf = graphFromAstForTest(
      functionFingerprintAst('fn main() { let text = "alpha\nbeta"; }')
    );
    const crlf = graphFromAstForTest(
      functionFingerprintAst('fn main() { let text = "alpha\r\nbeta"; }')
    );

    expect(requireAstAnchor(lf, "MainModule.main").fingerprint.value).toBe(
      requireAstAnchor(crlf, "MainModule.main").fingerprint.value
    );
  });

  test("classifies function fingerprint churn across code evolution scenarios", () => {
    const base = graphFromAstForTest(
      functionFingerprintAst("fn main(input: u32) -> u32 { input + 1 }")
    );
    const baseAnchor = requireAstAnchor(base, "MainModule.main");
    const cases = [
      {
        label: "body literal changes",
        ast: functionFingerprintAst("fn main(input: u32) -> u32 { input + 2 }"),
        changes: true
      },
      {
        label: "signature parameter type changes",
        ast: functionFingerprintAst("fn main(input: u64) -> u32 { input + 1 }"),
        changes: true
      },
      {
        label: "return type changes",
        ast: functionFingerprintAst("fn main(input: u32) -> i64 { input + 1 }"),
        changes: true
      },
      {
        label: "operator changes",
        ast: functionFingerprintAst("fn main(input: u32) -> u32 { input - 1 }"),
        changes: true
      },
      {
        label: "formatting and comments change only",
        ast: functionFingerprintAst(
          "fn   main ( input : u32 ) -> u32 { /* explain */ input + 1 // keep\n }"
        ),
        changes: false
      },
      {
        label: "path span and parser node id change only",
        ast: functionFingerprintAst({
          text: "fn main(input: u32) -> u32 { input + 1 }",
          path: "crates/app/main.rs",
          nodeId: "renumbered_main",
          span: span(40, 3, 44, 4)
        }),
        changes: false
      }
    ];

    for (const scenario of cases) {
      const graph = graphFromAstForTest(scenario.ast);
      const anchor = requireAstAnchor(graph, "MainModule.main");
      expect(anchor.name).toBe(baseAnchor.name);
      if (scenario.changes) {
        expect(anchor.fingerprint.value).not.toBe(baseAnchor.fingerprint.value);
      } else {
        expect(anchor.fingerprint.value).toBe(baseAnchor.fingerprint.value);
      }
    }
  });

  test("classifies component declaration shell fingerprints across member evolution", () => {
    const base = graphFromAstForTest(componentShellFingerprintAst());
    const baseComponentAnchor = requireAstAnchor(base, "AuditStore");
    const baseFunctionAnchor = requireAstAnchor(base, "AuditStore.appendEvent");

    const methodBodyChanged = graphFromAstForTest(
      componentShellFingerprintAst({
        methodText: "appendEvent(event: AuditEvent) {\n  this.repo.archive(event);\n}"
      })
    );
    expect(requireAstAnchor(methodBodyChanged, "AuditStore").fingerprint.value).toBe(
      baseComponentAnchor.fingerprint.value
    );
    expect(
      requireAstAnchor(methodBodyChanged, "AuditStore.appendEvent").fingerprint.value
    ).not.toBe(baseFunctionAnchor.fingerprint.value);

    const methodSignatureChanged = graphFromAstForTest(
      componentShellFingerprintAst({
        methodText: "appendEvent(event: AuditEvent, actor: Actor) {\n  this.repo.insert(event);\n}"
      })
    );
    expect(requireAstAnchor(methodSignatureChanged, "AuditStore").fingerprint.value).not.toBe(
      baseComponentAnchor.fingerprint.value
    );
    expect(
      requireAstAnchor(methodSignatureChanged, "AuditStore.appendEvent").fingerprint.value
    ).not.toBe(baseFunctionAnchor.fingerprint.value);

    const fieldChanged = graphFromAstForTest(
      componentShellFingerprintAst({
        fieldText: "repo: DurableAuditRepo;"
      })
    );
    expect(requireAstAnchor(fieldChanged, "AuditStore").fingerprint.value).not.toBe(
      baseComponentAnchor.fingerprint.value
    );
    expect(requireAstAnchor(fieldChanged, "AuditStore.appendEvent").fingerprint.value).toBe(
      baseFunctionAnchor.fingerprint.value
    );

    const parserShapeChanged = graphFromAstForTest(
      componentShellFingerprintAst({
        path: "packages/audit/store.ts",
        typeNodeId: "renumbered_store",
        fieldNodeId: "renumbered_field",
        methodNodeId: "renumbered_append",
        typeSpan: span(20, 1, 24, 2),
        fieldSpan: span(21, 3, 21, 24),
        methodSpan: span(22, 3, 23, 4)
      })
    );
    expect(requireAstAnchor(parserShapeChanged, "AuditStore").name).toBe(baseComponentAnchor.name);
    expect(requireAstAnchor(parserShapeChanged, "AuditStore").fingerprint.value).toBe(
      baseComponentAnchor.fingerprint.value
    );
    expect(requireAstAnchor(parserShapeChanged, "AuditStore.appendEvent").name).toBe(
      baseFunctionAnchor.name
    );
    expect(requireAstAnchor(parserShapeChanged, "AuditStore.appendEvent").fingerprint.value).toBe(
      baseFunctionAnchor.fingerprint.value
    );
  });

  test("classifies resource declaration fingerprints across schema evolution", () => {
    const base = graphFromAstForTest(resourceShellFingerprintAst());
    const baseAnchor = requireAstAnchor(base, "AuditEvent");

    const fieldTypeChanged = graphFromAstForTest(
      resourceShellFingerprintAst({
        fieldText: "id: EventId,"
      })
    );
    expect(requireAstAnchor(fieldTypeChanged, "AuditEvent").name).toBe(baseAnchor.name);
    expect(requireAstAnchor(fieldTypeChanged, "AuditEvent").fingerprint.value).not.toBe(
      baseAnchor.fingerprint.value
    );

    const fieldAdded = graphFromAstForTest(
      resourceShellFingerprintAst({
        extraFieldText: "actor: String,"
      })
    );
    expect(requireAstAnchor(fieldAdded, "AuditEvent").name).toBe(baseAnchor.name);
    expect(requireAstAnchor(fieldAdded, "AuditEvent").fingerprint.value).not.toBe(
      baseAnchor.fingerprint.value
    );

    const commentsFormattingAndParserShapeChanged = graphFromAstForTest(
      resourceShellFingerprintAst({
        path: "crates/audit/event.rs",
        typeNodeId: "renumbered_event",
        fieldNodeId: "renumbered_id",
        typeSpan: span(100, 1, 103, 2),
        fieldSpan: span(101, 3, 101, 28),
        fieldText: "id   :   String, // durable identity"
      })
    );
    expect(requireAstAnchor(commentsFormattingAndParserShapeChanged, "AuditEvent").name).toBe(
      baseAnchor.name
    );
    expect(
      requireAstAnchor(commentsFormattingAndParserShapeChanged, "AuditEvent").fingerprint.value
    ).toBe(baseAnchor.fingerprint.value);
  });

  test("renamed AST targets leave authored pins unresolved instead of matching a new anchor", () => {
    const versionOne = graphFromAstForTest(functionFingerprintAst("fn main() {}"));
    const firstAnchor = requireAstAnchor(versionOne, "MainModule.main");
    const versionTwo = graphFromAstForTest(
      functionFingerprintAst({
        functionName: "launch",
        text: "fn launch() {}"
      })
    );
    const renamedAnchor = requireAstAnchor(versionTwo, "MainModule.launch");

    expect(renamedAnchor.name).not.toBe(firstAnchor.name);

    const authoredPin = parseShapeModule(`
      module reviewed.main
      import shape.generated.ast.main

      relation ReviewedMainEvidence {
        kind generated_from
        connects MainModule -> ${firstAnchor.name}
        expects ${firstAnchor.name} fingerprint ${firstAnchor.fingerprint.provider}("${firstAnchor.fingerprint.value}")
      }
    `);
    expect(authoredPin.ok).toBe(true);
    if (!authoredPin.ok) {
      throw new Error(formatAstTestDiagnostics(authoredPin.diagnostics));
    }

    const generatedVersionTwo = parseShapeModule(
      requireGeneratedOutput(
        generateShapeFromCodeSemanticGraph(versionTwo, {
          moduleName: "shape.generated.ast.main"
        })
      ).semanticShape
    );
    expect(generatedVersionTwo.ok).toBe(true);
    if (!generatedVersionTwo.ok) {
      throw new Error("generated renamed Shape did not parse");
    }

    const result = checkShapeModules([
      { module: generatedVersionTwo.module, filePath: "shape/generated/ast/main.shape" },
      { module: authoredPin.module }
    ]);
    const output = formatDiagnostics(result);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unknown_name",
        nameKind: "relation_endpoint",
        name: `reviewed.main::${firstAnchor.name}`
      })
    );
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.kind === "fingerprint_mismatch")
    ).toBe(false);
    expect(output).toContain(firstAnchor.name);
    expect(output).toContain("unknown relation_endpoint");
  });

  test("warns and skips fingerprints when AST JSON lacks token data", () => {
    const result = generateShapeFromAstJson({
      language: "rust",
      files: [
        {
          path: "src/main.rs",
          root: "root",
          nodes: [
            { id: "root", kind: "source_file", children: ["main"] },
            { id: "main", kind: "function_item", attributes: { name: "main" } }
          ]
        }
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "warning", code: "missing_fingerprint_tokens" })
    );
    if (result.ok) {
      expect(result.value.semanticShape).toContain("resource MainModuleMainAstAnchor");
      expect(result.value.semanticShape).not.toContain("fingerprint ast.semantic_subtree_v1");
      expect(result.value.semanticShape).not.toContain("expects MainModuleMainAstAnchor");
    }
  });

  test("skips candidate effects whose anchors cannot be pinned", () => {
    const graph: CodeSemanticGraph = {
      files: [],
      rawNodes: [],
      containers: [
        {
          id: "owner",
          name: "AuditStore",
          kind: "type",
          path: "src/audit.ts",
          language: "typescript",
          confidence: "medium"
        }
      ],
      functions: [
        {
          id: "fn",
          name: "saveEvent",
          path: "src/audit.ts",
          language: "typescript",
          ownerId: "owner",
          anchorId: "anchor",
          confidence: "medium",
          sourceRef: "src/audit.ts:1-3"
        }
      ],
      resources: [
        {
          id: "resource",
          name: "AuditEvent",
          path: "src/audit.ts",
          language: "typescript",
          confidence: "medium",
          reason: "test resource",
          sourceRef: "src/audit.ts:1-1"
        }
      ],
      anchors: [
        {
          id: "anchor",
          name: "AuditStoreSaveEventAstAnchor",
          path: "src/audit.ts",
          language: "typescript",
          nodeId: "fn-node",
          kind: "method_definition",
          sourceRef: "src/audit.ts:1-3",
          target: "AuditStore.saveEvent",
          targetKind: "fn"
        }
      ],
      relations: [],
      candidateEffects: [
        {
          id: "candidate",
          name: "AuditStoreSaveEventAppendAuditEventCandidateEffect",
          functionId: "fn",
          effect: "Append",
          targetResourceId: "resource",
          sourceRef: "src/audit.ts:1-3",
          confidence: "low",
          anchorId: "anchor",
          summary: "saveEvent may append AuditEvent"
        }
      ],
      diagnostics: []
    };

    const output = requireGeneratedOutput(generateShapeFromCodeSemanticGraph(graph));
    expect(output.semanticShape).toContain("resource AuditStoreSaveEventAstAnchor");
    expect(output.semanticShape).not.toContain("effect candidate");
    expect(output.semanticShape).not.toContain("pin AuditStoreSaveEventAstAnchor");
  });

  test("handles deeply nested AST JSON nodes without recursive stack overflow", () => {
    const depth = 6000;
    const nodes = Array.from({ length: depth }, (_, index) => ({
      id: `node-${index}`,
      kind: "wrapper",
      children: [index + 1 === depth ? "main" : `node-${index + 1}`]
    }));
    const result = buildCodeSemanticGraphFromAstJson({
      language: "rust",
      files: [
        {
          path: "src/main.rs",
          root: "node-0",
          nodes: [
            ...nodes,
            {
              id: "main",
              kind: "function_item",
              attributes: { name: "main" },
              text: "fn main() {}"
            }
          ]
        }
      ]
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rawNodes).toHaveLength(depth + 1);
    }
  });

  test("keeps same-named AST declarations from different files as distinct identities", () => {
    const graph = graphFromAstForTest({
      language: "typescript",
      files: [
        {
          path: "src/left/store.ts",
          root: "leftRoot",
          nodes: [
            { id: "leftRoot", kind: "program", children: ["leftStore"] },
            {
              id: "leftStore",
              kind: "class_declaration",
              text: "class AuditStore { read() {} }",
              children: ["leftRead"]
            },
            { id: "leftRead", kind: "method_definition", text: "read() {}" }
          ]
        },
        {
          path: "src/right/store.ts",
          root: "rightRoot",
          nodes: [
            { id: "rightRoot", kind: "program", children: ["rightStore"] },
            {
              id: "rightStore",
              kind: "class_declaration",
              text: "class AuditStore { read() {} }",
              children: ["rightRead"]
            },
            { id: "rightRead", kind: "method_definition", text: "read() {}" }
          ]
        }
      ]
    });
    const stores = graph.containers.filter((container) => container.name.startsWith("AuditStore"));

    expect(stores).toHaveLength(2);
    expect(new Set(stores.map((store) => store.id)).size).toBe(2);
    expect(new Set(stores.map((store) => store.name)).size).toBe(2);
  });

  test("allocates deterministic names for overloaded AST functions", () => {
    const graph = graphFromAstForTest({
      language: "typescript",
      files: [
        {
          path: "src/store.ts",
          root: "root",
          nodes: [
            { id: "root", kind: "program", children: ["store"] },
            {
              id: "store",
              kind: "class_declaration",
              text: "class AuditStore { read(id: string) {} read(id: number) {} }",
              children: ["readString", "readNumber"]
            },
            { id: "readString", kind: "method_definition", text: "read(id: string) {}" },
            { id: "readNumber", kind: "method_definition", text: "read(id: number) {}" }
          ]
        }
      ]
    });
    const store = graph.containers.find((container) => container.name === "AuditStore");
    const functions = graph.functions.filter((fn) => fn.ownerId === store?.id);

    expect(functions).toHaveLength(2);
    expect(new Set(functions.map((fn) => fn.name)).size).toBe(2);
  });

  test("rejects invalid semantic graph edges instead of dropping them during rendering", () => {
    const graph = graphFromAstForTest(functionFingerprintAst("fn main() {}"));
    graph.relations.push({
      id: "bad_relation",
      kind: "calls",
      fromId: "missing_from",
      toId: graph.containers[0]?.id ?? "missing_to",
      path: "src/main.rs",
      confidence: "high",
      summary: "invalid test edge"
    });

    const result = generateShapeFromCodeSemanticGraph(graph, { moduleName: "generated.invalid" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalid_semantic_relation" })
      );
    }
  });

  test("preserves explicit source language for extensionless files", async () => {
    const source = "fn main() {}\n";
    const functionNode = fakeTreeSitterNode({
      kind: "function_item",
      startByte: 0,
      endByte: 12,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 12 }
    });
    const root = fakeTreeSitterNode({
      kind: "source_file",
      startByte: 0,
      endByte: source.length,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 1, column: 0 },
      children: [{ fieldName: "item", node: functionNode }]
    });

    const graph = await parseSourceFilesToCodeSemanticGraph(
      [{ path: "src/main", source, language: "rust" }],
      { parserProvider: () => ({ rootNode: root }) }
    );

    expect(graph.ok).toBe(true);
    if (!graph.ok) {
      throw new Error(formatAstTestDiagnostics(graph.diagnostics));
    }
    const output = requireGeneratedOutput(
      generateShapeFromCodeSemanticGraph(graph.value, {
        moduleName: "generated.rust"
      })
    );
    expect(output.semanticShape).toContain('source rust("src/main:1-1")');
    expect(output.semanticShape).not.toContain('source file("src/main:1-1")');
  });

  test("infers JSX and TSX parser languages from file extensions", async () => {
    const source = "export function Widget() { return <div />; }\n";
    const root = fakeTreeSitterNode({
      kind: "program",
      startByte: 0,
      endByte: source.length,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 1, column: 0 }
    });
    const languages: string[] = [];

    const result = await parseSourceFilesToCodeSemanticGraph(
      [
        { path: "src/widget.jsx", source },
        { path: "src/widget.tsx", source }
      ],
      {
        parserProvider: (language) => {
          languages.push(language);
          return { rootNode: root };
        }
      }
    );

    expect(result.ok).toBe(true);
    expect(languages).toEqual(["javascript", "tsx"]);
  });

  test("configures complete bundled parser assets before parser lookup", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shp-parser-assets-test-"));
    try {
      const executablePath = join(tempDir, "bin", "shp");
      const libsDir = bundledTreeSitterParserLibsDir(executablePath);
      await mkdir(libsDir, { recursive: true });
      for (const language of BUNDLED_TREE_SITTER_LANGUAGES) {
        await writeFile(join(libsDir, treeSitterParserLibraryName(language)), "");
      }

      let configuredCacheDir: string | undefined;
      const diagnostics = configureBundledTreeSitterParsers(
        {
          configure: (config?: { cacheDir?: string }) => {
            configuredCacheDir = config?.cacheDir;
          }
        },
        executablePath
      );

      expect(diagnostics).toEqual([]);
      expect(configuredCacheDir).toBe(libsDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("normalizes Tree-sitter-like source nodes with field names, spans, and hashes", async () => {
    const source = "fn main() {}\n";
    const functionNode = fakeTreeSitterNode({
      kind: "function_item",
      startByte: 0,
      endByte: 12,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 12 }
    });
    const root = fakeTreeSitterNode({
      kind: "source_file",
      startByte: 0,
      endByte: source.length,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 1, column: 0 },
      children: [{ fieldName: "item", node: functionNode }]
    });

    const result = await parseSourceFilesToCodeSemanticGraph([{ path: "src/main.rs", source }], {
      parserProvider: () => ({ rootNode: root })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(formatAstTestDiagnostics(result.diagnostics));
    }
    expect(result.value.files[0]?.sourceHash).toMatch(/^[0-9a-f]{8}$/);
    expect(result.value.rawNodes).toHaveLength(2);
    const normalizedFunction = result.value.rawNodes.find((node) => node.kind === "function_item");
    expect(normalizedFunction?.fieldName).toBe("item");
    expect(normalizedFunction?.span?.startLine).toBe(1);
    expect(normalizedFunction?.text).toBe("fn main() {}");
    expect(normalizedFunction?.textHash).toMatch(/^[0-9a-f]{8}$/);
  });

  test("handles deeply nested Tree-sitter nodes without recursive stack overflow", async () => {
    const source = "class Deep { run() {} }\n";
    let child = fakeTreeSitterNode({
      kind: "method_definition",
      startByte: 13,
      endByte: 21,
      startPosition: { row: 0, column: 13 },
      endPosition: { row: 0, column: 21 }
    });
    for (let index = 0; index < 6000; index += 1) {
      child = fakeTreeSitterNode({
        kind: "parenthesized_expression",
        startByte: 13,
        endByte: 21,
        startPosition: { row: 0, column: 13 },
        endPosition: { row: 0, column: 21 },
        children: [{ node: child }]
      });
    }
    const classNode = fakeTreeSitterNode({
      kind: "class_declaration",
      startByte: 0,
      endByte: 21,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 21 },
      children: [{ fieldName: "body", node: child }]
    });
    const root = fakeTreeSitterNode({
      kind: "program",
      startByte: 0,
      endByte: source.length,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 1, column: 0 },
      children: [{ node: classNode }]
    });

    const result = await parseSourceFilesToCodeSemanticGraph([{ path: "src/deep.ts", source }], {
      parserProvider: () => ({ rootNode: root })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(formatAstTestDiagnostics(result.diagnostics));
    }
    expect(result.value.rawNodes.length).toBeGreaterThan(6000);
    expect(requireAstAnchor(result.value, "Deep").fingerprint.value).toMatch(
      /^sha256:[0-9a-f]{64}$/
    );
  });

  test("rejects parser errors unless explicitly allowed", async () => {
    const root = fakeTreeSitterNode({
      kind: "source_file",
      startByte: 0,
      endByte: 4,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 4 },
      hasError: true
    });

    const rejected = await parseSourceFilesToCodeSemanticGraph(
      [{ path: "src/broken.py", source: "def " }],
      { parserProvider: () => ({ rootNode: root }) }
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.map((diagnostic) => diagnostic.code)).toContain("parse_error");
    }

    const allowed = await parseSourceFilesToCodeSemanticGraph(
      [{ path: "src/broken.py", source: "def " }],
      { allowParseErrors: true, parserProvider: () => ({ rootNode: root }) }
    );
    expect(allowed.ok).toBe(true);
  });

  test("rejects malformed AST JSON instead of dropping raw nodes", () => {
    const result = buildCodeSemanticGraphFromAstJson({
      language: "rust",
      files: [
        {
          path: "src/broken.rs",
          root: "root",
          nodes: [
            {
              id: "root",
              kind: "source_file",
              attributes: { nested: { unsupported: true } },
              children: ["missing"]
            },
            { id: "orphan", kind: "function_item", text: "fn orphan() {}" }
          ]
        }
      ]
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
      expect(codes).toContain("nested_attribute");
    }
  });
});

function rustAuditAstJson() {
  return {
    language: "rust",
    files: [
      {
        path: "src/audit/store.rs",
        root: "root",
        nodes: [
          {
            id: "root",
            kind: "source_file",
            span: span(1, 1, 24, 1),
            children: ["event", "repo", "store", "repoImpl", "storeImpl"]
          },
          {
            id: "event",
            kind: "struct_item",
            attributes: { name: "AuditEvent" },
            span: span(1, 1, 3, 2),
            text: "struct AuditEvent {\n  id: String,\n}"
          },
          {
            id: "repo",
            kind: "struct_item",
            attributes: { name: "AuditRepo" },
            span: span(5, 1, 7, 2),
            text: "struct AuditRepo {\n  client: DbClient,\n}"
          },
          {
            id: "store",
            kind: "struct_item",
            attributes: { name: "AuditStore" },
            span: span(9, 1, 11, 2),
            text: "struct AuditStore {\n  repo: AuditRepo,\n}"
          },
          {
            id: "repoImpl",
            kind: "impl_item",
            span: span(13, 1, 17, 2),
            text: "impl AuditRepo {\n  fn insert(&self, event: AuditEvent) {}\n}",
            children: [{ id: "repoImplType", field: "type" }, "repoInsert"]
          },
          {
            id: "repoImplType",
            kind: "type_identifier",
            span: span(13, 6, 13, 15),
            text: "AuditRepo"
          },
          {
            id: "repoInsert",
            kind: "function_item",
            attributes: { name: "insert" },
            span: span(14, 3, 14, 45),
            text: "fn insert(&self, event: AuditEvent) {}"
          },
          {
            id: "storeImpl",
            kind: "impl_item",
            span: span(19, 1, 24, 2),
            text: "impl AuditStore {\n  fn append_event(&self, event: AuditEvent) {\n    self.repo.insert(event);\n  }\n}",
            children: [{ id: "storeImplType", field: "type" }, "storeAppend"]
          },
          {
            id: "storeImplType",
            kind: "type_identifier",
            span: span(19, 6, 19, 16),
            text: "AuditStore"
          },
          {
            id: "storeAppend",
            kind: "function_item",
            attributes: { name: "append_event" },
            span: span(20, 3, 22, 4),
            text: "fn append_event(&self, event: AuditEvent) {\n  self.repo.insert(event);\n}"
          }
        ]
      }
    ]
  };
}

type FunctionFingerprintAstInput = {
  text: string;
  path?: string;
  nodeId?: string;
  functionName?: string;
  span?: SourceSpan;
};

function functionFingerprintAst(input: string | FunctionFingerprintAstInput): unknown {
  const normalized = typeof input === "string" ? { text: input } : input;
  return multiFunctionFingerprintAst(normalized.text, undefined, normalized);
}

function multiFunctionFingerprintAst(
  mainText: string,
  helperText?: string,
  input: Partial<FunctionFingerprintAstInput> = {}
): unknown {
  const path = input.path ?? "src/main.rs";
  const mainNodeId = input.nodeId ?? "main";
  const functionName = input.functionName ?? "main";
  return {
    language: "rust",
    files: [
      {
        path,
        root: "root",
        nodes: [
          {
            id: "root",
            kind: "source_file",
            span: input.span,
            children: helperText ? [mainNodeId, "helper"] : [mainNodeId]
          },
          {
            id: mainNodeId,
            kind: "function_item",
            attributes: { name: functionName },
            span: input.span,
            text: mainText
          },
          ...(helperText
            ? [
                {
                  id: "helper",
                  kind: "function_item",
                  attributes: { name: "helper" },
                  text: helperText
                }
              ]
            : [])
        ]
      }
    ]
  };
}

type ComponentShellFingerprintAstInput = {
  path?: string;
  fieldText?: string;
  methodText?: string;
  typeNodeId?: string;
  fieldNodeId?: string;
  methodNodeId?: string;
  typeSpan?: SourceSpan;
  fieldSpan?: SourceSpan;
  methodSpan?: SourceSpan;
};

function componentShellFingerprintAst(input: ComponentShellFingerprintAstInput = {}): unknown {
  const path = input.path ?? "src/audit/store.ts";
  const typeNodeId = input.typeNodeId ?? "store";
  const fieldNodeId = input.fieldNodeId ?? "repoField";
  const methodNodeId = input.methodNodeId ?? "append";
  const fieldText = input.fieldText ?? "repo: AuditRepo;";
  const methodText =
    input.methodText ?? "appendEvent(event: AuditEvent) {\n  this.repo.insert(event);\n}";
  return {
    language: "typescript",
    files: [
      {
        path,
        root: "root",
        nodes: [
          {
            id: "root",
            kind: "program",
            children: [typeNodeId]
          },
          {
            id: typeNodeId,
            kind: "class_declaration",
            attributes: { name: "AuditStore" },
            span: input.typeSpan,
            text: `class AuditStore {\n  ${fieldText}\n  ${methodText}\n}`,
            children: [fieldNodeId, methodNodeId]
          },
          {
            id: fieldNodeId,
            kind: "property_definition",
            span: input.fieldSpan,
            text: fieldText
          },
          {
            id: methodNodeId,
            kind: "method_definition",
            attributes: { name: "appendEvent" },
            span: input.methodSpan,
            text: methodText
          }
        ]
      }
    ]
  };
}

type ResourceShellFingerprintAstInput = {
  path?: string;
  fieldText?: string;
  extraFieldText?: string;
  typeNodeId?: string;
  fieldNodeId?: string;
  extraFieldNodeId?: string;
  typeSpan?: SourceSpan;
  fieldSpan?: SourceSpan;
};

function resourceShellFingerprintAst(input: ResourceShellFingerprintAstInput = {}): unknown {
  const path = input.path ?? "src/audit/event.rs";
  const typeNodeId = input.typeNodeId ?? "event";
  const fieldNodeId = input.fieldNodeId ?? "eventId";
  const extraFieldNodeId = input.extraFieldNodeId ?? "actor";
  const fieldText = input.fieldText ?? "id: String,";
  const children = input.extraFieldText ? [fieldNodeId, extraFieldNodeId] : [fieldNodeId];
  return {
    language: "rust",
    files: [
      {
        path,
        root: "root",
        nodes: [
          {
            id: "root",
            kind: "source_file",
            children: [typeNodeId]
          },
          {
            id: typeNodeId,
            kind: "struct_item",
            attributes: { name: "AuditEvent" },
            span: input.typeSpan,
            text: `struct AuditEvent {\n  ${fieldText}${
              input.extraFieldText ? `\n  ${input.extraFieldText}` : ""
            }\n}`,
            children
          },
          {
            id: fieldNodeId,
            kind: "field_declaration",
            span: input.fieldSpan,
            text: fieldText
          },
          ...(input.extraFieldText
            ? [
                {
                  id: extraFieldNodeId,
                  kind: "field_declaration",
                  text: input.extraFieldText
                }
              ]
            : [])
        ]
      }
    ]
  };
}

type FingerprintedAstAnchor = CodeSemanticGraph["anchors"][number] & {
  fingerprint: NonNullable<CodeSemanticGraph["anchors"][number]["fingerprint"]>;
};

function astAnchorForTarget(
  graph: CodeSemanticGraph,
  target: string
): CodeSemanticGraph["anchors"][number] | undefined {
  return graph.anchors.find((anchor) => anchor.target === target);
}

function graphFromAstForTest(ast: unknown): CodeSemanticGraph {
  const result = buildCodeSemanticGraphFromAstJson(ast);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(formatAstTestDiagnostics(result.diagnostics));
  }
  return result.value;
}

function requireAstAnchor(graph: CodeSemanticGraph, target: string): FingerprintedAstAnchor {
  const anchor = astAnchorForTarget(graph, target);
  expect(anchor).toBeDefined();
  if (!anchor) {
    throw new Error(`missing AST anchor for ${target}`);
  }
  expect(anchor.fingerprint).toBeDefined();
  if (!anchor.fingerprint) {
    throw new Error(`missing AST anchor fingerprint for ${target}`);
  }
  return anchor as FingerprintedAstAnchor;
}

function languageAstFixtures(): { language: string; expected: string; ast: unknown }[] {
  return [
    {
      language: "rust",
      expected: "component AuditStore : GeneratedCandidate",
      ast: rustAuditAstJson()
    },
    {
      language: "typescript",
      expected: "fn appendEvent",
      ast: classFixtureAst({
        language: "typescript",
        path: "src/audit/store.ts",
        rootKind: "program",
        classKind: "class_declaration",
        methodKind: "method_definition",
        classText:
          "class AuditStore {\n  repo: AuditRepo;\n  appendEvent(event: AuditEvent) {\n    this.repo.insert(event);\n  }\n}"
      })
    },
    {
      language: "python",
      expected: "fn append_event",
      ast: classFixtureAst({
        language: "python",
        path: "src/audit/store.py",
        rootKind: "module",
        classKind: "class_definition",
        methodKind: "function_definition",
        classText:
          "class AuditStore:\n    repo: AuditRepo\n    def append_event(self, event):\n        self.repo.insert(event)"
      })
    },
    {
      language: "go",
      expected: "component AuditStore : GeneratedCandidate",
      ast: goReceiverAstJson()
    }
  ];
}

function goReceiverAstJson(): unknown {
  return {
    language: "go",
    files: [
      {
        path: "src/audit/store.go",
        root: "root",
        nodes: [
          {
            id: "root",
            kind: "source_file",
            children: ["store", "append"]
          },
          {
            id: "store",
            kind: "type_declaration",
            attributes: { name: "AuditStore" },
            text: "type AuditStore struct {\n  repo AuditRepo\n}"
          },
          {
            id: "append",
            kind: "function_declaration",
            attributes: { name: "AppendEvent" },
            text: "func (s *AuditStore) AppendEvent(event AuditEvent) {\n  s.repo.Insert(event)\n}"
          }
        ]
      }
    ]
  };
}

function goReceiverCallAstJson(): unknown {
  return {
    language: "go",
    files: [
      {
        path: "src/audit/store.go",
        root: "root",
        nodes: [
          {
            id: "root",
            kind: "source_file",
            children: ["repo", "store", "save", "run"]
          },
          {
            id: "repo",
            kind: "type_declaration",
            attributes: { name: "AuditRepo" },
            text: "type AuditRepo struct {\n}"
          },
          {
            id: "store",
            kind: "type_declaration",
            attributes: { name: "AuditStore" },
            text: "type AuditStore struct {\n  repo *AuditRepo\n}"
          },
          {
            id: "save",
            kind: "function_declaration",
            attributes: { name: "Save" },
            text: "func (r *AuditRepo) Save(event AuditEvent) {\n}"
          },
          {
            id: "run",
            kind: "function_declaration",
            attributes: { name: "Run" },
            text: "func (s *AuditStore) Run(event AuditEvent) {\n  s.repo.Save(event)\n}"
          }
        ]
      }
    ]
  };
}

function classFixtureAst(input: {
  language: string;
  path: string;
  rootKind: string;
  classKind: string;
  methodKind: string;
  classText: string;
}): unknown {
  return {
    language: input.language,
    files: [
      {
        path: input.path,
        root: "root",
        nodes: [
          {
            id: "root",
            kind: input.rootKind,
            children: ["repo", "store"]
          },
          {
            id: "repo",
            kind: input.classKind,
            attributes: { name: "AuditRepo" },
            text: "class AuditRepo {\n  insert(event: AuditEvent) {}\n}",
            children: ["insert"]
          },
          {
            id: "insert",
            kind: input.methodKind,
            attributes: { name: "insert" },
            text: "insert(event: AuditEvent) {}"
          },
          {
            id: "store",
            kind: input.classKind,
            attributes: { name: "AuditStore" },
            text: input.classText,
            children: ["append"]
          },
          {
            id: "append",
            kind: input.methodKind,
            attributes: {
              name: input.language === "python" ? "append_event" : "appendEvent"
            },
            text:
              input.language === "python"
                ? "def append_event(self, event):\n    self.repo.insert(event)"
                : "appendEvent(event: AuditEvent) {\n  this.repo.insert(event);\n}"
          }
        ]
      }
    ]
  };
}

function span(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): SourceSpan {
  return { startLine, startColumn, endLine, endColumn };
}
type FakeTreeSitterPosition = {
  row: number;
  column: number;
};

type FakeTreeSitterNode = {
  kind: () => string;
  isNamed: () => boolean;
  startPosition: () => FakeTreeSitterPosition;
  endPosition: () => FakeTreeSitterPosition;
  startByte: () => number;
  endByte: () => number;
  childCount: () => number;
  child: (index: number) => FakeTreeSitterNode | undefined;
  walk: () => FakeTreeSitterCursor;
  hasError: () => boolean;
};

type FakeTreeSitterCursor = {
  gotoFirstChild: () => boolean;
  gotoNextSibling: () => boolean;
  node: () => FakeTreeSitterNode | undefined;
  fieldName: () => string | undefined;
};

function fakeTreeSitterNode(input: {
  kind: string;
  startByte: number;
  endByte: number;
  startPosition: FakeTreeSitterPosition;
  endPosition: FakeTreeSitterPosition;
  children?: { fieldName?: string; node: FakeTreeSitterNode }[];
  hasError?: boolean;
}): FakeTreeSitterNode {
  const children = input.children ?? [];
  return {
    kind: () => input.kind,
    isNamed: () => true,
    startPosition: () => input.startPosition,
    endPosition: () => input.endPosition,
    startByte: () => input.startByte,
    endByte: () => input.endByte,
    childCount: () => children.length,
    child: (index) => children[index]?.node,
    walk: () => {
      let index = -1;
      return {
        gotoFirstChild: () => {
          if (children.length === 0) {
            return false;
          }
          index = 0;
          return true;
        },
        gotoNextSibling: () => {
          if (index + 1 >= children.length) {
            return false;
          }
          index += 1;
          return true;
        },
        node: () => children[index]?.node,
        fieldName: () => children[index]?.fieldName
      };
    },
    hasError: () => input.hasError === true
  };
}
