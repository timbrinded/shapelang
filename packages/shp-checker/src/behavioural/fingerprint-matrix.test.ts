// #57 — Semantic AST fingerprint SENSITIVITY and SPECIFICITY.
//
// A generated AST anchor carries a semantic fingerprint so a reviewed Shape
// claim can pin "this is the code I reviewed" and CI can detect drift. That
// guarantee has two halves, and a fingerprint that only satisfies one is a
// liability:
//
//   SENSITIVITY  — a meaningful code change (a new parameter, a different
//                  return type, a different write/effect target, a changed
//                  declaration-shell member) MUST change the fingerprint, or a
//                  stale pin silently keeps passing and the "Stale Fingerprint
//                  Expectation" diagnostic never fires.
//   SPECIFICITY  — a cosmetic change (whitespace, comments, CRLF, an edit to
//                  UNRELATED code in the same file, a re-parsed node id/span)
//                  MUST NOT change the fingerprint, or every reformat churns
//                  every pin and review fatigue trains reviewers to rubber-stamp
//                  regenerated fingerprints.
//
// Every row drives BOTH the base and the variant from real source through the
// AST-generation pipeline (buildCodeSemanticGraphFromAstJson) and compares the
// resulting fingerprint VALUES. No literal hash is pinned: equality/inequality
// between two independently computed fingerprints is the assertion, so a
// determinism/discrimination claim always rests on a genuinely different AST
// input, never a value re-hashed against itself.
//
// Anchors:
//   shape/tooling.shape:545 memory AstGenerationUnknownSafety — "compact syntax
//     anchors with semantic fingerprints when token evidence exists".
//   docs-site/src/content/docs/reference/diagnostics.md:96 "Stale Fingerprint
//     Expectation" — the diagnostic this sensitivity is the precondition for.

import { describe, expect, test } from "bun:test";
import {
  buildCodeSemanticGraphFromAstJson,
  type CodeSemanticGraph
} from "../ast-generation-core.ts";
import type { SourceSpan } from "../ast-generation-types.ts";
import { characterization, lockedIntended } from "./harness.ts";

const TOOLING_ANCHOR =
  "shape/tooling.shape:545 memory AstGenerationUnknownSafety (semantic fingerprints)";
const DIAGNOSTICS_ANCHOR =
  "docs-site/src/content/docs/reference/diagnostics.md:96 Stale Fingerprint Expectation";

// --- Self-contained AST builders -------------------------------------------
// Replicated from checker.test.ts so this file owns the inputs it fingerprints
// (the standard forbids feeding a detector input rigged elsewhere). Each builder
// emits AST JSON in the shape buildCodeSemanticGraphFromAstJson consumes.

function span(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): SourceSpan {
  return { startLine, startColumn, endLine, endColumn };
}

type FunctionAstInput = {
  text: string;
  path?: string;
  nodeId?: string;
  functionName?: string;
  span?: SourceSpan;
};

/** A single Rust function in a file; anchor target is `MainModule.<name>`. */
function functionAst(input: string | FunctionAstInput): unknown {
  const normalized = typeof input === "string" ? { text: input } : input;
  return multiFunctionAst(normalized.text, undefined, normalized);
}

