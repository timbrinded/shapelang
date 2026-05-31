// #54 — Foundation: structured-diagnostic + causal-path assertions, and the
// negative control proving why they beat substring matching.
//
// These are the worked examples the rest of the behavioural suite follows.
// They assert diagnostic IDENTITY (kind + fields) and, for the key diagnostics,
// the vision's CAUSAL PATH as an ordered chain.

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { checkShapeFiles, formatDiagnostics } from "../index.ts";
import {
  checkSource,
  expectOrderedFragments,
  findDiagnostic,
  lockedIntended,
  render,
  requireDiagnostic
} from "./harness.ts";

const repoRoot = resolve(import.meta.dir, "../../../..");
const fixture = (rel: string): string => resolve(repoRoot, rel);

describe("#54 structured diagnostic + causal-path foundation", () => {
  test(
    lockedIntended(
      "final-forbidden effect asserts identity and the emits/has-trait/forbids causal chain",
      "inside-shape/design-rationale.md (causal path); shape/checker.shape FinalForbidPrecedence + DiagnosticContract"
    ),
    async () => {
      const result = await checkShapeFiles([
        fixture("fixtures/fail/append_only_hard_delete/audit.shape")
      ]);

      const diagnostic = requireDiagnostic(result, "final_forbidden_effect");
      // Structured identity (primary assertion). Internal symbols are
      // module-qualified (`module::Name`); the rendered surface strips them.
      expect(diagnostic.component).toBe("audit::AuditStore");
      expect(diagnostic.functionName).toBe("purgeOldEvents");
      expect(diagnostic.effect).toBe("HardDelete");
      expect(diagnostic.target).toBe("audit::AuditEvent");
      expect(diagnostic.trait).toBe("audit::AppendOnly");
      // The causal path is a 3-step provenance chain (effect -> trait link -> forbid).
      expect(diagnostic.causedBy).toHaveLength(3);

      // Causal-path quality (secondary assertion): the chain is taught, in order.
      expectOrderedFragments(render(result), [
        "AuditStore.purgeOldEvents emits HardDelete<AuditEvent>",
        "AuditEvent has trait AppendOnly",
        "AppendOnly forbids final HardDelete<AuditEvent>"
      ]);
    }
  );

  test(
    lockedIntended(
      "missing-grant asserts the offending component, function, effect, and target",
      "docs-site/.../concepts/components-ownership-grants.md"
    ),
    () => {
      // A function emits an effect its component never grants. Resource has no
      // trait, so this isolates the grant check from final-forbid behaviour.
      const result = checkSource(
        [
          "module m",
          "",
          "resource Ledger",
          "",
          "component Bookkeeper {",
          "  owns Ledger",
          "  fn read",
          "    effects complete {",
          "      Read<Ledger>",
          "    }",
          "}"
        ].join("\n")
      );

      const diagnostic = requireDiagnostic(result, "missing_grant");
      expect(diagnostic.component).toBe("m::Bookkeeper");
      expect(diagnostic.functionName).toBe("read");
      expect(diagnostic.effect).toBe("Read");
      expect(diagnostic.target).toBe("m::Ledger");
    }
  );

  test(
    lockedIntended(
      "forbidden-hypercycle asserts the rule and the participating vertices/edges",
      "shape/checker.shape HypercycleWitness"
    ),
    async () => {
      const result = await checkShapeFiles([fixture("fixtures/fail/hypercycle_calls/deps.shape")]);

      const diagnostic = requireDiagnostic(result, "forbidden_hypercycle");
      expect(diagnostic.rule).toBe("deps::no_calls_cycle");
      // Witness identity: a closed cycle (first vertex repeated at the end)
      // over exactly the three participating components.
      expect(diagnostic.vertices.at(0)).toBe(diagnostic.vertices.at(-1));
      expect(new Set(diagnostic.vertices)).toEqual(
        new Set(["deps::AuditStore", "deps::ContractRegistry", "deps::Gateway"])
      );
      expect(diagnostic.hyperedges.map((edge) => edge.name).sort()).toEqual([
        "deps::AuditCallsRegistry",
        "deps::GatewayCallsAudit",
        "deps::RegistryCallsGateway"
      ]);
      for (const edge of diagnostic.hyperedges) {
        expect(edge.kind).toBe("calls");
      }
    }
  );

  test(
    lockedIntended(
      "guarded-shape-changed asserts the guard, target, and the reevaluation it demands",
      "concepts/refactor-constraints.md (guarded change requires reevaluation)"
    ),
    async () => {
      const result = await checkShapeFiles([
        fixture("fixtures/fail/memory_guard_modify_without_reevaluation/audit.shape")
      ]);

      const diagnostic = requireDiagnostic(result, "guarded_shape_changed");
      expect(diagnostic.guardKind).toBe("memory");
      expect(diagnostic.guard).toBe("gateway::DecisionRefactorConstraint");
      expect(diagnostic.targetKind).toBe("fn");
      expect(diagnostic.target).toBe("gateway::Gateway.derivePolicyDecision");
    }
  );

  test(
    lockedIntended(
      "missing-required-context asserts the target and the context the trait requires",
      "shape/checker.shape PreludeMetadataContract; concepts/refactor-constraints.md"
    ),
    async () => {
      const result = await checkShapeFiles([
        fixture("fixtures/fail/memory_guard_missing_rationale/audit.shape")
      ]);

      const diagnostic = requireDiagnostic(result, "missing_required_context");
      expect(diagnostic.targetKind).toBe("fn");
      expect(diagnostic.target).toBe("gateway::Gateway.derivePolicyDecision");
      // PreserveInline derives an InlineRationale obligation, sourced from the prelude.
      expect(diagnostic.requiredContext).toContain("InlineRationale");
      expect(diagnostic.requiredBy).toBe("PreserveInline");
    }
  );

  // NEGATIVE CONTROL — proves the structured approach catches a regression a
  // substring assertion would miss. Worked replacement for the `.toContain`
  // style at checker.test.ts (e.g. the forbid tests around lines 504-574 and
  // the loose hypercycle assertions around 1521-1539).
  test(
    lockedIntended(
      "structured assertions distinguish diagnostics that share a substring",
      "epic #53 standard: no substring-only semantic assertions"
    ),
    async () => {
      const forbidResult = await checkShapeFiles([
        fixture("fixtures/fail/append_only_hard_delete/audit.shape")
      ]);
      const cycleResult = await checkShapeFiles([
        fixture("fixtures/fail/hypercycle_calls/deps.shape")
      ]);

      // Both rejections render the word "forbidden", so a sole
      // `toContain("forbidden")` cannot tell them apart — it would pass on the
      // WRONG diagnostic.
      expect(formatDiagnostics(forbidResult)).toContain("forbidden");
      expect(formatDiagnostics(cycleResult)).toContain("forbidden");

      // The structured assertion does tell them apart.
      expect(findDiagnostic(forbidResult, "final_forbidden_effect")).toBeDefined();
      expect(findDiagnostic(cycleResult, "final_forbidden_effect")).toBeUndefined();
      expect(() => requireDiagnostic(cycleResult, "final_forbidden_effect")).toThrow(
        /expected a "final_forbidden_effect" diagnostic/
      );
    }
  );
});
