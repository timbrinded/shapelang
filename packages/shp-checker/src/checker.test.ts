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
  graphAllShapeModules,
  graphShapeModules,
  parseShapeModule,
  statsShapeHypergraph
} from "./index.ts";

const repoRoot = resolve(import.meta.dir, "../../..");

function fnTarget(name: string): string {
  return `fn ${name}`;
}

function contextRef(contextType: string, target: string): string {
  return `${contextType}<${target}>`;
}

function checkShapeSource(source: string) {
  const parsed = parseShapeModule(source);
  if (!parsed.ok) {
    throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  return checkShapeModules([parsed.module]);
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

      memory DecisionRefactorConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
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
        satisfies memory DecisionRefactorConstraint
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
    expect(output).toContain('evidence: ts("src/audit/purge.ts:12-16")');
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

  test("applies change-file add relation operations before hypercycle checks", () => {
    const base = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }

      relation GatewayCallsAudit {
        kind calls
        connects Gateway -> AuditStore
      }

      rule no_calls_cycle {
        forbid hypercycle over calls
      }
    `);
    const change = parseShapeModule(`
      module changes.PR_005
      import deps

      change AddAuditCallsGateway {
        add relation AuditCallsGateway {
          kind calls
          connects AuditStore -> Gateway
        }
      }
    `);

    expect(base.ok).toBe(true);
    expect(change.ok).toBe(true);
    if (!base.ok || !change.ok) {
      return;
    }

    const result = checkShapeModules([base.module, change.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("forbidden hypercycle");
    expect(output).toContain("calls AuditCallsGateway");
  });

  test("applies change-file modify relation operations before hypercycle checks", () => {
    const base = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }
      component Sink {
      }

      relation GatewayCallsAudit {
        kind calls
        connects Gateway -> AuditStore
      }

      relation AuditCallsSink {
        kind calls
        connects AuditStore -> Sink
      }

      rule no_calls_cycle {
        forbid hypercycle over calls
      }
    `);
    const createsViolation = parseShapeModule(`
      module changes.PR_006
      import deps

      change RepointAuditCall {
        modify relation AuditCallsSink {
          kind calls
          connects AuditStore -> Gateway
        }
      }
    `);
    const removesViolation = parseShapeModule(`
      module changes.PR_007
      import deps

      change RepointAuditCallAway {
        modify relation GatewayCallsAudit {
          kind calls
          connects Gateway -> Sink
        }
      }
    `);

    expect(base.ok).toBe(true);
    expect(createsViolation.ok).toBe(true);
    expect(removesViolation.ok).toBe(true);
    if (!base.ok || !createsViolation.ok || !removesViolation.ok) {
      return;
    }

    const created = checkShapeModules([base.module, createsViolation.module]);
    expect(created.exitCode).toBe(1);
    expect(formatDiagnostics(created)).toContain("forbidden hypercycle");

    const cleared = checkShapeModules([
      base.module,
      createsViolation.module,
      removesViolation.module
    ]);
    expect(cleared.exitCode).toBe(0);
  });

  test("applies change-file remove relation operations before hypercycle checks", () => {
    const base = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }

      relation GatewayCallsAudit {
        kind calls
        connects Gateway -> AuditStore
      }

      relation AuditCallsGateway {
        kind calls
        connects AuditStore -> Gateway
      }

      rule no_calls_cycle {
        forbid hypercycle over calls
      }
    `);
    const change = parseShapeModule(`
      module changes.PR_008
      import deps

      change RemoveAuditCallsGateway {
        remove relation AuditCallsGateway
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
    expect(output).toContain("governed source changed without current Shape update");
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

    const result = checkShapeModules([{ module: parsed.module, filePath: "shape/audit.shape" }], {
      changedFiles: ["src/audit/purge.ts", "shape/audit.shape"]
    });

    expect(result.exitCode).toBe(0);
  });

  test("passes coverage with no-shape-change attestation from an absolute Shape path", () => {
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

    const result = checkShapeModules(
      [{ module: parsed.module, filePath: resolve(repoRoot, "shape/audit.shape") }],
      {
        changedFiles: ["src/audit/purge.ts", "shape/audit.shape"]
      }
    );

    expect(result.exitCode).toBe(0);
  });

  test("rejects stale no-shape-change attestation for current coverage", () => {
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

    const result = checkShapeModules([{ module: parsed.module, filePath: "shape/audit.shape" }], {
      changedFiles: ["src/audit/purge.ts"]
    });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toContain(
      "missing_shape_delta"
    );
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

    const result = checkShapeModules(
      [
        { module: base.module, filePath: "shape/audit.shape" },
        { module: change.module, filePath: "shape/changes/PR_003.shape" }
      ],
      {
        changedFiles: ["src/audit/store.ts", "shape/changes/PR_003.shape"]
      }
    );

    expect(result.exitCode).toBe(0);
  });

  test("passes coverage when an absolute change file references the governed source", () => {
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

    const result = checkShapeModules(
      [
        { module: base.module, filePath: resolve(repoRoot, "shape/audit.shape") },
        {
          module: change.module,
          filePath: resolve(repoRoot, "shape/changes/PR_003.shape")
        }
      ],
      {
        changedFiles: ["src/audit/store.ts", "shape/changes/PR_003.shape"]
      }
    );

    expect(result.exitCode).toBe(0);
  });

  test("rejects stale change-file source references for current coverage", () => {
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

    const result = checkShapeModules(
      [
        { module: base.module, filePath: "shape/audit.shape" },
        { module: change.module, filePath: "shape/changes/PR_003.shape" }
      ],
      {
        changedFiles: ["src/audit/store.ts"]
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toContain(
      "missing_shape_delta"
    );
  });

  test("enforces bindings between Shape-affecting code and docs", () => {
    const parsed = parseShapeModule(`
      module repo

      binding CheckerDocs {
        when_changed paths {
          "packages/shp-checker/src/checker.ts"
          "shape/checker.shape"
        }
        require_changed paths {
          "docs-site/src/content/docs/inside-shape/rule-evaluation.md"
          "docs-site/src/content/docs/reference/diagnostics.md"
        }
        allow attest docs_not_needed
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const missingDocs = checkShapeModules([parsed.module], {
      changedFiles: ["packages/shp-checker/src/checker.ts"]
    });
    expect(missingDocs.exitCode).toBe(1);
    expect(formatDiagnostics(missingDocs)).toContain("bound docs change missing");
    expect(formatDiagnostics(missingDocs)).toContain("CheckerDocs");

    const withDocs = checkShapeModules([parsed.module], {
      changedFiles: [
        "packages/shp-checker/src/checker.ts",
        "docs-site/src/content/docs/reference/diagnostics.md"
      ]
    });
    expect(withDocs.exitCode).toBe(0);

    const withAttestation = parseShapeModule(`
      module repo

      binding CheckerDocs {
        when_changed paths {
          "packages/shp-checker/src/checker.ts"
        }
        require_changed paths {
          "docs-site/src/content/docs/reference/diagnostics.md"
        }
        allow attest docs_not_needed
      }

      attest docs_not_needed {
        source ts("packages/shp-checker/src/checker.ts")
        reason "Internal extraction only; no documented behavior changed."
      }
    `);

    expect(withAttestation.ok).toBe(true);
    if (!withAttestation.ok) {
      return;
    }
    const staleAttestation = checkShapeModules(
      [{ module: withAttestation.module, filePath: "shape/changes/existing-waiver.shape" }],
      {
        changedFiles: ["packages/shp-checker/src/checker.ts"]
      }
    );
    expect(staleAttestation.exitCode).toBe(1);
    expect(staleAttestation.diagnostics.map((diagnostic) => diagnostic.kind)).toContain(
      "missing_bound_docs_change"
    );

    const attested = checkShapeModules(
      [{ module: withAttestation.module, filePath: "shape/changes/current-waiver.shape" }],
      {
        changedFiles: ["packages/shp-checker/src/checker.ts", "shape/changes/current-waiver.shape"]
      }
    );
    expect(attested.exitCode).toBe(0);
  });

  test("passes hypercycle_acyclic fixture", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/hypercycle_acyclic/deps.shape")
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("rejects hypercycle_calls fixture", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/hypercycle_calls/deps.shape")
    ]);
    const output = formatDiagnostics(result);
    expect(result.exitCode).toBe(1);
    expect(output).toContain("forbidden hypercycle");
    expect(output).toContain("calls GatewayCallsAudit");
  });

  test("rejects hypercycle_coordinated fixture", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/hypercycle_coordinated/deps.shape")
    ]);
    const output = formatDiagnostics(result);
    expect(result.exitCode).toBe(1);
    expect(output).toContain("forbidden hypercycle");
    expect(output).toContain("coordinated_call AuditWritePath");
  });

  test("rejects relation_unknown_endpoint fixture", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/relation_unknown_endpoint/deps.shape")
    ]);
    const output = formatDiagnostics(result);
    expect(result.exitCode).toBe(1);
    expect(output).toContain("unknown relation_endpoint");
    expect(output).toContain("GhostService");
  });

  test("rejects forbidden hypercycles with a witness path", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway : DataPlane {
      }

      component PolicyService : ControlPlane {
      }

      component ContractRegistry : ControlPlane {
      }

      relation GatewayCallsPolicy {
        kind calls
        connects Gateway -> PolicyService
      }

      relation PolicyCallsRegistry {
        kind calls
        connects PolicyService -> ContractRegistry
      }

      relation RegistryCallsGateway {
        kind calls
        connects ContractRegistry -> Gateway
      }

      rule no_policy_decision_cycle {
        forbid hypercycle over calls
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("forbidden hypercycle");
    expect(output).toContain(
      "witness: ContractRegistry -> Gateway -> PolicyService -> ContractRegistry"
    );
    expect(output).toContain("calls GatewayCallsPolicy");
  });

  test("detects hypercycles that span coordinated_call paths and binary calls", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }
      resource AuditEvent
      component ContractRegistry {
      }

      relation AuditWritePath {
        kind coordinated_call
        connects Gateway -> AuditStore -> AuditEvent
      }

      relation RegistryNotifiesGateway {
        kind calls
        connects ContractRegistry -> Gateway
      }

      relation AuditEventNotifiesRegistry {
        kind calls
        connects AuditEvent -> ContractRegistry
      }

      rule no_audit_loop {
        forbid hypercycle over coordinated_call or calls
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("forbidden hypercycle");
    expect(output).toContain("coordinated_call AuditWritePath");
    expect(output).toContain("calls AuditEventNotifiesRegistry");
    expect(output).toContain("calls RegistryNotifiesGateway");
  });

  test("rejects relations with fewer than two endpoints", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }

      relation SoloRelation {
        kind calls
        connects { Gateway }
      }
    `);

    // Grammar requires at least two connects entries; expect parse failure.
    expect(parsed.ok).toBe(false);
  });

  test("rejects relations with duplicate endpoints", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }

      relation SelfLoop {
        kind calls
        connects Gateway -> Gateway
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("invalid relation");
    expect(output).toContain("duplicate endpoint Gateway");
  });

  test("rejects relations whose binary kind has more than two endpoints", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }
      component ContractRegistry {
      }

      relation TooManyCallers {
        kind calls
        connects Gateway -> AuditStore -> ContractRegistry
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("invalid relation");
    expect(output).toContain("kind calls requires exactly two endpoints");
  });

  test("rejects unordered connects for ordered relation kinds", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }
      resource AuditEvent

      relation AuditWritePath {
        kind coordinated_call
        connects { Gateway, AuditStore, AuditEvent }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("invalid relation");
    expect(output).toContain("kind coordinated_call requires ordered connects");
  });

  test("rejects unordered connects for directional binary relation kinds", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }

      relation GatewayCallsAudit {
        kind calls
        connects { Gateway, AuditStore }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("invalid relation");
    expect(output).toContain("kind calls requires ordered connects");
  });

  test("rejects ambiguous component and resource relation endpoints", () => {
    const parsed = parseShapeModule(`
      module deps

      resource Node
      component Node {
      }
      component Other {
      }

      relation NodeCallsOther {
        kind calls
        connects Node -> Other
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("invalid relation");
    expect(output).toContain("endpoint Node resolves to both a component and a resource");
  });

  test("reports unknown forbid provides target and except names", () => {
    const parsed = parseShapeModule(`
      module deps

      resource JsonRpcEndpoint
      component Gateway {
      }

      rule gateway_only_rpc_ingress {
        forbid provides MissingEndpoint except MissingGateway
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("unknown resource");
    expect(output).toContain("MissingEndpoint");
    expect(output).toContain("unknown component");
    expect(output).toContain("MissingGateway");
  });

  test("rejects provides relations whose endpoints are not component to resource", () => {
    const parsed = parseShapeModule(`
      module deps

      resource AuditEvent
      component Gateway {
      }

      relation ReversedProvide {
        kind provides
        connects AuditEvent -> Gateway
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("provides provider AuditEvent must be a component");
    expect(output).toContain("provides target Gateway must be a resource");
  });

  test("emits hyperedge facts and rejects unresolved relation endpoints", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }

      relation GatewayCallsGhost {
        kind calls
        connects Gateway -> GhostService
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module], { includeFacts: true });
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("unknown relation_endpoint");
    expect(output).toContain("GhostService");
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "hyperedge",
        name: "GatewayCallsGhost",
        relationKind: "calls"
      })
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "hyperedge_member",
        hyperedge: "GatewayCallsGhost",
        endpoint: "Gateway",
        index: 0
      })
    );
  });

  test("forbid hypercycle over KIND restricts traversal to that kind's subgraph", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }
      resource AuditEvent

      relation GatewayProvidesAudit {
        kind provides
        connects Gateway -> AuditEvent
      }

      relation AuditCallsGateway {
        kind calls
        connects AuditEvent -> Gateway
      }

      rule no_call_cycle {
        forbid hypercycle over calls
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(0);
    expect(output).not.toContain("forbidden hypercycle");
  });

  test("forbid hypercycle over multiple kinds detects cycles that span those kinds", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }
      resource AuditEvent

      relation GatewayProvidesAudit {
        kind provides
        connects Gateway -> AuditEvent
      }

      relation AuditCallsGateway {
        kind calls
        connects AuditEvent -> Gateway
      }

      rule no_runtime_cycle {
        forbid hypercycle over calls or provides
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("forbidden hypercycle");
    expect(output).toContain("provides GatewayProvidesAudit");
    expect(output).toContain("calls AuditCallsGateway");
  });

  test("rejects relation roles that are not connects endpoints", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }

      relation GatewayCallsAudit {
        kind calls
        connects Gateway -> AuditStore
        roles { GhostService as callee }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("invalid relation");
    expect(output).toContain("role GhostService is not a connects endpoint");
  });

  test("rejects duplicate role entries for the same endpoint", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }

      relation GatewayCallsAudit {
        kind calls
        connects Gateway -> AuditStore
        roles { Gateway as caller, Gateway as callee }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("invalid relation");
    expect(output).toContain("duplicate role for Gateway");
  });

  test("rejects relations with duplicate kind declarations", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }

      relation GatewayLink {
        kind calls
        kind provides
        connects Gateway -> AuditStore
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("invalid relation");
    expect(output).toContain("duplicate kind");
  });

  test("rejects relations with duplicate summary declarations", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }

      relation GatewayCallsAudit {
        kind calls
        connects Gateway -> AuditStore
        summary "first"
        summary "second"
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("invalid relation");
    expect(output).toContain("duplicate summary");
  });

  test("rejects relations with duplicate roles blocks", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }

      relation GatewayCallsAudit {
        kind calls
        connects Gateway -> AuditStore
        roles { Gateway as caller }
        roles { AuditStore as callee }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("invalid relation");
    expect(output).toContain("duplicate roles");
  });

  test("statsShapeHypergraph reports vertex, hyperedge, and incidence counts", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }
      component Loner {
      }
      resource AuditEvent

      relation AuditWritePath {
        kind coordinated_call
        connects Gateway -> AuditStore -> AuditEvent
      }

      relation GatewayCallsAudit {
        kind calls
        connects Gateway -> AuditStore
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const stats = statsShapeHypergraph([parsed.module]);
    expect(stats).toContain("Hypergraph stats");
    expect(stats).toContain("vertices: 4 (3 components, 1 resource)");
    expect(stats).toContain("hyperedges: 2");
    expect(stats).toContain("calls: 1");
    expect(stats).toContain("coordinated_call: 1");
    expect(stats).toContain("incidences: 5");
    expect(stats).toContain("arity: min 2, max 3, avg 2.50");
    expect(stats).toContain("widest: coordinated_call AuditWritePath");
    expect(stats).toContain("isolated vertices: 1");
    expect(stats).toContain("Loner (component)");

    const callsOnly = statsShapeHypergraph([parsed.module], "calls");
    expect(callsOnly).toContain("filter: kind=calls");
    expect(callsOnly).toContain("hyperedges: 1 (of 2 total)");
    expect(callsOnly).toContain("calls: 1");
    expect(callsOnly).not.toContain("coordinated_call: 1");
    expect(callsOnly).toContain("incidences: 2");
    expect(callsOnly).toContain("isolated vertices: 2");
  });

  test("graphAllShapeModules prints the whole hypergraph grouped by kind", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }
      resource AuditEvent

      relation AuditWritePath {
        kind coordinated_call
        connects Gateway -> AuditStore -> AuditEvent
      }

      relation GatewayCallsAudit {
        kind calls
        connects Gateway -> AuditStore
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const all = graphAllShapeModules([parsed.module]);
    expect(all).toContain("Hypergraph");
    expect(all).toContain("calls:");
    expect(all).toContain("coordinated_call:");
    expect(all).toContain("calls GatewayCallsAudit: Gateway (component) -> AuditStore (component)");
    expect(all).toContain(
      "coordinated_call AuditWritePath: Gateway (component) -> AuditStore (component) -> AuditEvent (resource)"
    );

    const onlyCalls = graphAllShapeModules([parsed.module], "calls");
    expect(onlyCalls).toContain("calls GatewayCallsAudit:");
    expect(onlyCalls).not.toContain("coordinated_call AuditWritePath:");

    const emptyFiltered = graphAllShapeModules([parsed.module], "no_such_kind");
    expect(emptyFiltered).toContain("No relations match kind no_such_kind.");
  });

  test("shp graph prints hyperedge incidence for components and resources", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }
      resource AuditEvent

      relation AuditWritePath {
        kind coordinated_call
        connects Gateway -> AuditStore -> AuditEvent
      }

      relation GatewayCallsAudit {
        kind calls
        connects Gateway -> AuditStore
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const gatewayGraph = graphShapeModules([parsed.module], "Gateway");
    expect(gatewayGraph).toContain("Gateway (component)");
    expect(gatewayGraph).toContain("coordinated_call AuditWritePath:");
    expect(gatewayGraph).toContain(
      "Gateway (component) -> AuditStore (component) -> AuditEvent (resource)"
    );
    expect(gatewayGraph).toContain("calls GatewayCallsAudit:");

    const filtered = graphShapeModules([parsed.module], "Gateway", "calls");
    expect(filtered).toContain("calls GatewayCallsAudit:");
    expect(filtered).not.toContain("coordinated_call AuditWritePath:");

    const resourceGraph = graphShapeModules([parsed.module], "AuditEvent");
    expect(resourceGraph).toContain("AuditEvent (resource)");
    expect(resourceGraph).toContain("coordinated_call AuditWritePath:");
  });

  test("custom relation kinds appear in graph and stats but do not create hypercycles", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }

      relation GatewayWiresAudit {
        kind wiring
        connects Gateway -> AuditStore
      }

      relation AuditWiresGateway {
        kind wiring
        connects AuditStore -> Gateway
      }

      rule no_unknown_cycles {
        forbid hypercycle
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);
    const graph = graphAllShapeModules([parsed.module]);
    const stats = statsShapeHypergraph([parsed.module]);

    expect(result.exitCode).toBe(0);
    expect(output).not.toContain("forbidden hypercycle");
    expect(graph).toContain("wiring GatewayWiresAudit:");
    expect(graph).toContain("wiring AuditWiresGateway:");
    expect(stats).toContain("wiring: 2");
  });

  test("preserves relation roles in facts, explain output, and graph output", () => {
    const parsed = parseShapeModule(`
      module deps

      component Gateway {
      }
      component AuditStore {
      }

      relation GatewayCallsAudit {
        kind calls
        connects Gateway -> AuditStore
        roles { Gateway as caller, AuditStore as callee }
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module], { includeFacts: true });
    const explanation = explainShapeModules([parsed.module], "GatewayCallsAudit");
    const graph = graphShapeModules([parsed.module], "Gateway");

    expect(result.exitCode).toBe(0);
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "hyperedge_member",
        hyperedge: "GatewayCallsAudit",
        endpoint: "Gateway",
        role: "caller"
      })
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "hyperedge_member",
        hyperedge: "GatewayCallsAudit",
        endpoint: "AuditStore",
        role: "callee"
      })
    );
    expect(explanation).toContain("0: Gateway as caller");
    expect(explanation).toContain("1: AuditStore as callee");
    expect(graph).toContain("Gateway (component) as caller -> AuditStore (component) as callee");
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

  test("applies user-defined provides exceptions over provides hyperedges", () => {
    const parsed = parseShapeModule(`
      module rules

      component Gateway {
      }

      component PublicApi {
      }

      resource JsonRpcEndpoint

      relation GatewayProvidesRpc {
        kind provides
        connects Gateway -> JsonRpcEndpoint
      }

      relation PublicApiProvidesRpc {
        kind provides
        connects PublicApi -> JsonRpcEndpoint
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
    expect(output).toContain("relation PublicApiProvidesRpc");
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
    expect(explanation).toContain(
      contextRef("DescriptionRationale", fnTarget("Gateway.derivePolicyDecision"))
    );
  });

  test("enforces required rationale, descriptions, memory, guarded changes, and final forbids", async () => {
    const missingRationale = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/memory_guard_missing_rationale/audit.shape")
    ]);
    expect(missingRationale.exitCode).toBe(1);
    expect(formatDiagnostics(missingRationale)).toContain("missing required context");
    expect(formatDiagnostics(missingRationale)).toContain(
      contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))
    );

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

    const refactorConstraintMemory = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/memory_guard_refactor_constraint_unknown/audit.shape")
    ]);
    expect(refactorConstraintMemory.exitCode).toBe(0);

    const guardedWithoutReevaluation = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/memory_guard_modify_without_reevaluation/audit.shape")
    ]);
    expect(guardedWithoutReevaluation.exitCode).toBe(1);
    expect(formatDiagnostics(guardedWithoutReevaluation)).toContain("guarded shape changed");
    expect(formatDiagnostics(guardedWithoutReevaluation)).toContain(
      "reevaluation satisfying memory DecisionRefactorConstraint"
    );

    const guardedWithReevaluation = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/memory_guard_modify_with_reevaluation/audit.shape")
    ]);
    expect(guardedWithReevaluation.exitCode).toBe(0);

    const finalForbid = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/memory_guard_does_not_override_final_forbid/audit.shape")
    ]);
    expect(finalForbid.exitCode).toBe(1);
    expect(formatDiagnostics(finalForbid)).toContain("forbidden effect");
    expect(formatDiagnostics(finalForbid)).toContain(
      "AppendOnly forbids final HardDelete<AuditEvent>"
    );
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

      memory DecisionRefactorConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
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

  test("requires RefactorSensitive memory and valid reevaluations", () => {
    const missingMemory = parseShapeModule(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn pollAttestation : RefactorSensitive
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
    expect(formatDiagnostics(missingMemoryResult)).toContain(
      contextRef("RefactorConstraint", fnTarget("Gateway.pollAttestation"))
    );

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

        fn derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory DecisionRefactorConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
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

describe("Shape memory guard intent scenarios", () => {
  test("requires rationale when inline policy shape is review intent", () => {
    const missingRationale = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : PreserveInline
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const missingOutput = formatDiagnostics(missingRationale);

    expect(missingRationale.exitCode).toBe(1);
    expect(missingOutput).toContain("missing required context");
    expect(missingOutput).toContain(
      contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))
    );

    const withRationale = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : PreserveInline
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale DerivePolicyDecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "Reviewers inspect the full authorization branch locally."
        owner GatewayTeam
      }
    `);

    expect(withRationale.exitCode).toBe(0);
  });

  test("protects check order when effects are unchanged by reordering", () => {
    const guardedWithoutReevaluation = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : ProtectedCheckOrder
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale PolicyCheckOrderMatters : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "The order controls which failure is visible to callers."
        owner GatewayTeam
        protects shape CheckOrder
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      change ReorderPolicyChecks {
        modify fn Gateway.derivePolicyDecision
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const guardedOutput = formatDiagnostics(guardedWithoutReevaluation);

    expect(guardedWithoutReevaluation.exitCode).toBe(1);
    expect(guardedOutput).toContain("guarded shape changed");
    expect(guardedOutput).toContain("rationale PolicyCheckOrderMatters");

    const guardedWithReevaluation = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : ProtectedCheckOrder
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale PolicyCheckOrderMatters : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "The order controls which failure is visible to callers."
        owner GatewayTeam
        protects shape CheckOrder
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      reevaluation PolicyCheckOrderRechecked {
        satisfies rationale PolicyCheckOrderMatters
        outcome Confirmed
        summary "The modified implementation preserves visible failure ordering."
        evidence test("gateway/policy-check-order.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }

      change ReorderPolicyChecks {
        modify fn Gateway.derivePolicyDecision
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);

    expect(guardedWithReevaluation.exitCode).toBe(0);
  });

  test("requires memory for refactor-sensitive implementation shape", () => {
    const missingMemory = checkShapeSource(`
      module bridge

      resource Attestation

      component BridgePoller {
        owns Attestation
        grants Read<Attestation>

        fn pollAttestation : RefactorSensitive
          effects complete {
            Read<Attestation>
          }
      }
    `);
    const missingOutput = formatDiagnostics(missingMemory);

    expect(missingMemory.exitCode).toBe(1);
    expect(missingOutput).toContain(
      contextRef("RefactorConstraint", fnTarget("BridgePoller.pollAttestation"))
    );

    const withMemory = checkShapeSource(`
      module bridge

      resource Attestation

      component BridgePoller {
        owns Attestation
        grants Read<Attestation>

        fn pollAttestation : RefactorSensitive
          effects complete {
            Read<Attestation>
          }
      }

      memory BridgePollingDelayConstraint : ${contextRef("RefactorConstraint", fnTarget("BridgePoller.pollAttestation"))} {
        applies_to fn BridgePoller.pollAttestation
        status Unexplained
        confidence High
        summary "Shorter polling previously caused intermittent settlement misses."
        owner BridgeTeam
      }
    `);

    expect(withMemory.exitCode).toBe(0);
  });

  test("requires design memory for intentional non-idiomatic code", () => {
    const missingRationale = checkShapeSource(`
      module gateway

      resource VendorPayload

      component Gateway {
        owns VendorPayload
        grants Read<VendorPayload>

        fn normalizeVendorPayload : NonIdiomatic
          effects complete {
            Read<VendorPayload>
          }
      }
    `);
    const missingOutput = formatDiagnostics(missingRationale);

    expect(missingRationale.exitCode).toBe(1);
    expect(missingOutput).toContain(
      contextRef("DesignRationale", fnTarget("Gateway.normalizeVendorPayload"))
    );

    const withRationale = checkShapeSource(`
      module gateway

      resource VendorPayload

      component Gateway {
        owns VendorPayload
        grants Read<VendorPayload>

        fn normalizeVendorPayload : NonIdiomatic
          effects complete {
            Read<VendorPayload>
          }
      }

      rationale VendorPayloadCompatibility : ${contextRef("DesignRationale", fnTarget("Gateway.normalizeVendorPayload"))} {
        applies_to fn Gateway.normalizeVendorPayload
        why VendorLimitation
        summary "The odd field order mirrors the upstream protocol contract."
        owner GatewayTeam
      }
    `);

    expect(withRationale.exitCode).toBe(0);
  });

  test("requires purpose context for test-only production-shaped helpers", () => {
    const missingPurpose = checkShapeSource(`
      module audit

      resource AuditEvent

      component ReplayHarness {
        owns AuditEvent
        grants Append<AuditEvent>

        fn seedReplayFixture : TestOnly
          effects complete {
            Append<AuditEvent>
          }
      }
    `);
    const missingOutput = formatDiagnostics(missingPurpose);

    expect(missingPurpose.exitCode).toBe(1);
    expect(missingOutput).toContain(
      contextRef("TestOnlyPurpose", fnTarget("ReplayHarness.seedReplayFixture"))
    );

    const withPurpose = checkShapeSource(`
      module audit

      resource AuditEvent

      component ReplayHarness {
        owns AuditEvent
        grants Append<AuditEvent>

        fn seedReplayFixture : TestOnly
          effects complete {
            Append<AuditEvent>
          }
      }

      rationale ReplayFixturePurpose : ${contextRef("TestOnlyPurpose", fnTarget("ReplayHarness.seedReplayFixture"))} {
        applies_to fn ReplayHarness.seedReplayFixture
        why E2ETesting
        summary "This helper only builds replay fixtures for e2e tests."
        owner AuditTeam
      }
    `);

    expect(withPurpose.exitCode).toBe(0);
  });

  test("requires a non-empty description when shape depends on local explanation", () => {
    const emptyDescription = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : RequiresDescription
          description required ""
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale PolicyDecisionDescription : ${contextRef("DescriptionRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "Reviewers need the local policy decision purpose."
        owner GatewayTeam
      }
    `);
    const emptyOutput = formatDiagnostics(emptyDescription);

    expect(emptyDescription.exitCode).toBe(1);
    expect(emptyOutput).toContain("missing required description");

    const withDescription = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : RequiresDescription
          description required "Builds the visible authorization decision from policy state."
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale PolicyDecisionDescription : ${contextRef("DescriptionRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "Reviewers need the local policy decision purpose."
        owner GatewayTeam
      }
    `);

    expect(withDescription.exitCode).toBe(0);
  });

  test("does not let invalid reevaluation unlock guarded changes", () => {
    const invalidReevaluation = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>

        fn derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory DecisionRefactorConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        summary "Previous refactors broke error normalisation."
        owner GatewayTeam
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      reevaluation IncompleteReview {
        satisfies memory DecisionRefactorConstraint
        outcome Confirmed
        summary "The refactor looks equivalent."
      }

      change RefactorDecision {
        modify fn Gateway.derivePolicyDecision
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const output = formatDiagnostics(invalidReevaluation);

    expect(invalidReevaluation.exitCode).toBe(1);
    expect(output).toContain("invalid reevaluation");
    expect(output).toContain("missing evidence");
    expect(output).toContain("missing reviewer");
    expect(output).toContain("missing decided_on");
    expect(output).toContain("guarded shape changed");
  });

  test("does not allow memory to waive final forbidden effects", () => {
    const result = checkShapeSource(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>

        fn purgeOldEvents : RefactorSensitive
          effects complete {
            HardDelete<AuditEvent>
          }
      }

      memory PurgeDeleteConstraint : ${contextRef("RefactorConstraint", fnTarget("AuditStore.purgeOldEvents"))} {
        applies_to fn AuditStore.purgeOldEvents
        status Explained
        confidence High
        summary "This behavior is documented but still violates final storage policy."
        owner AuditTeam
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("forbidden effect");
    expect(output).toContain("AppendOnly forbids final HardDelete<AuditEvent>");
  });
});

describe("Shape formatter", () => {
  test("canonicalizes relation declarations", () => {
    const result = formatShapeSource(`
      module deps
      relation AuditWritePath { summary 'Audit write path.' connects Gateway -> AuditStore -> AuditEvent kind coordinated_call }
      relation GatewayProvidesRpc { connects Gateway -> JsonRpcEndpoint kind provides }
      component Gateway { }
      component AuditStore { }
      resource AuditEvent
      resource JsonRpcEndpoint
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toBe(`module deps

resource AuditEvent

resource JsonRpcEndpoint

component AuditStore {
}

component Gateway {
}

relation AuditWritePath {
  kind coordinated_call
  connects Gateway -> AuditStore -> AuditEvent
  summary "Audit write path."
}

relation GatewayProvidesRpc {
  kind provides
  connects Gateway -> JsonRpcEndpoint
}
`);
  });

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
      reevaluation DecisionShapeRechecked { evidence test('gateway/error-normalisation.test.ts') decided_on '2026-06-02' reviewer GatewayTeam summary 'Refactor preserves behaviour.' outcome Confirmed satisfies memory DecisionRefactorConstraint }
      memory DecisionRefactorConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} { summary 'Previous refactors broke error normalisation.' guards on_change require ${contextRef("ReEvaluation", "Self")} confidence High status Unexplained applies_to fn Gateway.derivePolicyDecision owner GatewayTeam protects shape CheckOrder }
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

memory DecisionRefactorConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  summary "Previous refactors broke error normalisation."
  owner GatewayTeam
  protects shape CheckOrder
  guards on_change require ${contextRef("ReEvaluation", "Self")}
}

reevaluation DecisionShapeRechecked {
  satisfies memory DecisionRefactorConstraint
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
    const critic = buildShapeCriticPrompt(
      { changedFiles: ["src/audit/purge.ts"] },
      "change Proposed {}"
    );

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

    expect(source).toContain(
      `memory ReviewChangedShape : ${contextRef("RefactorConstraint", fnTarget("AuditStore.reviewPurgeShape1"))}`
    );
    expect(source).toContain("status Unexplained");
    expect(parsed.ok).toBe(true);
  });

  test("extracts evidence spans from unified diffs", () => {
    const spans =
      extractEvidenceSpansFromUnifiedDiff(`diff --git a/src/audit/purge.ts b/src/audit/purge.ts
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
    expect(
      getDefinitionLocation(
        `
      component Gateway {
        fn derivePolicyDecision
          effects unknown
      }

      rationale DerivePolicyDecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
      }
    `,
        "InlineRationale"
      )?.line
    ).toBeGreaterThan(1);
    expect(getCompletions(source, "Audit")).toContain("AuditStore.appendEvent");
    expect(getCompletions(source, "Preserve")).toContain("PreserveInline");
    expect(getCompletions(source, "requ")).toContain("requires");
    expect(getCompletions(source, "call")).toEqual(expect.arrayContaining(["calls", "callbacks"]));
    expect(getCompletions(source, "coord")).toContain("coordinated_call");

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
      ...analyzeSourceText(
        "db/audit/purge.sql",
        "DELETE FROM audit_events;\nTRUNCATE audit_events;"
      ),
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

    const hints = analyzeSourceText(
      "src/audit/store.ts",
      "db.deleteFrom('audit_events').execute();"
    );
    const warnings = compareAnalyzerHintsToShape(hints, [parsed.module]);
    const output = formatAnalyzerWarnings(warnings);

    expect(warnings).toHaveLength(1);
    expect(output).toContain("missing from shape effects");
    expect(output).toContain("HardDelete");
  });
});
