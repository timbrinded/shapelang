// #58 — Core safety invariants.
//
// These tests pin the load-bearing safety laws of the checker: a final forbid
// cannot be waived by any review mechanism, memory cannot waive a missing grant,
// and `effects unknown` never silently completes for authored models. Each test
// names a vision-derived law and cites its authoritative clause:
//
//   - shape/checker.shape FinalForbidPrecedence (memory FinalForbidPrecedence,
//     summary: "Final forbids must remain stronger than component grants ... and
//     cannot be waived by rationale or memory.")
//   - docs-site/.../inside-shape/rule-evaluation.md ("Memory is not a waiver ...
//     it does not suppress final forbids, missing grants, or other hard model
//     failures.")
//   - docs-site/.../concepts/unknowns-safety.md ("`effects unknown` ... is not a
//     safe final state for protected architecture.")
//
// Every assertion is structured (requireDiagnostic + fields), layered with the
// rendered causal path where it teaches the precedence chain. The negative
// controls plant an allowed-effect / complete-effects mutant so the waiver and
// unknown tests are demonstrably falsifiable, not constant failures.

import { describe, expect, test } from "bun:test";
import {
  checkSource,
  checkSourceAs,
  diagnosticKinds,
  expectOrderedFragments,
  findDiagnostic,
  lockedIntended,
  render,
  requireDiagnostic,
  requireNoDiagnostic,
  shouldBe
} from "./harness.ts";

// The trait + resource that derives the final forbid. This mirrors
// fixtures/fail/append_only_hard_delete/audit.shape: AppendOnly forbids
// `final HardDelete`, AuditEvent carries AppendOnly. The forbidden effect is
// HardDelete; an ALLOWED effect on the same trait is Read.
const FORBIDDEN_EFFECT = "HardDelete";
const ALLOWED_EFFECT = "Read";
const TARGET = "AuditEvent";
const TRAIT = "AppendOnly";

const forbidPreamble = `module safety_forbid

trait ${TRAIT}<T: Resource> {
  allow Append<T>
  allow ${ALLOWED_EFFECT}<T>
  forbid final ${FORBIDDEN_EFFECT}<T>
}

resource ${TARGET} : ${TRAIT}
`;

/**
 * Build the component holding the (possibly forbidden) effect on `purgeOldEvents`.
 * Both grants are present so the GRANT check passes and the model isolates the
 * final-forbid rule. `shapeTraits` lets a variant carry the context traits its
 * waiver mechanism requires (RefactorSensitive for memory, PreserveInline for
 * rationale).
 */
function auditComponent(opts: { effect?: string; shapeTraits?: string[] } = {}): string {
  const effect = opts.effect ?? `${FORBIDDEN_EFFECT}<${TARGET}>`;
  const traits = opts.shapeTraits?.length ? ` : ${opts.shapeTraits.join(", ")}` : "";
  return `component AuditStore {
  owns ${TARGET}
  grants ${FORBIDDEN_EFFECT}<${TARGET}>
  grants ${ALLOWED_EFFECT}<${TARGET}>
  fn purgeOldEvents${traits}
    effects complete {
      ${effect}
    }
}
`;
}

// The five waiver mechanisms, each attached to AuditStore.purgeOldEvents. Note
// the grant is already in `auditComponent`; the "grant" variant simply asserts
// that the grant the rule-evaluation docs name as the canonical waiver attempt
// ("If final forbids could be overridden by adding a grant ...") does not work.
const rationaleBlock = `rationale PurgeInline : InlineRationale<fn AuditStore.purgeOldEvents> {
  applies_to fn AuditStore.purgeOldEvents
  why CognitiveLocality
  summary "Purge stays inline for auditability."
  owner AuditTeam
}
`;

const memoryBlock = `memory PurgeConstraint : RefactorConstraint<fn AuditStore.purgeOldEvents> {
  applies_to fn AuditStore.purgeOldEvents
  status Unexplained
  confidence High
  summary "Purge timing is load-bearing."
  owner AuditTeam
  guards on_change require ReEvaluation<Self>
}
`;

