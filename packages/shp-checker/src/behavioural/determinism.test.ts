// #55 — Determinism + the no-clock-in-checker law.
//
// Vision anchors:
//   - docs-site/src/content/docs/inside-shape/checker-pipeline.md: "The same
//     `.shape` files and check options produce the same lowered model, facts,
//     and diagnostics."
//   - shape/checker.shape memories FinalForbidPrecedence and HypercycleWitness
//     require deterministic target resolution and a deterministic witness path.
//   - shape/tooling.shape memory ClockReadAtCliBoundary: the clock is read only
//     at the CLI boundary; the library checker reads no wall clock (no
//     Date.now / new Date in checker.ts).
//
// Each invariant is a SEPARATE test. The clock invariant carries an in-test
// negative control (clockStamp) proving the two-clock harness can catch a
// clock-dependent function, so it is not a value-compared-to-itself tautology.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkShapeModules,
  explainShapeModules,
  formatDiagnostics,
  graphAllShapeModules,
  listMemoryGuardsShapeModules,
  listShapeObligations,
  statsShapeHypergraph
} from "../index.ts";
import {
  characterization,
  checkSource,
  diagnosticKinds,
  lockedIntended,
  parseModuleOrThrow,
  render,
  requireDiagnostic,
  shouldBe
} from "./harness.ts";

const repoRoot = resolve(import.meta.dir, "../../../..");

// A representative model exercising the surfaces that must be deterministic:
//  - a RefactorSensitive fn under a RefactorConstraint memory guard;
//  - a `change` that modifies the guarded fn WITHOUT a reevaluation, so the
//    checker emits a `guarded_shape_changed` obligation (non-trivial output);
//  - a top-level `calls` relation, so the hypergraph / stats / explain surfaces
//    have an edge to render;
//  - two resources that no relation touches, so stats reports isolated
//    vertices;
//  - a second component (Audit) whose RefactorSensitive fn has no memory and
//    `effects unknown`, adding two more diagnostics anchored to a DIFFERENT
//    declaration — so the permutation test exercises multi-diagnostic ordering
//    rather than passing vacuously on a single-diagnostic model.
// Built inline rather than from a shared fixture so the
// declaration-order-permutation test can reorder these exact declarations.
const DECLARATIONS = {
  resourceLedger: "resource Ledger",
  resourceCatalog: "resource Catalog",
  componentStore: [
    "component Store {",
    "  owns Ledger",
    "  grants Read<Ledger>",
    "  grants Write<Ledger>",
    "  fn recordSale : RefactorSensitive",
    "    effects complete {",
    "      Read<Ledger>",
    "      Write<Ledger>",
    "    }",
    "}"
  ].join("\n"),
  componentPricing: [
    "component Pricing {",
    "  owns Catalog",
    "  grants Read<Catalog>",
    "  fn quote",
    "    effects complete {",
    "      Read<Catalog>",
    "    }",
    "}"
  ].join("\n"),
  relationCalls: [
    "relation StoreCallsPricing {",
    "  kind calls",
    "  connects Store -> Pricing",
    "}"
  ].join("\n"),
  memoryGuard: [
    "memory SaleRefactorConstraint : RefactorConstraint<fn Store.recordSale> {",
    "  applies_to fn Store.recordSale",
    "  status Unexplained",
    "  confidence High",
    '  summary "Past refactors silently dropped ledger writes."',
    "  who { owner StoreTeam }",
    "  guards { on_change require ReEvaluation<Self> }",
    "}"
  ].join("\n"),
  changeWithoutReeval: [
    "change SaleRefactor {",
    "  modify fn Store.recordSale",
    "    effects complete {",
    "      Read<Ledger>",
    "      Write<Ledger>",
    "    }",
    "}"
  ].join("\n"),
  componentAudit: [
    "component Audit {",
    "  fn reviewTrail : RefactorSensitive",
    "    effects unknown",
    "}"
  ].join("\n")
} as const;

// The "natural" declaration order. The permutation test reorders this list.
const NATURAL_ORDER: readonly (keyof typeof DECLARATIONS)[] = [
  "resourceLedger",
  "resourceCatalog",
  "componentStore",
  "componentPricing",
  "relationCalls",
  "memoryGuard",
  "changeWithoutReeval",
  "componentAudit"
];

