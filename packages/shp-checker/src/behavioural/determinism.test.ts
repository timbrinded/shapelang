// #55 — Determinism + the no-clock-in-checker law.
//
// Vision anchors:
//   - docs-site/src/content/docs/inside-shape/checker-pipeline.md: "The same
//     `.shape` files and check options produce the same lowered model, facts,
//     and diagnostics."
//   - shape/checker.shape memories FinalForbidPrecedence and HypercycleWitness
//     require deterministic target resolution and a deterministic witness path.
//   - shape/tooling.shape memory ClockReadAtCliBoundary: the clock is read only
//     at the CLI boundary; the library checker reads no wall clock.
//
// Each invariant is a SEPARATE test. The clock invariant feeds a review_by that
// falls between its two clocks, so a checker that read the clock would render a
// stale-memory diagnostic under one clock only.

import { describe, expect, test } from "bun:test";
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
  checkSource,
  diagnosticKinds,
  lockedIntended,
  parseModuleOrThrow,
  render,
  requireDiagnostic
} from "./harness.ts";

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

      // Two arbitrary, distinct wall-clock instants (derived as UTC epochs from
      // RealDate so the patch math is independent of the local timezone).
      const CLOCK_A = RealDate.UTC(1997, 6, 4, 13, 45, 1);
      const CLOCK_B = RealDate.UTC(2031, 0, 19, 3, 14, 7);
      expect(CLOCK_A).not.toBe(CLOCK_B); // guard: the two clocks really differ

      // A review_by between the two clocks: a checker that defaulted its
      // freshness date to "today" would report the memory stale under B only,
      // so equal output below is only possible if no clock is read.
      const clockSensitiveSource = MODEL_SOURCE.replace(
        "  who { owner StoreTeam }",
        '  who { owner StoreTeam }\n  when { review_by "2010-01-01" }'
      );
      expect(clockSensitiveSource).not.toBe(MODEL_SOURCE);

      let checkerUnderClockA: string;
      let checkerUnderClockB: string;
      try {
        installFixedClock(CLOCK_A);
        checkerUnderClockA = render(checkSource(clockSensitiveSource));

        globalThis.Date = RealDate;
        installFixedClock(CLOCK_B);
        checkerUnderClockB = render(checkSource(clockSensitiveSource));
      } finally {
        globalThis.Date = RealDate;
      }

      // The clock was actually restored and is sane again.
      expect(globalThis.Date).toBe(RealDate);
      expect(new Date().getUTCFullYear()).toBeGreaterThanOrEqual(2025);

      // The law: the checker's output is identical under both wild clocks.
      expect(checkerUnderClockB).toBe(checkerUnderClockA);
      // And it is the real, non-trivial output (not an error/empty fallback).
      expect(checkerUnderClockA).toContain("guarded shape changed");
    }
  );
});