// A reevaluation that fully satisfies the memory guard's obligation, paired with
// the change that triggers it. This is the strongest form of the reevaluation
// waiver: the guard flow is satisfied (no guarded_shape_changed / invalid_
// reevaluation noise), so the ONLY thing left to fail is the final forbid.
const reevaluationFlow = `reevaluation PurgeRechecked {
  satisfies memory PurgeConstraint
  outcome Confirmed
  summary "Refactor preserves purge behaviour."
  reviewer AuditTeam
  decided_on "2026-06-02"
  evidence test("audit/purge.test.ts")
}

change RefactorPurge {
  modify fn AuditStore.purgeOldEvents
    effects complete {
      ${FORBIDDEN_EFFECT}<${TARGET}>
    }
}
`;

const attestBlock = `attest no_shape_change {
  source ts("src/audit/purge.ts")
  reason "Purge implementation unchanged."
}
`;

/**
 * The waiver variants. Each ADDS one mechanism to the forbidden model; `all`
 * combines every mechanism with both required context traits and a satisfied
 * guard flow. Derived from the grammar's declaration forms (rationale, memory,
 * reevaluation, attest) and the pass-fixture shapes for the guard flow.
 */
const waiverVariants: Record<string, string> = {
  grant: forbidPreamble + auditComponent(),
  rationale:
    forbidPreamble + auditComponent({ shapeTraits: ["PreserveInline"] }) + "\n" + rationaleBlock,
  memory:
    forbidPreamble + auditComponent({ shapeTraits: ["RefactorSensitive"] }) + "\n" + memoryBlock,
  reevaluation:
    forbidPreamble +
    auditComponent({ shapeTraits: ["RefactorSensitive"] }) +
    "\n" +
    memoryBlock +
    "\n" +
    reevaluationFlow,
  attest: forbidPreamble + auditComponent() + "\n" + attestBlock,
  all:
    forbidPreamble +
    auditComponent({ shapeTraits: ["RefactorSensitive", "PreserveInline"] }) +
    "\n" +
    rationaleBlock +
    "\n" +
    memoryBlock +
    "\n" +
    reevaluationFlow +
    "\n" +
    attestBlock
};

