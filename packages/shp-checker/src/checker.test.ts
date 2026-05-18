import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  analyzeSourceText,
  buildShapeAuthorPrompt,
  buildShapeCriticPrompt,
  checkShapeFiles,
  checkShapeModules,
  compareAnalyzerHintsToShape,
  extractEvidenceSpansFromUnifiedDiff,
  formatAnalyzerWarnings,
  formatOnSave,
  formatShapeSource,
  generateShapeDelta,
  getCompletions,
  getDefinitionLocation,
  getEditorDiagnostics,
  getHoverText,
  explainShapeModules,
  formatDiagnostics,
  parseShapeModule
} from "./index.ts";

const repoRoot = resolve(import.meta.dir, "../../..");

function fnTarget(name: string): string {
  return `fn ${name}`;
}

function contextRef(contextType: string, target: string): string {
  return `${contextType}<${target}>`;
}

describe("Shape parser", () => {
  test("parses a minimal valid module", () => {
    const parsed = parseShapeModule(`
      module audit
      resource AuditEvent : AppendOnly
      component AuditStore {
        owns AuditEvent
        grants Append<AuditEvent>
        fn appendEvent
          effects complete {
            Append<AuditEvent>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.module.name).toBe("audit");
      expect(parsed.module.declarations).toHaveLength(2);
    }
  });

  test("parses explicit trait declarations", () => {
    // noinspection RequiredAttributes
    const parsed = parseShapeModule(`
      module audit

      trait AppendOnly<T: Resource> {
        allow Read<T>
        allow Append<T>
        forbid final HardDelete<T>
      }

      resource AuditEvent : AppendOnly
    `);

    expect(parsed.ok).toBe(true);
  });

  test("parses memory guard declarations and function annotations", () => {
    const parsed = parseShapeModule(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : RequiresDescription, PreserveInline
          source ts("src/gateway/authorize.ts#derivePolicyDecision")
          description required "Policy decision branches remain local for auditability."
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale DerivePolicyDecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Policy checks remain inline for auditability."
        owner GatewayTeam
      }

      memory DoNotTouchDecisionShape : ${contextRef("HardFoughtKnowledge", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        protects shape CheckOrder
        guards on_change require ${contextRef("ReEvaluation", "Self")}
        observed issue("SEC-231")
        summary "Previous refactors broke error normalisation."
        owner GatewayTeam
        review_by "2026-08-18"
      }

      reevaluation DecisionShapeRechecked {
        satisfies memory DoNotTouchDecisionShape
        outcome Confirmed
        summary "Refactor preserves error-normalisation behaviour."
        evidence test("gateway/error-normalisation.test.ts")
        reviewer GatewayTeam
        approver Security
        decided_on "2026-06-02"
      }

      change RefactorGatewayDecision {
        modify fn Gateway.derivePolicyDecision : PreserveInline
          description required "Policy decision branches remain local for auditability."
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
  });

  test("reports parser errors", () => {
    const parsed = parseShapeModule("resource");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.diagnostics[0]?.message).toContain("Expecting");
    }
  });
});

describe("Shape checker", () => {
  test("passes append-only append fixture", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/append_only_append/audit.shape")
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("passes append-only read fixture", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/append_only_read/audit.shape")
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("rejects hard delete against append-only resource", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/append_only_hard_delete/audit.shape")
    ]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("AuditStore.purgeOldEvents");
    expect(output).toContain("HardDelete<AuditEvent>");
    expect(output).toContain("AuditEvent has trait AppendOnly");
    expect(output).toContain("AppendOnly forbids final HardDelete<AuditEvent>");
    expect(output).toContain("evidence: ts(\"src/audit/purge.ts:12-16\")");
  });

  test("uses explicit trait final forbid declarations", () => {
    // noinspection RequiredAttributes
    const parsed = parseShapeModule(`
      trait Protected<T: Resource> {
        forbid final HardDelete<T>
      }

      resource AuditEvent : Protected

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>
        fn purgeOldEvents
          effects complete {
            HardDelete<AuditEvent>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module], { includeFacts: true });
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("AuditEvent has trait Protected");
    expect(output).toContain("Protected forbids final HardDelete<AuditEvent>");
    expect(output).toContain("caused by:");
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "trait_final_forbid",
        trait: "Protected",
        effect: "HardDelete"
      })
    );
  });

  test("checks already parsed modules", () => {
    const parsed = parseShapeModule(`
      resource AuditEvent : AppendOnly
      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>
        fn purgeOldEvents
          effects complete {
            HardDelete<AuditEvent>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    expect(result.exitCode).toBe(1);
    expect(formatDiagnostics(result)).toContain("forbidden effect");
  });

  test("applies change-file function additions to the base model", () => {
    const base = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>
      }
    `);
    const change = parseShapeModule(`
      module changes.PR_001
      import audit

      change AddAuditRetentionPurge {
        add fn AuditStore.purgeOldEvents
          source ts("src/audit/purge.ts#purgeOldEvents")
          effects complete {
            HardDelete<AuditEvent>
              evidence ts("src/audit/purge.ts:12-16")
          }
      }
    `);

    expect(base.ok).toBe(true);
    expect(change.ok).toBe(true);
    if (!base.ok || !change.ok) {
      return;
    }

    const result = checkShapeModules([base.module, change.module]);

    expect(result.exitCode).toBe(1);
    expect(formatDiagnostics(result)).toContain("AuditStore.purgeOldEvents");
  });

  test("applies change-file function removals before checking", () => {
    const base = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>

        fn purgeOldEvents
          effects complete {
            HardDelete<AuditEvent>
          }
      }
    `);
    const change = parseShapeModule(`
      module changes.PR_002
      import audit

      change RemoveAuditRetentionPurge {
        remove fn AuditStore.purgeOldEvents
      }
    `);

    expect(base.ok).toBe(true);
    expect(change.ok).toBe(true);
    if (!base.ok || !change.ok) {
      return;
    }

    const result = checkShapeModules([base.module, change.module]);

    expect(result.exitCode).toBe(0);
  });

  test("applies change-file top-level declaration modifications", () => {
    const base = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>

        fn purgeOldEvents
          effects complete {
            HardDelete<AuditEvent>
          }
      }
    `);
    const change = parseShapeModule(`
      module changes.PR_004
      import audit

      change ReclassifyAuditEvent {
        modify resource AuditEvent
      }
    `);

    expect(base.ok).toBe(true);
    expect(change.ok).toBe(true);
    if (!base.ok || !change.ok) {
      return;
    }

    const result = checkShapeModules([base.module, change.module]);

    expect(result.exitCode).toBe(0);
  });

  test("fails coverage when governed files change without shape delta", () => {
    const parsed = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
      }

      implementation AuditStoreImpl {
        paths {
          "src/audit/**/*.ts"
        }
        conforms_to AuditStore
        on_change require shape_delta
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module], {
      changedFiles: ["src/audit/purge.ts"]
    });
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("governed source changed without shape delta");
    expect(output).toContain("src/audit/purge.ts");
    expect(output).toContain("AuditStoreImpl");
  });

  test("passes coverage with no-shape-change attestation", () => {
    const parsed = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
      }

      implementation AuditStoreImpl {
        paths {
          "src/audit/**/*.ts"
        }
        conforms_to AuditStore
        on_change require shape_delta
      }

      attest no_shape_change {
        source ts("src/audit/purge.ts")
        reason "renamed local variable only"
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module], {
      changedFiles: ["src/audit/purge.ts"]
    });

    expect(result.exitCode).toBe(0);
  });

  test("passes coverage when a change file references the governed source", () => {
    const base = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants Append<AuditEvent>
      }

      implementation AuditStoreImpl {
        paths {
          "src/audit/**/*.ts"
        }
        conforms_to AuditStore
        on_change require shape_delta
      }
    `);
    const change = parseShapeModule(`
      module changes.PR_003
      import audit

      change AddAppend {
        add fn AuditStore.appendEvent
          source ts("src/audit/store.ts#appendEvent")
          effects complete {
            Append<AuditEvent>
              evidence ts("src/audit/store.ts:8-14")
          }
      }
    `);

    expect(base.ok).toBe(true);
    expect(change.ok).toBe(true);
    if (!base.ok || !change.ok) {
      return;
    }

    const result = checkShapeModules([base.module, change.module], {
      changedFiles: ["src/audit/store.ts"]
    });

    expect(result.exitCode).toBe(0);
  });

  test("rejects forbidden dependency cycles with a witness path", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway : DataPlane {
        provides JsonRpcEndpoint
        requires PolicySnapshot via RuntimeCall
      }

      component PolicyService : ControlPlane {
        provides PolicySnapshot
        requires ContractRegistry via ControlPlaneDependency
      }

      component ContractRegistry : ControlPlane {
        requires Gateway via RuntimeCall
      }

      rule no_policy_decision_cycle {
        forbid cycle over requires where includes AuthorityDependency or RuntimeCall
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("forbidden dependency cycle");
    expect(output).toContain("Gateway -> PolicyService -> ContractRegistry -> Gateway");
    expect(output).toContain("RuntimeCall");
  });

  test("applies user-defined trait rules", () => {
    // noinspection RequiredAttributes
    const parsed = parseShapeModule(`
      module rules

      trait Immutable<T: Resource> {
      }

      resource LedgerEntry : Immutable

      component LedgerStore {
        owns LedgerEntry
        grants HardDelete<LedgerEntry>

        fn purgeEntry
          effects complete {
            HardDelete<LedgerEntry>
          }
      }

      rule immutable_forbids_delete<T: Resource> {
        when T has Immutable
        forbid final HardDelete<T>
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("LedgerEntry has trait Immutable");
    expect(output).toContain("Immutable forbids final HardDelete<LedgerEntry>");
    expect(output).toContain("rule immutable_forbids_delete forbids final HardDelete<T>");
  });

  test("applies user-defined provides exceptions", () => {
    const parsed = parseShapeModule(`
      module rules

      component Gateway {
        provides JsonRpcEndpoint
      }

      component PublicApi {
        provides JsonRpcEndpoint
      }

      rule gateway_only_rpc_ingress {
        forbid provides JsonRpcEndpoint except Gateway
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("PublicApi provides JsonRpcEndpoint");
    expect(output).toContain("except Gateway");
  });

  test("exposes shape trait and description facts in explain output", () => {
    const parsed = parseShapeModule(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : RequiresDescription
          description required "Policy decision branches remain local for auditability."
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale DerivePolicyDecisionDescription : ${contextRef("DescriptionRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "Reviewers need the local policy decision purpose."
        owner GatewayTeam
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module], { includeFacts: true });
    const explanation = explainShapeModules([parsed.module], "Gateway.derivePolicyDecision");

    expect(result.exitCode).toBe(0);
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "shape_trait",
        trait: "RequiresDescription",
        target: "Gateway.derivePolicyDecision"
      })
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "description",
        required: true,
        summary: "Policy decision branches remain local for auditability."
      })
    );
    expect(explanation).toContain("shape traits:");
    expect(explanation).toContain("RequiresDescription");
    expect(explanation).toContain("description:");
    expect(explanation).toContain(contextRef("DescriptionRationale", fnTarget("Gateway.derivePolicyDecision")));
  });

  test("enforces required rationale, descriptions, memory, guarded changes, and final forbids", async () => {
    const missingRationale = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/memory_guard_missing_rationale/audit.shape")
    ]);
    expect(missingRationale.exitCode).toBe(1);
    expect(formatDiagnostics(missingRationale)).toContain("missing required context");
    expect(formatDiagnostics(missingRationale)).toContain(contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision")));

    const preserveInline = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/memory_guard_preserve_inline/audit.shape")
    ]);
    expect(preserveInline.exitCode).toBe(0);

    const missingDescription = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/memory_guard_required_description_missing/audit.shape")
    ]);
    expect(missingDescription.exitCode).toBe(1);
    expect(formatDiagnostics(missingDescription)).toContain("missing required description");

    const descriptionPresent = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/memory_guard_required_description_present/audit.shape")
    ]);
    expect(descriptionPresent.exitCode).toBe(0);

    const hardFoughtMemory = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/memory_guard_hard_fought_unknown/audit.shape")
    ]);
    expect(hardFoughtMemory.exitCode).toBe(0);

    const guardedWithoutReevaluation = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/memory_guard_modify_without_reevaluation/audit.shape")
    ]);
    expect(guardedWithoutReevaluation.exitCode).toBe(1);
    expect(formatDiagnostics(guardedWithoutReevaluation)).toContain("guarded shape changed");
    expect(formatDiagnostics(guardedWithoutReevaluation)).toContain("reevaluation satisfying memory DoNotTouchDecisionShape");

    const guardedWithReevaluation = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/memory_guard_modify_with_reevaluation/audit.shape")
    ]);
    expect(guardedWithReevaluation.exitCode).toBe(0);

    const finalForbid = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/memory_guard_does_not_override_final_forbid/audit.shape")
    ]);
    expect(finalForbid.exitCode).toBe(1);
    expect(formatDiagnostics(finalForbid)).toContain("forbidden effect");
    expect(formatDiagnostics(finalForbid)).toContain("AppendOnly forbids final HardDelete<AuditEvent>");
  });

  test("rejects wrong and unknown context targets", async () => {
    const wrongTarget = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/memory_guard_wrong_target/audit.shape")
    ]);
    expect(wrongTarget.exitCode).toBe(1);
    expect(formatDiagnostics(wrongTarget)).toContain("context target mismatch");

    const unknownTarget = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/memory_guard_unknown_target/audit.shape")
    ]);
    expect(unknownTarget.exitCode).toBe(1);
    expect(formatDiagnostics(unknownTarget)).toContain("invalid context target");

    const memoryWrongTarget = parseShapeModule(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision
          effects complete {
            Read<PolicySnapshot>
          }

        fn otherDecision
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory DoNotTouchDecisionShape : ${contextRef("HardFoughtKnowledge", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.otherDecision
        status Unexplained
        confidence High
        summary "Previous refactors broke error normalisation."
        owner GatewayTeam
      }
    `);
    expect(memoryWrongTarget.ok).toBe(true);
    if (!memoryWrongTarget.ok) {
      return;
    }
    const memoryWrongTargetResult = checkShapeModules([memoryWrongTarget.module]);
    expect(memoryWrongTargetResult.exitCode).toBe(1);
    expect(formatDiagnostics(memoryWrongTargetResult)).toContain("context target mismatch");
  });

  test("requires SharpEdge memory and valid reevaluations", () => {
    const missingMemory = parseShapeModule(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn pollAttestation : SharpEdge
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    expect(missingMemory.ok).toBe(true);
    if (!missingMemory.ok) {
      return;
    }
    const missingMemoryResult = checkShapeModules([missingMemory.module]);
    expect(missingMemoryResult.exitCode).toBe(1);
    expect(formatDiagnostics(missingMemoryResult)).toContain(contextRef("HardFoughtKnowledge", fnTarget("Gateway.pollAttestation")));

    const invalidReevaluation = parseShapeModule(`
      module gateway

      reevaluation DecisionShapeRechecked {
        satisfies memory MissingMemory
        outcome Confirmed
        summary "Refactor preserves error-normalisation behaviour."
        evidence test("gateway/error-normalisation.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }
    `);
    expect(invalidReevaluation.ok).toBe(true);
    if (!invalidReevaluation.ok) {
      return;
    }
    const invalidReevaluationResult = checkShapeModules([invalidReevaluation.module]);
    expect(invalidReevaluationResult.exitCode).toBe(1);
    expect(formatDiagnostics(invalidReevaluationResult)).toContain("unknown satisfied memory");
  });

  test("rejects removing guarded functions without reevaluation", () => {
    const parsed = parseShapeModule(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : SharpEdge
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory DoNotTouchDecisionShape : ${contextRef("HardFoughtKnowledge", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        guards on_change require ${contextRef("ReEvaluation", "Self")}
        summary "Previous refactors broke error normalisation."
        owner GatewayTeam
      }

      change RemoveDecision {
        remove fn Gateway.derivePolicyDecision
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    expect(result.exitCode).toBe(1);
    expect(formatDiagnostics(result)).toContain("guarded shape changed");
  });
});

describe("Shape formatter", () => {
  test("canonicalizes declaration and member formatting", () => {
    const result = formatShapeSource(`
      module audit
      import zeta
      import alpha
      component AuditStore { grants Append<AuditEvent> owns AuditEvent fn appendEvent effects complete { Append<AuditEvent> evidence ts('src/audit/store.ts:8-14') } }
      resource AuditEvent : AppendOnly
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toBe(`module audit

import alpha

import zeta

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts:8-14")
    }
}
`);
  });

  test("formats memory guard syntax canonically", () => {
    const result = formatShapeSource(`
      reevaluation DecisionShapeRechecked { evidence test('gateway/error-normalisation.test.ts') decided_on '2026-06-02' reviewer GatewayTeam summary 'Refactor preserves behaviour.' outcome Confirmed satisfies memory DoNotTouchDecisionShape }
      memory DoNotTouchDecisionShape : ${contextRef("HardFoughtKnowledge", fnTarget("Gateway.derivePolicyDecision"))} { summary 'Previous refactors broke error normalisation.' guards on_change require ${contextRef("ReEvaluation", "Self")} confidence High status Unexplained applies_to fn Gateway.derivePolicyDecision owner GatewayTeam protects shape CheckOrder }
      rationale DerivePolicyDecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} { summary 'Policy checks remain inline for auditability.' owner GatewayTeam why CognitiveLocality applies_to fn Gateway.derivePolicyDecision }
      component Gateway { grants Read<PolicySnapshot> owns PolicySnapshot fn derivePolicyDecision : RequiresDescription, PreserveInline description required 'Policy decision branches remain local for auditability.' effects complete { Read<PolicySnapshot> } }
      resource PolicySnapshot
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toBe(`resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
  fn derivePolicyDecision : PreserveInline, RequiresDescription
    description required "Policy decision branches remain local for auditability."
    effects complete {
      Read<PolicySnapshot>
    }
}

rationale DerivePolicyDecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Policy checks remain inline for auditability."
  owner GatewayTeam
}

memory DoNotTouchDecisionShape : ${contextRef("HardFoughtKnowledge", fnTarget("Gateway.derivePolicyDecision"))} {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  summary "Previous refactors broke error normalisation."
  owner GatewayTeam
  protects shape CheckOrder
  guards on_change require ${contextRef("ReEvaluation", "Self")}
}

reevaluation DecisionShapeRechecked {
  satisfies memory DoNotTouchDecisionShape
  outcome Confirmed
  summary "Refactor preserves behaviour."
  reviewer GatewayTeam
  decided_on "2026-06-02"
  evidence test("gateway/error-normalisation.test.ts")
}
`);
  });
});

