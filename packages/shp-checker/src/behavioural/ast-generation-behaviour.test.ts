// #65 — AST-generation determinism + unknown-safety law.
//
// Vision anchors:
//   - shape/tooling.shape:545 memory AstGenerationUnknownSafety: AST-derived
//     architecture drafts "must preserve uncertainty with effects unknown ...
//     and keep raw syntax traces opt-in."
//   - shape/tooling.shape:565 memory AuthoringUnknownSafety: generated drafts
//     "must prefer effects unknown over false empty complete summaries."
//   - docs-site/src/content/docs/reference/diagnostics.md:139-143 (Unknown
//     effects): generated AST candidate files keep `effects unknown` because
//     their `effect candidate` declarations are evidence hints, not reviewed
//     effect summaries.
//
// Each invariant is a SEPARATE test. The exact output forms (the absence of any
// `effects complete { }`, the raw-layer markers, the byte-identity of repeated
// generation, the module/path normalisation) were derived by running a
// throwaway scratch against the real API (generateShapeFromAstJson,
// normalizeGeneratedModuleName, normalizeGeneratedAstPath), then the scratch was
// deleted. Determinism is proven by generating from INDEPENDENT inputs and
// comparing the products, never by comparing one value to itself. Two in-test
// negative controls (a stub that emits empty `effects complete { }`, and a stub
// whose member order flips on the second call) prove the unknown-safety and
// byte-identity predicates can fail.

import { describe, expect, test } from "bun:test";
import {
  generateShapeFromAstJson,
  normalizeGeneratedAstPath,
  normalizeGeneratedModuleName,
  type GeneratedShapeOutput
} from "../ast-generation.ts";
import type { AstGenerationResult } from "../ast-generation-types.ts";
import { parseShapeModule } from "../parser.ts";
import { lockedIntended, characterization } from "./harness.ts";

// ---------------------------------------------------------------------------
// Fixtures: AST JSON inputs in the shape buildCodeSemanticGraphFromAstJson
// accepts (mirrors the helpers in checker.test.ts / index.test.ts). Neither
// fixture carries any call/effect evidence the projector could turn into an
// `effects complete` summary, so the unknown-safety law has real teeth: the
// generator KNOWS the effects are not derivable, yet must still emit a function.
// ---------------------------------------------------------------------------

const tsFixture = {
  language: "typescript",
  files: [
    {
      path: "src/audit/store.ts",
      root: "root",
      nodes: [
        { id: "root", kind: "program", children: ["store"] },
        {
          id: "store",
          kind: "class_declaration",
          attributes: { name: "AuditStore" },
          text: "class AuditStore { appendEvent() {} }",
          children: ["append"]
        },
        {
          id: "append",
          kind: "method_definition",
          attributes: { name: "appendEvent" },
          text: "appendEvent() {}"
        }
      ]
    }
  ]
} as const;

const rustFixture = {
  language: "rust",
  files: [
    {
      path: "src/main.rs",
      root: "root",
      nodes: [
        { id: "root", kind: "source_file", children: ["main"] },
        {
          id: "main",
          kind: "function_item",
          attributes: { name: "main" },
          text: "fn main() {}"
        }
      ]
    }
  ]
} as const;

// The exact textual form a unknown-safety violation would take, derived from
// the language reference (diagnostics.md:131 shows `effects complete {`). The
// regex is whitespace-robust: it matches an EMPTY complete block however the
// formatter spaces the braces. It does NOT match a non-empty complete block.
const EMPTY_COMPLETE = /effects complete\s*\{\s*\}/;

/** Narrow a generation result to its value or fail with the diagnostics. */
function requireGenerated(result: AstGenerationResult<GeneratedShapeOutput>): GeneratedShapeOutput {
  if (!result.ok) {
    throw new Error(
      `expected generation to succeed but got:\n${result.diagnostics
        .map((diagnostic) => `  ${diagnostic.code}: ${diagnostic.message}`)
        .join("\n")}`
    );
  }
  return result.value;
}

/** Drop the leading `module <name>` line so two outputs can be compared body-to-body. */
function bodyWithoutModuleLine(shape: string): string {
  return shape.split("\n").slice(1).join("\n");
}

