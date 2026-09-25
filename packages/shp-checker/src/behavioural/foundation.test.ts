// #54 — Foundation: structured-diagnostic + causal-path assertions.
//
// These are the worked examples the rest of the behavioural suite follows.
// They assert diagnostic IDENTITY (kind + fields) and, for the key diagnostics,
// the vision's CAUSAL PATH as an ordered chain.

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { checkShapeFiles } from "../index.ts";
import {
  checkSource,
  expectOrderedFragments,
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
      "docs-site/.../concepts/effect-model.md"
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
      "guarded-shape-changed asserts the guard, target, and the reevaluation it demands",
      "concepts/design-memory.md (guarded change requires reevaluation)"
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
      "shape/checker.shape PreludeMetadataContract; concepts/design-memory.md"
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
});