/** A `main` function plus an optional sibling `helper` in the SAME file. */
function multiFunctionAst(
  mainText: string,
  helperText?: string,
  input: Partial<FunctionAstInput> = {}
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

type ComponentShellAstInput = {
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

/**
 * A TypeScript class with a field and a method. Produces a `component` anchor
 * (`AuditStore`, declaration-shell mode) and an `fn` anchor
 * (`AuditStore.appendEvent`, function-subtree mode) from the SAME source.
 */
function componentShellAst(input: ComponentShellAstInput = {}): unknown {
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
          { id: "root", kind: "program", children: [typeNodeId] },
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

type ResourceShellAstInput = {
  fieldText?: string;
  extraFieldText?: string;
};

/** A Rust struct; produces a `resource` anchor (`AuditEvent`, shell mode). */
function resourceShellAst(input: ResourceShellAstInput = {}): unknown {
  const fieldText = input.fieldText ?? "id: String,";
  const children = input.extraFieldText ? ["eventId", "actor"] : ["eventId"];
  return {
    language: "rust",
    files: [
      {
        path: "src/audit/event.rs",
        root: "root",
        nodes: [
          { id: "root", kind: "source_file", children: ["event"] },
          {
            id: "event",
            kind: "struct_item",
            attributes: { name: "AuditEvent" },
            text: `struct AuditEvent {\n  ${fieldText}${
              input.extraFieldText ? `\n  ${input.extraFieldText}` : ""
            }\n}`,
            children
          },
          { id: "eventId", kind: "field_declaration", text: fieldText },
          ...(input.extraFieldText
            ? [{ id: "actor", kind: "field_declaration", text: input.extraFieldText }]
            : [])
        ]
      }
    ]
  };
}

// --- Pipeline helpers -------------------------------------------------------

function graphOf(ast: unknown): CodeSemanticGraph {
  const result = buildCodeSemanticGraphFromAstJson(ast);
  if (!result.ok) {
    throw new Error(
      `expected AST JSON to build a graph but got:\n${result.diagnostics
        .map((diagnostic) => `  ${diagnostic.message}`)
        .join("\n")}`
    );
  }
  return result.value;
}

/**
 * The REAL fingerprint API under test: build the semantic graph from source and
 * read the anchor's `ast.semantic_subtree_v1` fingerprint value. Throws (rather
 * than returning a sentinel) if the anchor or its fingerprint is missing, so a
 * row can never silently pass on an absent value.
 */
function fingerprintOf(ast: unknown, target: string): string {
  const graph = graphOf(ast);
  const anchor = graph.anchors.find((candidate) => candidate.target === target);
  if (!anchor) {
    throw new Error(
      `no AST anchor for ${target}; saw [${graph.anchors
        .map((candidate) => candidate.target)
        .join(", ")}]`
    );
  }
  if (!anchor.fingerprint) {
    throw new Error(`AST anchor ${target} has no fingerprint`);
  }
  return anchor.fingerprint.value;
}

// The targetKind drives the canonicaliser mode in ast-generation-fingerprints.ts
// (fn -> function_subtree, otherwise declaration_shell). Asserting it makes the
// "which mode am I testing" claim explicit rather than implied by the target
// string shape.
function targetKindOf(ast: unknown, target: string): string {
  const anchor = graphOf(ast).anchors.find((candidate) => candidate.target === target);
  if (!anchor) {
    throw new Error(`no AST anchor for ${target}`);
  }
  return anchor.targetKind;
}

describe("#57 fingerprint SENSITIVITY (function-subtree mode)", () => {
  const BASE_FN = "fn main(input: u32) -> u32 { input + 1 }";
  const baseFingerprint = fingerprintOf(functionAst(BASE_FN), "MainModule.main");

  // Each row is a semantic mutation that a reviewer would want to re-review.
  // The fingerprint MUST differ from the base for the stale-pin diagnostic to
  // be reachable at all.
  const sensitive: { label: string; mutated: string }[] = [
    { label: "add a parameter", mutated: "fn main(input: u32, actor: u32) -> u32 { input + 1 }" },
    { label: "change a parameter type", mutated: "fn main(input: u64) -> u32 { input + 1 }" },
    { label: "change the return type", mutated: "fn main(input: u32) -> i64 { input + 1 }" },
    { label: "change the body operator", mutated: "fn main(input: u32) -> u32 { input - 1 }" }
  ];

  test(
    lockedIntended(
      "fn anchor uses function_subtree mode (precondition for body-sensitivity)",
      TOOLING_ANCHOR
    ),
    () => {
      expect(targetKindOf(functionAst(BASE_FN), "MainModule.main")).toBe("fn");
    }
  );

  for (const row of sensitive) {
    test(
      lockedIntended(`meaningful change differs the fingerprint: ${row.label}`, TOOLING_ANCHOR),
      () => {
        const mutatedFingerprint = fingerprintOf(functionAst(row.mutated), "MainModule.main");
        // Both values are computed from distinct real source through the same
        // pipeline; inequality therefore reflects an AST difference, not a
        // re-hash of one value.
        expect(mutatedFingerprint).not.toBe(baseFingerprint);
      }
    );
  }
});

describe("#57 fingerprint SPECIFICITY / INSENSITIVITY (function-subtree mode)", () => {
  const BASE_FN = "fn main(input: u32) -> u32 { input + 1 }";
  const baseFingerprint = fingerprintOf(functionAst(BASE_FN), "MainModule.main");

  // Each row is a cosmetic change that MUST NOT churn the pin.
  const insensitive: { label: string; variant: unknown }[] = [
    {
      label: "reformatting whitespace only",
      variant: functionAst("fn   main ( input : u32 )   ->   u32 {   input + 1   }")
    },
    {
      label: "adding comments only",
      variant: functionAst("fn main(input: u32) -> u32 { /* explain */ input + 1 // keep\n }")
    },
    {
      label: "re-parsed node id, span, path only",
      variant: functionAst({
        text: BASE_FN,
        path: "crates/app/main.rs",
        nodeId: "renumbered_main",
        span: span(40, 3, 44, 4)
      })
    }
  ];

  for (const row of insensitive) {
    test(
      lockedIntended(
        `cosmetic change keeps the fingerprint identical: ${row.label}`,
        TOOLING_ANCHOR
      ),
      () => {
        expect(fingerprintOf(row.variant, "MainModule.main")).toBe(baseFingerprint);
      }
    );
  }

  test(
    lockedIntended(
      "CRLF vs LF inside a string literal keeps the fingerprint identical",
      TOOLING_ANCHOR
    ),
    () => {
      const lf = fingerprintOf(functionAst('fn main() { let t = "a\nb"; }'), "MainModule.main");
      const crlf = fingerprintOf(functionAst('fn main() { let t = "a\r\nb"; }'), "MainModule.main");
      expect(crlf).toBe(lf);
    }
  );

  test(
    lockedIntended(
      "editing UNRELATED code in the same file does not churn a pinned function",
      DIAGNOSTICS_ANCHOR
    ),
    () => {
      // A pin on `main` must survive an edit to its sibling `helper`: otherwise
      // every unrelated change in a file would re-stale every pin in it.
      const base = multiFunctionAst("fn main() { let x = 1; }", "fn helper() {}");
      const siblingEdited = multiFunctionAst(
        "fn main() { let x = 1; }",
        "fn helper() { let y = 2; }"
      );
      // The pinned function is untouched...
      expect(fingerprintOf(siblingEdited, "MainModule.main")).toBe(
        fingerprintOf(base, "MainModule.main")
      );
      // ...while the edited sibling's own fingerprint does move (control on the
      // negative case, proving the "unchanged" result above is not because the
      // whole file is inert).
      expect(fingerprintOf(siblingEdited, "MainModule.helper")).not.toBe(
        fingerprintOf(base, "MainModule.helper")
      );
    }
  );
});

describe("#57 fingerprint declaration-shell mode (component + resource)", () => {
  const componentBase = componentShellAst();
  const shellFingerprint = fingerprintOf(componentBase, "AuditStore");
  const nestedFnFingerprint = fingerprintOf(componentBase, "AuditStore.appendEvent");

  test(
    lockedIntended(
      "component anchor uses declaration_shell mode; nested fn uses function_subtree",
      TOOLING_ANCHOR
    ),
    () => {
      expect(targetKindOf(componentBase, "AuditStore")).toBe("component");
      expect(targetKindOf(componentBase, "AuditStore.appendEvent")).toBe("fn");
    }
  );

  test(
    lockedIntended("shell pins the member signature, not the nested function body", TOOLING_ANCHOR),
    () => {
      // Changing ONLY the method body: the shell (signature view) must hold,
      // and the nested function's own subtree fingerprint must move.
      const bodyChanged = componentShellAst({
        methodText: "appendEvent(event: AuditEvent) {\n  this.repo.archive(event);\n}"
      });
      expect(fingerprintOf(bodyChanged, "AuditStore")).toBe(shellFingerprint);
      expect(fingerprintOf(bodyChanged, "AuditStore.appendEvent")).not.toBe(nestedFnFingerprint);
    }
  );

  test(
    lockedIntended(
      "shell fingerprint changes when a member signature changes (write/effect target)",
      TOOLING_ANCHOR
    ),
    () => {
      // Adding a parameter to a member is a signature change: it alters the
      // declaration shell, and also the nested function subtree.
      const signatureChanged = componentShellAst({
        methodText: "appendEvent(event: AuditEvent, actor: Actor) {\n  this.repo.insert(event);\n}"
      });
      expect(fingerprintOf(signatureChanged, "AuditStore")).not.toBe(shellFingerprint);
      expect(fingerprintOf(signatureChanged, "AuditStore.appendEvent")).not.toBe(
        nestedFnFingerprint
      );
    }
  );

  test(
    lockedIntended("shell fingerprint changes when a declared field changes", TOOLING_ANCHOR),
    () => {
      // A field is part of the shell but not the method body: it must move the
      // shell while leaving the nested function fingerprint untouched.
      const fieldChanged = componentShellAst({ fieldText: "repo: DurableAuditRepo;" });
      expect(fingerprintOf(fieldChanged, "AuditStore")).not.toBe(shellFingerprint);
      expect(fingerprintOf(fieldChanged, "AuditStore.appendEvent")).toBe(nestedFnFingerprint);
    }
  );

  test(
    lockedIntended(
      "resource shell fingerprint changes on field type change and field addition",
      TOOLING_ANCHOR
    ),
    () => {
      const resourceBase = fingerprintOf(resourceShellAst(), "AuditEvent");
      expect(targetKindOf(resourceShellAst(), "AuditEvent")).toBe("resource");
      // Changing a field's declared type re-shapes the resource the model pins.
      expect(fingerprintOf(resourceShellAst({ fieldText: "id: EventId," }), "AuditEvent")).not.toBe(
        resourceBase
      );
      // Adding a field is a schema change a reviewer must see.
      expect(
        fingerprintOf(resourceShellAst({ extraFieldText: "actor: String," }), "AuditEvent")
      ).not.toBe(resourceBase);
    }
  );

  // CHARACTERIZATION — the only place a literal hash is asserted. We pin a
  // single recomputed value to prove the provider/format is the documented one
  // (sha256-prefixed under ast.semantic_subtree_v1), not to ratify the exact
  // digest as a vision guarantee.
  test(
    characterization("the fingerprint provider and digest format are sha256 under v1", {
      reason:
        "exact hash is an implementation value, not a vision guarantee; regenerate if the canonicaliser changes",
      followUp: "#57"
    }),
    () => {
      const graph = graphOf(componentBase);
      const anchor = graph.anchors.find((candidate) => candidate.target === "AuditStore");
      expect(anchor?.fingerprint?.provider).toBe("ast.semantic_subtree_v1");
      // Format check only (prefix + 64 hex chars), no literal digest pinned.
      expect(anchor?.fingerprint?.value).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  );
});

describe("#57 NEGATIVE CONTROL: a non-discriminating fingerprint is caught", () => {
  // A planted mutant: a fingerprint that ignores its input and returns a fixed
  // string. This is exactly the failure the SENSITIVITY rows exist to catch — a
  // hash that never moves would let stale pins pass forever. We prove the rows
  // would FAIL against it, in-test, without mutating any shared product source.
  const CONSTANT_STUB = (_ast: unknown): string =>
    "sha256:0000000000000000000000000000000000000000000000000000000000000000";

  const BASE_FN = "fn main(input: u32) -> u32 { input + 1 }";
  const sensitiveMutations = [
    "fn main(input: u32, actor: u32) -> u32 { input + 1 }", // add a parameter
    "fn main(input: u64) -> u32 { input + 1 }", // change a parameter type
    "fn main(input: u32) -> i64 { input + 1 }" // change the return type
  ];

  test(
    lockedIntended(
      "the real fingerprint discriminates every mutation the stub cannot",
      TOOLING_ANCHOR
    ),
    () => {
      const realBase = fingerprintOf(functionAst(BASE_FN), "MainModule.main");
      for (const mutated of sensitiveMutations) {
        const realMutated = fingerprintOf(functionAst(mutated), "MainModule.main");
        // What the SENSITIVITY rows assert against the real API: PASSES.
        expect(realMutated).not.toBe(realBase);

        // Run the SAME row's predicate against the constant stub. The stub
        // collapses base and mutated to one value, so the sensitivity assertion
        // (`not.toBe`) is necessarily violated — i.e. the rows above would FAIL
        // if the fingerprint stopped discriminating. We assert the collapse
        // directly so this control itself stays green while documenting the
        // exact failure mode it guards.
        const stubBase = CONSTANT_STUB(functionAst(BASE_FN));
        const stubMutated = CONSTANT_STUB(functionAst(mutated));
        expect(stubMutated).toBe(stubBase);
        expect(() => expect(stubMutated).not.toBe(stubBase)).toThrow();
      }
    }
  );
});