describe("#65 AST-generation determinism + unknown-safety", () => {
  test(
    lockedIntended(
      "generated semantic Shape emits `effects unknown`, never an empty `effects complete { }`",
      "shape/tooling.shape:545 AstGenerationUnknownSafety; :565 AuthoringUnknownSafety; diagnostics.md:139-143"
    ),
    () => {
      const output = requireGenerated(
        generateShapeFromAstJson(tsFixture, { moduleName: "generated.audit" })
      );

      // Non-vacuous: the fixture really produced a function declaration (so this
      // is not "no functions, therefore no empty-complete" — the law applies to
      // a function whose effects are NOT derivable from the AST).
      expect(output.semanticShape).toContain("component AuditStore");
      expect(output.semanticShape).toContain("fn appendEvent");

      // The law, two ways. Positive: uncertainty is preserved as `effects unknown`.
      expect(output.semanticShape).toContain("effects unknown");
      // Negative: no empty complete summary is fabricated, in ANY whitespacing.
      expect(EMPTY_COMPLETE.test(output.semanticShape)).toBe(false);
      // Strongest form: with no derivable effects the generator emits no
      // `effects complete` token at all.
      expect(output.semanticShape).not.toContain("effects complete");

      // Derivable structural property: the generated draft is itself valid Shape
      // (so `effects unknown` is the real declaration, not a comment or string).
      const parsed = parseShapeModule(output.semanticShape, "generated.audit.shape");
      expect(parsed.ok).toBe(true);
    }
  );

  test(
    lockedIntended(
      "raw syntax layer is OPT-IN: absent by default, present only when requested",
      "shape/tooling.shape:545 AstGenerationUnknownSafety (keep raw syntax traces opt-in)"
    ),
    () => {
      // Default: no raw layer anywhere. The raw layer is identified by the
      // `GeneratedAstNode` trait + `ast_child` relation kind it always emits
      // (derived via scratch); their absence is the opt-in default.
      const byDefault = requireGenerated(
        generateShapeFromAstJson(tsFixture, { moduleName: "generated.audit" })
      );
      expect(byDefault.rawShape).toBeUndefined();
      expect(byDefault.semanticShape).not.toContain("GeneratedAstNode");
      expect(byDefault.semanticShape).not.toContain("kind ast_child");

      // Opt-in #1 — `includeAstLayer` embeds the raw layer INTO the semantic
      // shape. The opt-in adds the layer; it must NOT relax unknown-safety.
      const embedded = requireGenerated(
        generateShapeFromAstJson(tsFixture, {
          moduleName: "generated.audit",
          includeAstLayer: true
        })
      );
      expect(embedded.semanticShape).toContain("GeneratedAstNode");
      expect(embedded.semanticShape).toContain("kind ast_child");
      expect(embedded.semanticShape).toContain("effects unknown");
      expect(EMPTY_COMPLETE.test(embedded.semanticShape)).toBe(false);

      // Opt-in #2 — `rawModuleName` produces a SEPARATE raw Shape sidecar while
      // leaving the semantic shape free of the raw layer.
      const sidecar = requireGenerated(
        generateShapeFromAstJson(tsFixture, {
          moduleName: "generated.audit",
          rawModuleName: "generated.audit.raw"
        })
      );
      expect(sidecar.rawShape).toBeDefined();
      expect(sidecar.rawShape ?? "").toContain("GeneratedAstNode");
      expect(sidecar.rawShape ?? "").toContain("kind ast_child");
      // Sidecar keeps the semantic layer clean (separation of concerns).
      expect(sidecar.semanticShape).not.toContain("GeneratedAstNode");

      // NEGATIVE CONTROL for the detector itself: prove the `GeneratedAstNode`
      // marker genuinely discriminates layered from non-layered output, rather
      // than being present unconditionally (which would make the default-absence
      // assertion above vacuous).
      expect(byDefault.semanticShape.includes("GeneratedAstNode")).toBe(false);
      expect(embedded.semanticShape.includes("GeneratedAstNode")).toBe(true);
    }
  );

  test(
    lockedIntended(
      "cross-run byte-identity: identical AST input yields byte-identical semantic + raw output, across two languages",
      "shape/tooling.shape:615 AstGenerationDraftSafetyRechecked (deterministic fingerprints); determinism intent"
    ),
    () => {
      // Determinism is checked over INDEPENDENT generations. We pass the same
      // module name on both runs (the realistic regeneration scenario) so the
      // first `module ...` line is included in the byte comparison too.
      for (const [language, fixture, moduleName, rawModuleName] of [
        ["typescript", tsFixture, "generated.audit", "generated.audit.raw"],
        ["rust", rustFixture, "generated.main", "generated.main.raw"]
      ] as const) {
        const first = requireGenerated(
          generateShapeFromAstJson(fixture, { moduleName, rawModuleName })
        );
        const second = requireGenerated(
          generateShapeFromAstJson(fixture, { moduleName, rawModuleName })
        );

        // Non-trivial: the output is substantial, not an empty/error fallback.
        expect(first.semanticShape.length, `${language} semantic empty`).toBeGreaterThan(0);
        expect((first.rawShape ?? "").length, `${language} raw empty`).toBeGreaterThan(0);

        // The law: both layers are byte-identical across the two runs.
        expect(second.semanticShape, `${language} semantic not byte-identical`).toBe(
          first.semanticShape
        );
        expect(second.rawShape, `${language} raw not byte-identical`).toBe(first.rawShape);
      }
    }
  );

  test(
    lockedIntended(
      "module-name placeholder is the ONLY cross-run difference: the body is byte-identical under different module names",
      "shape/tooling.shape:545 AstGenerationUnknownSafety + :579 generated AST source identity derived from workspace root"
    ),
    () => {
      // Stronger, non-circular determinism: feed the SAME AST under two
      // DIFFERENT module names. Everything below the `module` line — anchors,
      // components, relations, fingerprints — must be byte-identical, proving
      // the body is a pure function of the AST, not of the chosen module name.
      const alpha = requireGenerated(
        generateShapeFromAstJson(tsFixture, {
          moduleName: "alpha.one",
          rawModuleName: "alpha.one.raw"
        })
      );
      const beta = requireGenerated(
        generateShapeFromAstJson(tsFixture, {
          moduleName: "beta.two",
          rawModuleName: "beta.two.raw"
        })
      );

      // Guard: the module lines really differ (so equal bodies is a property of
      // the generator, not of identical inputs).
      expect(alpha.semanticShape.split("\n")[0]).toBe("module alpha.one");
      expect(beta.semanticShape.split("\n")[0]).toBe("module beta.two");
      expect(alpha.semanticShape).not.toBe(beta.semanticShape);

      expect(bodyWithoutModuleLine(beta.semanticShape)).toBe(
        bodyWithoutModuleLine(alpha.semanticShape)
      );
      expect(bodyWithoutModuleLine(beta.rawShape ?? "")).toBe(
        bodyWithoutModuleLine(alpha.rawShape ?? "")
      );
    }
  );

  test(
    lockedIntended(
      "module-identity stability: same source yields the same generated identity for absolute vs relative vs ./-prefixed paths",
      "shape/tooling.shape:579 CliCommandDispatchOrder (generated AST source identity derived from workspace root); mirrors index.test.ts:341-388"
    ),
    () => {
      // Library-level mirror of the CLI determinism test (index.test.ts:341-388),
      // which exercises this through `ast source` with absolute vs nested-cwd
      // relative paths. Here we exercise the two normalisers directly.
      const cwd = "/repo";
      const absolute = `${cwd}/src/audit/store.ts`;
      const relative = "src/audit/store.ts";
      const dotRelative = "./src/audit/store.ts";

      const fromAbsolute = normalizeGeneratedAstPath(absolute, cwd);
      const fromRelative = normalizeGeneratedAstPath(relative, cwd);
      const fromDot = normalizeGeneratedAstPath(dotRelative, cwd);

      // Guard: the three inputs are genuinely distinct strings.
      expect(new Set([absolute, relative, dotRelative]).size).toBe(3);

      // The law: all three normalise to one repo-relative identity.
      expect(fromAbsolute).toBe("src/audit/store.ts");
      expect(fromRelative).toBe(fromAbsolute);
      expect(fromDot).toBe(fromAbsolute);

      // NEGATIVE CONTROL: the normaliser is not a constant function — a path
      // OUTSIDE the cwd produces a different identity (so equality above is a
      // real collapse of equivalent inputs, not "everything maps to one value").
      const elsewhere = normalizeGeneratedAstPath("/other/lib/util.ts", cwd);
      expect(elsewhere).not.toBe(fromAbsolute);

      // Module-name normalisation is idempotent: normalising a generated module
      // identity again is a fixpoint, so the identity is stable across rounds.
      const moduleName = normalizeGeneratedModuleName("generated.audit.store");
      expect(normalizeGeneratedModuleName(moduleName)).toBe(moduleName);
    }
  );

  test(
    characterization(
      "the generated TS draft pins exactly two anchors and one function, asserted as derivable counts (not an opaque blob)",
      {
        reason:
          "the precise anchor/relation set is current generator behaviour, not a ratified law; pinned as derivable counts/identities so a reviewer can adjudicate the regen.",
        followUp:
          "promote to lockedIntended if/when the anchor projection is ratified in shape/tooling.shape"
      }
    ),
    () => {
      // Per the standard: do NOT pin an opaque multi-line snapshot. Instead pin
      // DERIVABLE properties of the generated draft (counts + identities) so any
      // regression is legible. These were read off the real scratch output.
      const output = requireGenerated(
        generateShapeFromAstJson(tsFixture, { moduleName: "generated.audit" })
      );
      const shape = output.semanticShape;

      const count = (needle: string): number => shape.split(needle).length - 1;

      // One component, one function, one conformance.
      expect(count("component AuditStore : GeneratedCandidate")).toBe(1);
      expect(count("fn appendEvent")).toBe(1);
      expect(count("conforms_to AuditStore")).toBe(1);

      // Exactly two AST anchors (one for the class, one for the method) — each a
      // GeneratedAstAnchor RESOURCE with a sha256 semantic fingerprint. The
      // needle targets the resource form (`: GeneratedAstAnchor {`) so the
      // `trait GeneratedAstAnchor {` declaration is not miscounted.
      expect(count(": GeneratedAstAnchor {")).toBe(2);
      const fingerprints = [
        ...shape.matchAll(/fingerprint ast\.semantic_subtree_v1\("(sha256:[0-9a-f]{64})"\)/g)
      ].map((match) => match[1]);
      // Two distinct resource fingerprints, each re-asserted by its
      // `generated_from` relation's `expects` (so the count is 4 occurrences,
      // 2 distinct values).
      expect(fingerprints.length).toBe(4);
      expect(new Set(fingerprints).size).toBe(2);

      // Exactly two `generated_from` relations (component<-anchor, fn<-anchor).
      expect(count("kind generated_from")).toBe(2);
    }
  );

  // NEGATIVE CONTROL — proves the unknown-safety and byte-identity PREDICATES
  // used above can actually fail. Self-contained: local stubs stand in for a
  // mis-implemented generator, so this test fails iff the predicates are real.
  test(
    lockedIntended(
      "the unknown-safety and byte-identity predicates reject a violating stub generator",
      "epic #53 standard: every area ships an in-test negative control"
    ),
    () => {
      // (1) Unknown-safety predicate vs a stub that emits an EMPTY complete block.
      const violatingDraft = [
        "module bad",
        "",
        "component C {",
        "  fn f",
        "    effects complete {",
        "    }",
        "}"
      ].join("\n");
      // The real generator's output passes the predicate; the stub's fails it.
      const goodDraft = requireGenerated(
        generateShapeFromAstJson(tsFixture, { moduleName: "generated.audit" })
      ).semanticShape;
      expect(EMPTY_COMPLETE.test(goodDraft)).toBe(false);
      expect(EMPTY_COMPLETE.test(violatingDraft)).toBe(true);

      // (2) Byte-identity predicate vs a stub whose member order FLIPS on the
      // second call (a classic nondeterminism bug). The predicate must catch it.
      const members = ["resource A", "resource B", "resource C"];
      let call = 0;
      const nondeterministicGenerate = (): string => {
        call += 1;
        const ordered = call % 2 === 0 ? [...members].reverse() : members;
        return ["module flaky", "", ...ordered].join("\n");
      };
      const firstRun = nondeterministicGenerate();
      const secondRun = nondeterministicGenerate();
      // The stub is genuinely producing both orderings (not empty/constant).
      expect(firstRun).toContain("resource A");
      expect(secondRun).toContain("resource C");
      // Byte-identity FAILS for the flaky stub...
      expect(secondRun).not.toBe(firstRun);
      // ...while it HOLDS for the real generator over independent runs.
      const realFirst = requireGenerated(
        generateShapeFromAstJson(tsFixture, { moduleName: "generated.audit" })
      ).semanticShape;
      const realSecond = requireGenerated(
        generateShapeFromAstJson(tsFixture, { moduleName: "generated.audit" })
      ).semanticShape;
      expect(realSecond).toBe(realFirst);
    }
  );
});