describe("Shape authoring assistant", () => {
  test("builds prompts that enforce explicit unknowns and evidence", () => {
    const prompt = buildShapeAuthorPrompt({
      changedFiles: ["src/audit/purge.ts"],
      diff: "diff --git a/src/audit/purge.ts b/src/audit/purge.ts"
    });
    const critic = buildShapeCriticPrompt({ changedFiles: ["src/audit/purge.ts"] }, "change Proposed {}");

    expect(prompt).toContain("Use effects unknown when uncertainty remains");
    expect(prompt).toContain("HardDelete");
    expect(prompt).toContain("If adding PreserveInline");
    expect(prompt).toContain("Do not use rationale or memory to waive final forbidden effects");
    expect(critic).toContain("Did the shape delta cover every governed changed file?");
    expect(critic).toContain("Did the delta touch a guarded target without reevaluation?");
  });

  test("generates a valid reviewable change scaffold", () => {
    const source = generateShapeDelta({
      moduleName: "changes.PR_001",
      changeName: "ReviewAuditChange",
      componentName: "AuditStore",
      changedFiles: ["src/audit/purge.ts"]
    });
    const parsed = parseShapeModule(source);

    expect(source).toContain("effects unknown");
    expect(source).toContain('source ts("src/audit/purge.ts")');
    expect(parsed.ok).toBe(true);
  });

  test("can generate an optional memory guard scaffold", () => {
    const source = generateShapeDelta({
      moduleName: "changes.PR_001",
      changeName: "ReviewAuditChange",
      componentName: "AuditStore",
      changedFiles: ["src/audit/purge.ts"],
      includeMemoryGuardScaffold: true
    });
    const parsed = parseShapeModule(source);

    expect(source).toContain(`memory ReviewChangedShape : ${contextRef("HardFoughtKnowledge", fnTarget("AuditStore.reviewPurgeShape1"))}`);
    expect(source).toContain("status Unexplained");
    expect(parsed.ok).toBe(true);
  });

  test("extracts evidence spans from unified diffs", () => {
    const spans = extractEvidenceSpansFromUnifiedDiff(`diff --git a/src/audit/purge.ts b/src/audit/purge.ts
--- a/src/audit/purge.ts
+++ b/src/audit/purge.ts
@@ -10,2 +10,3 @@
 context
+deleteAuditEvent()
+truncateAudit()
 unchanged
`);

    expect(spans).toEqual([
      {
        language: "ts",
        path: "src/audit/purge.ts",
        startLine: 11,
        endLine: 12
      }
    ]);
  });
});