function sourceFromOrder(order: readonly (keyof typeof DECLARATIONS)[]): string {
  return ["module shop", "", ...order.map((key) => DECLARATIONS[key])].join("\n\n");
}

const MODEL_SOURCE = sourceFromOrder(NATURAL_ORDER);
// The symbol passed to `explain`. "Store" resolves unambiguously to the one
// component named Store, whose explanation renders its grants, functions, and
// the calls relation.
const EXPLAIN_SYMBOL = "Store";

describe("#55 determinism + no-clock-in-checker", () => {
  test(
    lockedIntended(
      "repeated runs over one model are byte-identical across every public surface",
      "docs-site/src/content/docs/inside-shape/checker-pipeline.md (same inputs -> same facts/decisions/diagnostics)"
    ),
    () => {
      // Non-circular: each surface is run twice over freshly parsed modules, so
      // no single cached in-memory value is re-read, and parser-output object
      // identity cannot make the runs look deterministic.
      const moduleA = parseModuleOrThrow(MODEL_SOURCE);
      const moduleB = parseModuleOrThrow(MODEL_SOURCE);

      // Sanity: the model actually produces the obligation we rely on, so this
      // is not a vacuous "two empty strings match" check.
      const probe = checkShapeModules([moduleA]);
      expect(requireDiagnostic(probe, "guarded_shape_changed").target).toBe(
        "shop::Store.recordSale"
      );

      const surfaces: [string, () => string][] = [
        [
          "formatDiagnostics",
          () => formatDiagnostics(checkShapeModules([parseModuleOrThrow(MODEL_SOURCE)]))
        ],
        ["graphAllShapeModules", () => graphAllShapeModules([parseModuleOrThrow(MODEL_SOURCE)])],
        ["statsShapeHypergraph", () => statsShapeHypergraph([parseModuleOrThrow(MODEL_SOURCE)])],
        [
          "explainShapeModules",
          () => explainShapeModules([parseModuleOrThrow(MODEL_SOURCE)], EXPLAIN_SYMBOL)
        ],
        ["listShapeObligations", () => listShapeObligations([parseModuleOrThrow(MODEL_SOURCE)])],
        [
          "listMemoryGuardsShapeModules",
          () => listMemoryGuardsShapeModules([parseModuleOrThrow(MODEL_SOURCE)])
        ]
      ];

      for (const [name, run] of surfaces) {
        const first = run();
        const second = run();
        // Each surface produces non-trivial output, then the two runs match.
        expect(first.length, `${name} produced empty output`).toBeGreaterThan(0);
        expect(second, `${name} was not byte-identical across runs`).toBe(first);
      }

      // Cross-check the second freshly parsed module also reaches the obligation,
      // confirming the determinism is over parsing + checking, not one object.
      expect(requireDiagnostic(checkShapeModules([moduleB]), "guarded_shape_changed").target).toBe(
        "shop::Store.recordSale"
      );
    }
  );

  test(
    lockedIntended(
      "checker output is invariant under top-level declaration-order permutation",
      "docs-site/src/content/docs/inside-shape/checker-pipeline.md (deterministic over the input set, not its source order)"
    ),
    () => {
      // A non-trivial permutation: reverse the natural order. This moves the
      // `change` and `memory` BEFORE the component they reference, and the
      // relation before the components it connects, so any order-dependence in
      // lowering or rule evaluation would surface.
      const permutedOrder = [...NATURAL_ORDER].reverse();
      expect(permutedOrder).not.toEqual([...NATURAL_ORDER]); // guard: real reorder

      const natural = checkShapeModules([parseModuleOrThrow(MODEL_SOURCE)]);
      const permuted = checkShapeModules([parseModuleOrThrow(sourceFromOrder(permutedOrder))]);

      // NON-VACUITY GUARD: the model must emit several diagnostics anchored to
      // different declarations, otherwise byte-identical rendering below could
      // never catch source order leaking into diagnostic order.
      expect(natural.diagnostics.length).toBeGreaterThanOrEqual(3);

      // Same diagnostic multiset (sorted), regardless of source order.
      expect(diagnosticKinds(permuted)).toEqual(diagnosticKinds(natural));
      // And byte-identical rendered output: the reviewer-facing surface must
      // not leak source ordering.
      expect(render(permuted)).toBe(render(natural));

      // Premise guard: the two sources are genuinely different bytes, so equal
      // OUTPUT is a property of the checker, not of identical inputs.
      expect(sourceFromOrder(permutedOrder)).not.toBe(MODEL_SOURCE);
    }
  );

  test(
    lockedIntended(
      "the checker reads no system clock: output is identical under two wild fixed clocks",
      "shape/tooling.shape (clock read only at the CLI boundary); checker-pipeline.md determinism"
    ),
    () => {
      const RealDate = globalThis.Date;

      // Replace the global clock with a fixed one. Both Date.now() and a
      // zero-arg `new Date()` report `epochMs`; explicit args pass through so
      // any legitimate date arithmetic keeps working.
      const installFixedClock = (epochMs: number): void => {
        const Fixed = class extends RealDate {
          constructor(...args: readonly unknown[]) {
            if (args.length === 0) {
              super(epochMs);
            } else {
              // @ts-expect-error forwarding Date's overloaded constructor args
              super(...args);
            }
          }
          static override now(): number {
            return epochMs;
          }
        };
        // @ts-expect-error swapping the global Date binding for the test
        globalThis.Date = Fixed;
      };

      // A local clock-dependent function. If the CHECKER behaved like this,
      // the two-clock harness below would catch it — that is the negative
      // control proving this test is falsifiable, not a self-comparison.
      const clockStamp = (): string => new Date().toISOString();

      // Two arbitrary, distinct wall-clock instants (derived as UTC epochs from
      // RealDate so the patch math is independent of the local timezone).
      const CLOCK_A = RealDate.UTC(1997, 6, 4, 13, 45, 1);
      const CLOCK_B = RealDate.UTC(2031, 0, 19, 3, 14, 7);
      expect(CLOCK_A).not.toBe(CLOCK_B); // guard: the two clocks really differ

      let checkerUnderClockA: string;
      let checkerUnderClockB: string;
      let stampUnderClockA: string;
      let stampUnderClockB: string;
      try {
        installFixedClock(CLOCK_A);
        checkerUnderClockA = render(checkSource(MODEL_SOURCE));
        stampUnderClockA = clockStamp();

        globalThis.Date = RealDate;
        installFixedClock(CLOCK_B);
        checkerUnderClockB = render(checkSource(MODEL_SOURCE));
        stampUnderClockB = clockStamp();
      } finally {
        globalThis.Date = RealDate;
      }

      // The clock was actually restored and is sane again.
      expect(globalThis.Date).toBe(RealDate);
      expect(new Date().getUTCFullYear()).toBeGreaterThanOrEqual(2025);

      // Negative control fires: the same harness DOES distinguish a
      // clock-dependent function, so a clock-reading checker would fail here.
      expect(stampUnderClockA).not.toBe(stampUnderClockB);

      // The law: the checker's output is identical under both wild clocks.
      expect(checkerUnderClockB).toBe(checkerUnderClockA);
      // And it is the real, non-trivial output (not an error/empty fallback).
      expect(checkerUnderClockA).toContain("guarded shape changed");
    }
  );

  test(
    lockedIntended(
      "checker.ts contains no wall-clock read (no Date.now / new Date)",
      "shape/tooling.shape (clock is a CLI-boundary concern, never read in the checker)"
    ),
    () => {
      const checkerPath = resolve(repoRoot, "packages/shp-checker/src/checker.ts");
      const checkerSource = readFileSync(checkerPath, "utf8");
      // Matches `Date.now` (word-bounded) or `new Date(` with any spacing.
      const clockRead = /\bDate\.now\b|new\s+Date\s*\(/;

      expect(clockRead.test(checkerSource)).toBe(false);

      // NEGATIVE CONTROL: prove the regex is not a no-op by running it against
      // a synthetic source that DOES read the clock. If this matched nothing,
      // the assertion above would be vacuous.
      const plantedClockReader = "const t = Date.now();\nconst d = new Date();\n";
      expect(clockRead.test(plantedClockReader)).toBe(true);
    }
  );

  test(
    characterization(
      "review_by is an unvalidated free-form string (no library-level ISO YYYY-MM-DD validation exists)",
      {
        reason:
          "review_by is a bare STRING in the grammar (ReviewByDecl), stored verbatim; no checker/library API validates ISO YYYY-MM-DD",
        followUp: "epic #55 invariant 5 / #34"
      }
    ),
    () => {
      // The grammar types `review_by` as a bare STRING (shape.langium
      // ReviewByDecl), the checker stores it verbatim (reviewBy?: string), and
      // the formatter/list surfaces echo it back. checkFreshness uses
      // isIsoCalendarDate only to skip non-ISO review_by values, so no checker
      // path rejects them. This test documents that the IDEAL is currently
      // unmet: a non-ISO date is accepted silently. If rejection lands, the
      // `shouldBe` todo below becomes a `lockedIntended` test asserting it.
      const nonIsoReviewBy = "banana-not-a-date"; // deliberately not YYYY-MM-DD
      const source = [
        "module rb",
        "",
        "resource R",
        "",
        "component C {",
        "  owns R",
        "  grants Read<R>",
        "  fn f",
        "    effects complete { Read<R> }",
        "}",
        "",
        "memory M : RefactorConstraint<fn C.f> {",
        "  applies_to fn C.f",
        "  status Explained",
        "  confidence High",
        '  summary "x"',
        "  who { owner T }",
        `  when { review_by "${nonIsoReviewBy}" }`,
        "  protects { shape Foo }",
        "  guards { on_change require ReEvaluation<Self> }",
        "}"
      ].join("\n");

      const result = checkSource(source);

      // CURRENT behaviour: the non-ISO review_by is accepted with zero
      // diagnostics and echoed back verbatim.
      expect(result.ok).toBe(true);
      expect(diagnosticKinds(result)).toEqual([]);
      expect(listMemoryGuardsShapeModules([parseModuleOrThrow(source)])).toContain(
        `review_by: ${nonIsoReviewBy}`
      );

      // NEGATIVE CONTROL: prove the parser/checker path CAN reject a memory —
      // so the green result above is a real "accepted", not a swallowed error.
      // A memory whose target function does not exist is rejected, confirming
      // the checker exercises this declaration rather than ignoring it.
      const brokenTarget = source.replace("fn C.f", "fn C.doesNotExist");
      // `replace` changes only the first occurrence, the
      // `RefactorConstraint<fn C.f>` type argument. The result still parses
      // (parseModuleOrThrow would throw otherwise); the failure is semantic
      // because that fn target no longer resolves.
      const brokenResult = checkShapeModules([parseModuleOrThrow(brokenTarget)]);
      expect(brokenResult.ok).toBe(false);
      expect(diagnosticKinds(brokenResult).length).toBeGreaterThan(0);
    }
  );

  // The unmet ideal, kept as `test.todo` so it does not run: were ISO
  // validation a law, a non-ISO review_by would be rejected. Tracked for epic
  // #55 invariant 5 / #34.
  test.todo(
    shouldBe(
      "a non-ISO review_by date is rejected",
      "concepts/effect-model.md (Unknown and complete effects); epic #55 invariant 5"
    ),
    () => {
      // The future assertion, NOT executed while no checker path rejects a
      // non-ISO review_by.
      const result = checkSource(
        [
          "module rb",
          "",
          "resource R",
          "",
          "component C {",
          "  owns R",
          "  grants Read<R>",
          "  fn f",
          "    effects complete { Read<R> }",
          "}",
          "",
          "memory M : RefactorConstraint<fn C.f> {",
          "  applies_to fn C.f",
          "  status Explained",
          "  confidence High",
          '  summary "x"',
          "  who { owner T }",
          '  when { review_by "banana-not-a-date" }',
          "  protects { shape Foo }",
          "  guards { on_change require ReEvaluation<Self> }",
          "}"
        ].join("\n")
      );
      expect(result.ok).toBe(false);
    }
  );
});