describe("#58 core safety invariants", () => {
  test(
    lockedIntended(
      "a final forbid is unwaivable by grant, rationale, memory, reevaluation, attest, or all combined",
      "shape/checker.shape FinalForbidPrecedence; inside-shape/rule-evaluation.md (final forbids)"
    ),
    () => {
      for (const [mechanism, source] of Object.entries(waiverVariants)) {
        const result = checkSource(source);

        // Primary: the structured final-forbid diagnostic survives this waiver,
        // with the same offending fn/effect/target/trait identity.
        const diagnostic = requireDiagnostic(result, "final_forbidden_effect");
        expect(diagnostic.component, mechanism).toBe("safety_forbid::AuditStore");
        expect(diagnostic.functionName, mechanism).toBe("purgeOldEvents");
        expect(diagnostic.effect, mechanism).toBe(FORBIDDEN_EFFECT);
        expect(diagnostic.target, mechanism).toBe(`safety_forbid::${TARGET}`);
        expect(diagnostic.trait, mechanism).toBe(`safety_forbid::${TRAIT}`);

        // Secondary: the rendered causal chain still teaches emit -> trait ->
        // final forbid, i.e. the precedence rule, not a waived/softened message.
        expectOrderedFragments(render(result), [
          `AuditStore.purgeOldEvents emits ${FORBIDDEN_EFFECT}<${TARGET}>`,
          `${TARGET} has trait ${TRAIT}`,
          `${TRAIT} forbids final ${FORBIDDEN_EFFECT}<${TARGET}>`
        ]);
      }
    }
  );

  test(
    lockedIntended(
      "the satisfied memory-guard + reevaluation flow leaves the final forbid as the sole failure",
      "shape/checker.shape FinalForbidPrecedence; inside-shape/rule-evaluation.md (Memory is not a waiver)"
    ),
    () => {
      // The `reevaluation` variant satisfies the guard obligation completely:
      // a memory guard, the change that triggers it, and a confirming
      // reevaluation. If memory/reevaluation could waive a hard failure, OR if
      // the guard flow were itself unsatisfied, this would show other kinds.
      // It must show exactly the final forbid.
      const result = checkSource(waiverVariants.reevaluation!);
      expect(diagnosticKinds(result)).toEqual(["final_forbidden_effect"]);
      requireNoDiagnostic(result, "guarded_shape_changed");
      requireNoDiagnostic(result, "invalid_reevaluation");
    }
  );

  // NEGATIVE CONTROL for invariant 1: the SAME model with the forbidden effect
  // replaced by an ALLOWED one (Read, which AppendOnly permits) PASSES. This
  // proves the waiver tests above detect the forbidden effect specifically and
  // are not a constant failure that any input would trip.
  test(
    lockedIntended(
      "negative control: the same model emitting an allowed effect has no final-forbid diagnostic",
      "fixtures/fail/append_only_hard_delete/audit.shape (AppendOnly allows Read, forbids HardDelete)"
    ),
    () => {
      const allowed = forbidPreamble + auditComponent({ effect: `${ALLOWED_EFFECT}<${TARGET}>` });
      const result = checkSource(allowed);

      requireNoDiagnostic(result, "final_forbidden_effect");
      // Read is allowed and granted, so the model is clean: a real pass, which
      // is what makes the forbidden-effect detection above falsifiable.
      expect(diagnosticKinds(result)).toEqual([]);
    }
  );

  test(
    lockedIntended(
      "memory attached to a function does not waive a missing grant",
      "inside-shape/rule-evaluation.md (Memory ... does not suppress ... missing grants)"
    ),
    () => {
      // Neutral resource (no trait) so this isolates the grant check from
      // final-forbid behaviour: the fn emits Append<Ledger> but the component
      // never grants it, and a memory is attached to the same fn.
      const source = `module safety_grant

resource Ledger

component Bookkeeper {
  owns Ledger
  fn writeLedger : RefactorSensitive
    effects complete {
      Append<Ledger>
    }
}

memory LedgerConstraint : RefactorConstraint<fn Bookkeeper.writeLedger> {
  applies_to fn Bookkeeper.writeLedger
  status Explained
  confidence High
  summary "Append path is intentional."
  owner LedgerTeam
}
`;
      const result = checkSource(source);

      const diagnostic = requireDiagnostic(result, "missing_grant");
      expect(diagnostic.component).toBe("safety_grant::Bookkeeper");
      expect(diagnostic.functionName).toBe("writeLedger");
      expect(diagnostic.effect).toBe("Append");
      expect(diagnostic.target).toBe("safety_grant::Ledger");
      // The memory is accepted (it satisfies the RefactorSensitive context), so
      // the only remaining failure is the grant the memory did NOT waive.
      expect(diagnosticKinds(result)).toEqual(["missing_grant"]);
    }
  );

  // NEGATIVE CONTROL for invariant 2: adding the grant the component lacks
  // clears the diagnostic, proving the missing-grant assertion above is keyed to
  // the absent grant and not the presence of the memory.
  test(
    lockedIntended(
      "negative control: granting the emitted effect clears the missing-grant diagnostic",
      "concepts/components-ownership-grants.md; rule-evaluation.md (Missing Grants)"
    ),
    () => {
      const source = `module safety_grant

resource Ledger

component Bookkeeper {
  owns Ledger
  grants Append<Ledger>
  fn writeLedger : RefactorSensitive
    effects complete {
      Append<Ledger>
    }
}

memory LedgerConstraint : RefactorConstraint<fn Bookkeeper.writeLedger> {
  applies_to fn Bookkeeper.writeLedger
  status Explained
  confidence High
  summary "Append path is intentional."
  owner LedgerTeam
}
`;
      const result = checkSource(source);
      requireNoDiagnostic(result, "missing_grant");
      expect(diagnosticKinds(result)).toEqual([]);
    }
  );

  // Source shared by the authored / generated-AST split below.
  const unknownSource = `module safety_unknown

resource AuditEvent

component AuditStore {
  owns AuditEvent
  fn importLegacyEvents
    effects unknown
}
`;

  test(
    lockedIntended(
      "an authored `effects unknown` function never silently completes; it raises unknown_effects",
      "concepts/unknowns-safety.md (not a safe final state); rule-evaluation.md (Unknown Effects)"
    ),
    () => {
      const result = checkSource(unknownSource);

      const diagnostic = requireDiagnostic(result, "unknown_effects");
      expect(diagnostic.component).toBe("safety_unknown::AuditStore");
      expect(diagnostic.functionName).toBe("importLegacyEvents");
      // Sole diagnostic: uncertainty is surfaced, not buried under or replaced
      // by other failures.
      expect(diagnosticKinds(result)).toEqual(["unknown_effects"]);
    }
  );

  test(
    lockedIntended(
      "the generated-AST origin is the only thing that suppresses unknown_effects",
      "concepts/unknowns-safety.md; checker.ts shouldIgnoreUnknownEffectsDiagnostic (generatedAstCandidate)"
    ),
    () => {
      // Verified against the checker via scratch: `effects unknown` raises
      // unknown_effects for authored modules, and origin "generated_ast" (which
      // sets generatedAstCandidate) is the lone suppressor. This pins that the
      // suppression is scoped to machine-proposed candidates, not authored ones.
      const authored = checkSourceAs(unknownSource, { origin: "authored" });
      expect(findDiagnostic(authored, "unknown_effects")).toBeDefined();

      const generated = checkSourceAs(unknownSource, { origin: "generated_ast" });
      requireNoDiagnostic(generated, "unknown_effects");
      // The function vanishes from unknown-effects reporting entirely; nothing
      // else takes its place.
      expect(diagnosticKinds(generated)).toEqual([]);
    }
  );

  // NEGATIVE CONTROL for invariant 3: replacing `effects unknown` with a
  // complete summary produces NO unknown_effects, proving the diagnostic above
  // is keyed to the unknown state and not to the function's mere existence.
  test(
    lockedIntended(
      "negative control: an `effects complete` function emits no unknown_effects",
      "concepts/unknowns-safety.md (Complete effects); rule-evaluation.md (Unknown Effects)"
    ),
    () => {
      const source = `module safety_unknown

resource AuditEvent

component AuditStore {
  owns AuditEvent
  grants Read<AuditEvent>
  fn importLegacyEvents
    effects complete {
      Read<AuditEvent>
    }
}
`;
      const result = checkSource(source);
      requireNoDiagnostic(result, "unknown_effects");
      expect(diagnosticKinds(result)).toEqual([]);
    }
  );

  // SHOULD-BE: an `effects unknown` on a governed/protected target ought to be a
  // stricter blocker than a plain diagnostic — unknowns-safety.md calls it "not
  // a safe final state for protected architecture", which implies escalation
  // (e.g. a distinct blocking severity or an unsafe-on-protected kind) rather
  // than a diagnostic of the same weight as any other. The checker currently
  // emits a single uniform `unknown_effects` regardless of whether the target is
  // protected, so this documents the ideal without breaking CI.
  test.todo(
    shouldBe(
      "unknown effects on a protected target escalate beyond a plain unknown_effects diagnostic",
      "concepts/unknowns-safety.md (not a safe final state for protected architecture)"
    ),
    () => {
      // The function is protected (a memory guard guards on_change) AND its
      // effects are unknown. The vision says this is "not a safe final state for
      // protected architecture": being protected should make the unknown a
      // STRICTER blocker than the same unknown on an unprotected function — e.g.
      // a distinct kind, or unknown_effects carrying a "protected" marker. The
      // checker today emits the identical, unmarked unknown_effects for both, so
      // this assertion fails and is parked as a tracked gap rather than CI noise.
      const protectedUnknown = `module safety_unknown

resource AuditEvent

component AuditStore {
  owns AuditEvent
  fn importLegacyEvents : RefactorSensitive
    effects unknown
}

memory ImportConstraint : RefactorConstraint<fn AuditStore.importLegacyEvents> {
  applies_to fn AuditStore.importLegacyEvents
  status Unexplained
  confidence High
  summary "Legacy import path is load-bearing."
  owner AuditTeam
  guards on_change require ReEvaluation<Self>
}
`;
      const unprotectedUnknown = `module safety_unknown

resource AuditEvent

component AuditStore {
  owns AuditEvent
  fn importLegacyEvents
    effects unknown
}
`;
      const protectedResult = checkSource(protectedUnknown);
      const unprotectedResult = checkSource(unprotectedUnknown);

      // The ideal: the protected case is distinguishable from (stricter than)
      // the unprotected one. Equal diagnostic kinds means no escalation exists.
      expect(diagnosticKinds(protectedResult)).not.toEqual(diagnosticKinds(unprotectedResult));
    }
  );
});
