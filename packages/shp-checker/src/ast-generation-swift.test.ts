import { describe, expect, test } from "bun:test";
import {
  checkShapeModules,
  formatShapeSource,
  generateShapeFromSourceFiles,
  parseShapeModule
} from "./index.ts";
import {
  buildCodeSemanticGraphFromAstJson,
  parseSourceFilesToCodeSemanticGraph,
  type CodeSemanticGraph
} from "./ast-generation-core.ts";

async function graphFor(source: string): Promise<CodeSemanticGraph> {
  const result = await parseSourceFilesToCodeSemanticGraph([{ path: "Sources/App.swift", source }]);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

function members(graph: CodeSemanticGraph, owner: string): string[] {
  const container = graph.containers.find((item) => item.name === owner);
  return graph.functions.filter((fn) => fn.ownerId === container?.id).map((fn) => fn.sourceRef);
}

function fingerprints(graph: CodeSemanticGraph): Record<string, string | undefined> {
  return Object.fromEntries(
    graph.anchors
      .filter((anchor) => anchor.targetKind === "fn")
      .map((anchor) => [anchor.sourceRef, anchor.fingerprint?.value])
  );
}

describe("Swift source drafts", () => {
  test("projects Swift and SwiftUI declarations through the real parser", async () => {
    const source = await Bun.file(
      new URL("../../../fixtures/source/swift/architecture.swift", import.meta.url)
    ).text();
    const graph = await graphFor(source);
    expect(graph.resources.map((resource) => resource.name)).toContain("AuditEvent");
    expect(graph.containers.filter((container) => container.name === "AuditStore")).toHaveLength(1);
    expect(members(graph, "AuditStore")).toEqual(
      expect.arrayContaining([
        "Sources/App.swift#AuditStore.init(events:[AuditEvent])",
        "Sources/App.swift#AuditStore.save(_:AuditEvent) async throws",
        "Sources/App.swift#AuditStore.load(id:Int) -> AuditEvent ?",
        "Sources/App.swift#AuditStore.load(id:String) -> AuditEvent ?",
        "Sources/App.swift#AuditStore.subscript(index:Int) -> AuditEvent",
        "Sources/App.swift#AuditStore.clear()"
      ])
    );
    expect(members(graph, "AuditStore").some((ref) => ref.includes("count"))).toBe(false);
    expect(members(graph, "AuditStoreSnapshot")).toEqual([
      "Sources/App.swift#AuditStore.Snapshot.count() -> Int"
    ]);
    expect(members(graph, "Repository")).toContain(
      "Sources/App.swift#Repository.save(_:Item) async throws [requirement]"
    );
    expect(members(graph, "Repository")).toContain(
      "Sources/App.swift#Repository.contains(_:Item) -> Bool [where Item : Equatable]"
    );
    expect(members(graph, "ContentView")).toEqual(["Sources/App.swift#ContentView.body"]);
    expect(members(graph, "Connection")).toEqual(
      expect.arrayContaining([
        "Sources/App.swift#Connection.deinit()",
        "Sources/App.swift#Connection.value"
      ])
    );
    expect(graph.relations).toEqual([]);
    expect(graph.candidateEffects).toEqual([]);

    const result = await generateShapeFromSourceFiles([{ path: "Sources/App.swift", source }], {
      moduleName: "shape.generated.ast.swift_example",
      rawModuleName: "shape.generated.ast.swift_raw"
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.semanticShape).toContain(
      'source swift("Sources/App.swift#ContentView.body")'
    );
    expect(result.value.semanticShape).toContain("storage swift.type(");
    expect(result.value.semanticShape).not.toContain("effects complete");
    expect(result.value.rawShape).toContain("ast_child");
    expect(formatShapeSource(result.value.semanticShape)).toMatchObject({
      ok: true,
      formatted: result.value.semanticShape
    });
    const parsed = parseShapeModule(result.value.semanticShape);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    // Authored use must still require reviewed effects.
    const checked = checkShapeModules([parsed.module]);
    expect(checked.diagnostics.length).toBeGreaterThan(0);
    expect(checked.diagnostics.every((diagnostic) => diagnostic.kind === "unknown_effects")).toBe(
      true
    );
  });

  test("keeps overloads and nested owners stable across unrelated syntax movement", async () => {
    const declarations = [
      "func load(id: Int) {}",
      "func load(id: String) {}",
      "static func load(id: Int) {}"
    ];
    const before = await graphFor(`struct Store { ${declarations.join("\n")} }`);
    const after = await graphFor(
      `// moved\nfunc unrelated() {}\nstruct Store { ${declarations.toReversed().join("\n")} }`
    );
    const identities = (graph: CodeSemanticGraph) =>
      graph.functions
        .filter((fn) => fn.sourceRef.includes("#Store."))
        .map((fn) => [fn.name, fn.sourceRef])
        .sort();
    expect(identities(after)).toEqual(identities(before));
    expect(new Set(before.functions.map((fn) => fn.sourceRef)).size).toBe(3);
    const nested = await graphFor(
      "struct Outer { struct Inner { func run() {} }; func run() { func local() {} } }"
    );
    expect(members(nested, "Outer")).toEqual(["Sources/App.swift#Outer.run()"]);
    expect(members(nested, "OuterInner")).toEqual(["Sources/App.swift#Outer.Inner.run()"]);
  });

  test("excludes nested local types instead of merging them with top-level names", async () => {
    const graph = await graphFor(`
      struct Inner { func real() {} }
      func run() {
        struct Local {
          struct Inner { func local() {} }
        }
      }
    `);
    expect(graph.containers.map((container) => container.name).sort()).toEqual([
      "AppModule",
      "Inner"
    ]);
    expect(graph.functions.map((fn) => fn.sourceRef).sort()).toEqual([
      "Sources/App.swift#Inner.real()",
      "Sources/App.swift#run()"
    ]);
  });

  test("preserves external extension targets without claiming cross-file resolution", async () => {
    const graph = await graphFor("extension External.Store { func run() {} }");
    expect(graph.functions[0]?.sourceRef).toBe("Sources/App.swift#External.Store.run()");
    expect(graph.relations).toEqual([]);
  });

  test("accepts modern syntax while leaving macro, condition, and dispatch evidence unresolved", async () => {
    const graph = await graphFor(`
      #if canImport(SwiftUI)
      import SwiftUI
      #endif
      @Observable final class Model { var value = 0 }
      enum Failure: Error { case failed }
      func run() throws(Failure) { throw .failed }
      @concurrent func fetch() async -> Int { 1 }
      #Preview { Text("hello") }
    `);
    expect(graph.functions).toHaveLength(2);
    expect(graph.relations).toEqual([]);
    expect(graph.candidateEffects).toEqual([]);
    expect(graph.anchors.every((anchor) => anchor.fingerprint)).toBe(true);
  });

  test("rejects malformed Swift unless draft parsing is explicitly allowed", async () => {
    const files = [{ path: "Sources/Broken.swift", source: "struct Broken { func run(" }];
    const rejected = await parseSourceFilesToCodeSemanticGraph(files);
    expect(rejected.ok).toBe(false);
    expect(rejected.diagnostics.some((diagnostic) => diagnostic.code === "parse_error")).toBe(true);
    const draft = await parseSourceFilesToCodeSemanticGraph(files, { allowParseErrors: true });
    expect(draft.ok).toBe(true);
  });

  test("accepts normalized Swift AST JSON with named syntax fields", () => {
    const graph = buildCodeSemanticGraphFromAstJson({
      files: [
        {
          path: "Sources/main.swift",
          root: "root",
          nodes: [
            { id: "root", kind: "source_file", children: [{ id: "fn" }] },
            { id: "fn", kind: "function_declaration", children: [{ id: "name", field: "name" }] },
            { id: "name", kind: "simple_identifier", text: "run" }
          ]
        }
      ]
    });
    expect(graph.ok).toBe(true);
    if (graph.ok) expect(graph.value.functions[0]?.sourceRef).toBe("Sources/main.swift#run()");
  });

  test("keeps constrained and protocol-default members distinct and warns on ambiguous branches", async () => {
    const graph = await graphFor(`protocol Store { func run() }
      extension Store { func run() {} }
      extension Store where Self: Equatable { func run() {} }`);
    expect(new Set(graph.functions.map((fn) => fn.sourceRef)).size).toBe(3);
    expect(new Set(graph.functions.map((fn) => fn.name)).size).toBe(3);
    expect(graph.diagnostics).toEqual([]);
    const branches = await graphFor(`#if os(Linux)
      func run() {}
      #else
      func run() {}
      #endif`);
    expect(branches.functions).toHaveLength(2);
    expect(branches.functions.every((fn) => fn.sourceRef === "Sources/App.swift")).toBe(true);
    expect(
      branches.diagnostics.every((diagnostic) => diagnostic.code === "ambiguous_swift_symbol")
    ).toBe(true);
    expect(branches.diagnostics).toHaveLength(2);
  });
});

describe("Swift semantic fingerprints", () => {
  for (const [name, before, after] of [
    ["URL contents", '"https://one.example"', '"https://two.example"'],
    ["Unicode contents", '"🦧"', '"🐕"'],
    ["raw strings", '#"https://one.example"#', '#"https://two.example"#'],
    ["multiline strings", '"""\nhello\n"""', '"""\nworld\n"""'],
    ["interpolation", '"value \\(1)"', '"value \\(2)"']
  ]) {
    test(`detects changes to ${name}`, async () => {
      const base = fingerprints(await graphFor(`func text() -> String { ${before} }`));
      const changed = fingerprints(await graphFor(`func text() -> String { ${after} }`));
      expect(Object.keys(base)).toEqual(Object.keys(changed));
      expect(Object.values(base)[0]).toMatch(/^sha256:/);
      expect(Object.values(changed)[0]).not.toBe(Object.values(base)[0]);
    });
  }

  test("ignores comments and formatting and keeps declaration shells independent of method bodies", async () => {
    const base = await graphFor('struct Store { func text() -> String { "hello" } }');
    const cosmetic = await graphFor(
      '\nstruct Store {\n/* outer /* nested */ comment */\nfunc text() -> String {\n"hello"\n}\n}'
    );
    expect(fingerprints(cosmetic)).toEqual(fingerprints(base));
    const changed = await graphFor('struct Store { func text() -> String { "world" } }');
    const shell = (graph: CodeSemanticGraph) =>
      graph.anchors.find((anchor) => anchor.targetKind === "component")?.fingerprint;
    expect(shell(changed)).toEqual(shell(base));
    expect(fingerprints(changed)).not.toEqual(fingerprints(base));
  });

  test("preserves extension anchor identity across body edits and declaration movement", async () => {
    const base = await graphFor(
      'struct Store {}\nextension Store { func run() { print("hello") } }'
    );
    const moved = await graphFor(
      'extension Store { func run() { print("world") } }\nstruct Store {}'
    );
    const shells = (graph: CodeSemanticGraph) =>
      graph.anchors
        .filter((anchor) => anchor.targetKind === "component")
        .map((anchor) => [anchor.name, anchor.sourceRef, anchor.fingerprint?.value])
        .sort();
    expect(shells(moved)).toEqual(shells(base));
    expect(fingerprints(moved)).not.toEqual(fingerprints(base));
  });
});