describe("Shape editor support", () => {
  const source = `
    module audit

    resource AuditEvent : AppendOnly

    component AuditStore {
      owns AuditEvent
      grants Append<AuditEvent>

      fn appendEvent
        effects complete {
          Append<AuditEvent>
        }
    }
  `;

  test("returns diagnostics from the checker", () => {
    const diagnostics = getEditorDiagnostics(`
      resource AuditEvent : AppendOnly
      component AuditStore {
        owns AuditEvent
        fn mystery
          effects unknown
      }
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("unknown effects");
  });

  test("provides hover, definition, completions, and format-on-save", () => {
    expect(getHoverText(source, "AuditEvent")).toContain("kind: resource");
    expect(getHoverText(source, "PreserveInline")).toContain("InlineRationale");
    expect(getDefinitionLocation(source, "AuditStore")?.line).toBeGreaterThan(1);
    expect(getDefinitionLocation(`
      component Gateway {
        fn derivePolicyDecision
          effects unknown
      }

      rationale DerivePolicyDecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
      }
    `, "InlineRationale")?.line).toBeGreaterThan(1);
    expect(getCompletions(source, "Audit")).toContain("AuditStore.appendEvent");
    expect(getCompletions(source, "Preserve")).toContain("PreserveInline");

    const formatted = formatOnSave(source);
    expect(formatted.ok).toBe(true);
    if (formatted.ok) {
      expect(formatted.formatted).toContain("component AuditStore");
    }
  });
});

describe("Shape source analyzer", () => {
  test("detects destructive SQL and TypeScript hints", () => {
    // noinspection SqlNoDataSourceInspection
    const hints = [
      ...analyzeSourceText("db/audit/purge.sql", "DELETE FROM audit_events;\nTRUNCATE audit_events;"),
      ...analyzeSourceText("src/audit/purge.ts", "db.deleteFrom('audit_events').execute();")
    ];

    expect(hints.map((hint) => hint.effect)).toEqual(["HardDelete", "Truncate", "HardDelete"]);
  });

  test("warns when analyzer hints are missing from shape effects", () => {
    const parsed = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants Append<AuditEvent>

        fn appendEvent
          source ts("src/audit/store.ts#appendEvent")
          effects complete {
            Append<AuditEvent>
          }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const hints = analyzeSourceText("src/audit/store.ts", "db.deleteFrom('audit_events').execute();");
    const warnings = compareAnalyzerHintsToShape(hints, [parsed.module]);
    const output = formatAnalyzerWarnings(warnings);

    expect(warnings).toHaveLength(1);
    expect(output).toContain("missing from shape effects");
    expect(output).toContain("HardDelete");
  });
});
