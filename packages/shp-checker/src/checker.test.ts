import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
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
  generateShapeUpdateDraft,
  getCompletions,
  getDefinitionLocation,
  getEditorDiagnostics,
  getHoverText,
  explainShapeModules,
  formatDiagnostics,
  generateShapeFromAstJson,
  graphAllShapeModules,
  graphShapeModules,
  parseShapeModule,
  statsShapeHypergraph,
  type SourceSpan
} from "./index.ts";
import {
  buildCodeSemanticGraphFromAstJson,
  BUNDLED_TREE_SITTER_LANGUAGES,
  bundledTreeSitterParserLibsDir,
  configureBundledTreeSitterParsers,
  generateShapeFromCodeSemanticGraph,
  parseSourceFilesToCodeSemanticGraph,
  treeSitterParserLibraryName,
  type CodeAstAnchor,
  type CodeSemanticGraph
} from "./ast-generation-core.ts";
import { PRELUDE_CONTEXT_REQUIREMENTS, PRELUDE_RELATION_KIND_NAMES } from "./prelude.ts";
import { detectLinuxMuslRuntime } from "./ast-generation.ts";

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

function requireGeneratedOutput(result: ReturnType<typeof generateShapeFromCodeSemanticGraph>) {
  if (!result.ok) {
    throw new Error(formatAstTestDiagnostics(result.diagnostics));
  }
  return result.value;
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

  test("parses effect candidate declarations", () => {
    const parsed = parseShapeModule(`
      module shape.generated.ast.audit

      resource AuditEvent
      resource AuditStoreAppendEventAstAnchor {
        fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }

      component AuditStore {
        fn appendEvent
          effects unknown
      }

      effect candidate AppendEventCandidate {
        fn AuditStore.appendEvent
        effect Append<AuditEvent>
        source ts("src/audit/store.ts:8-14")
        confidence low
        pin AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }
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
  test("keeps declarations module scoped and resolves imports explicitly", () => {
    const left = parseShapeModule(`
      module left
      resource Shared
    `);
    const right = parseShapeModule(`
      module right
      resource Shared
    `);
    const consumer = parseShapeModule(`
      module consumer
      import left

      component Reader {
        owns Shared
        grants Read<Shared>
        fn readShared
          effects complete {
            Read<Shared>
          }
      }
    `);

    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    expect(consumer.ok).toBe(true);
    if (!left.ok || !right.ok || !consumer.ok) {
      return;
    }

    const result = checkShapeModules([left.module, right.module, consumer.module], {
      includeFacts: true
    });

    expect(result.exitCode).toBe(0);
    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: "resource", name: "left::Shared" })
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({ kind: "resource", name: "right::Shared" })
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "owns",
        component: "consumer::Reader",
        resource: "left::Shared"
      })
    );
  });

  test("rejects ambiguous imports before formatter import sorting can choose a winner", () => {
    const left = parseShapeModule(`
      module left
      resource Shared
    `);
    const right = parseShapeModule(`
      module right
      resource Shared
    `);
    const consumerSource = `
      module consumer
      import right
      import left

      component Reader {
        owns Shared
        grants Read<Shared>
        fn readShared
          effects complete {
            Read<Shared>
          }
      }
    `;
    const formatted = formatShapeSource(consumerSource);

    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    expect(formatted.ok).toBe(true);
    if (!left.ok || !right.ok || !formatted.ok) {
      return;
    }

    const consumer = parseShapeModule(formatted.formatted);
    expect(consumer.ok).toBe(true);
    if (!consumer.ok) {
      return;
    }

    const result = checkShapeModules([left.module, right.module, consumer.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "ambiguous_name", name: "Shared" })
    );
    expect(output).toContain("matches: left::Shared, right::Shared");
  });

  test("accepts module-qualified function targets and resource refs in change declarations", () => {
    const base = parseShapeModule(`
      module audit
      resource Event
      component Store {
        grants Read<Event>
        fn fetch
          effects complete {
            Read<Event>
          }
      }
    `);
    const change = parseShapeModule(`
      module audit.update
      change RecheckStoreFetch {
        modify fn audit::Store.fetch
          effects complete {
            Read<audit::Event>
          }
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

  test("lowers effect candidate facts and trusts generated AST unknown effects only from explicit origin", async () => {
    const parsed = parseShapeModule(`
      module shape.generated.ast.audit

      resource AuditEvent
      resource AuditStoreAppendEventAstAnchor {
        fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }

      component AuditStore {
        fn appendEvent
          source ts("src/audit/store.ts:8-14")
          effects unknown
      }

      effect candidate AppendEventCandidate {
        fn AuditStore.appendEvent
        effect Append<AuditEvent>
        source ts("src/audit/store.ts:8-14")
        confidence low
        pin AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const untrusted = checkShapeModules(
      [{ module: parsed.module, filePath: "shape/generated/ast/audit.shape" }],
      { includeFacts: true }
    );
    expect(untrusted.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "unknown_effects" })
    );

    expect(untrusted.facts).toContainEqual(
      expect.objectContaining({
        kind: "candidate_effect",
        name: "shape.generated.ast.audit::AppendEventCandidate",
        functionTarget: "shape.generated.ast.audit::AuditStore.appendEvent",
        effect: "Append",
        target: "shape.generated.ast.audit::AuditEvent",
        anchor: "shape.generated.ast.audit::AuditStoreAppendEventAstAnchor"
      })
    );

    const explicitOrigin = checkShapeModules(
      [
        {
          module: parsed.module,
          filePath: "shape/generated/ast/audit.shape",
          origin: "generated_ast"
        }
      ],
      { includeFacts: true }
    );
    expect(
      explicitOrigin.diagnostics.some((diagnostic) => diagnostic.kind === "unknown_effects")
    ).toBe(false);
    expect(explicitOrigin.facts?.some((fact) => fact.kind === "shape_update_for")).toBe(false);

    const checkedFile = await checkShapeFiles(
      [resolve(repoRoot, "shape/generated/ast/fixtures/source/audit_store.shape")],
      { includeFacts: true }
    );
    expect(checkedFile.exitCode).toBe(0);
    expect(checkedFile.facts).toContainEqual(
      expect.objectContaining({
        kind: "candidate_effect",
        name: "shape.generated.ast.fixtures.generated_source.audit_store::AppendEventAppendAuditEventCandidateEffect",
        functionTarget:
          "shape.generated.ast.fixtures.generated_source.audit_store::AuditStore.appendEvent",
        effect: "Append",
        target: "shape.generated.ast.fixtures.generated_source.audit_store::AuditEvent",
        anchor:
          "shape.generated.ast.fixtures.generated_source.audit_store::AuditStoreAppendEventAstAnchor"
      })
    );
    expect(checkedFile.facts?.some((fact) => fact.kind === "shape_update_for")).toBe(false);
  });

  test("rejects duplicate and missing candidate effect fields", () => {
    const duplicate = checkShapeSource(`
      module generated
      resource AuditEvent
      resource Anchor {
        fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }
      component AuditStore {
        grants Append<AuditEvent>
        fn appendEvent
          effects complete {
            Append<AuditEvent>
          }
      }
      effect candidate DuplicateCandidate {
        fn AuditStore.appendEvent
        effect Append<AuditEvent>
        effect Read<AuditEvent>
        source ts("src/audit/store.ts")
        confidence low
        pin Anchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }
    `);
    const missing = checkShapeSource(`
      module generated
      resource AuditEvent
      component AuditStore {
        fn appendEvent
          effects unknown
      }
      effect candidate MissingCandidate {
        fn AuditStore.appendEvent
        effect Append<AuditEvent>
      }
    `);

    expect(formatDiagnostics(duplicate)).toContain(
      "candidate effect generated::DuplicateCandidate: duplicate effect"
    );
    expect(formatDiagnostics(missing)).toContain(
      "candidate effect generated::MissingCandidate: missing source"
    );
    expect(formatDiagnostics(missing)).toContain(
      "candidate effect generated::MissingCandidate: missing confidence"
    );
    expect(formatDiagnostics(missing)).toContain(
      "candidate effect generated::MissingCandidate: missing pin"
    );
  });

  test("rejects stale candidate effect pin fingerprints", () => {
    const result = checkShapeSource(`
      module generated
      resource AuditEvent
      resource Anchor {
        fingerprint ast.semantic_subtree_v1("sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
      }
      component AuditStore {
        grants Append<AuditEvent>
        fn appendEvent
          effects complete {
            Append<AuditEvent>
          }
      }
      effect candidate StalePin {
        fn AuditStore.appendEvent
        effect Append<AuditEvent>
        source ts("src/audit/store.ts")
        confidence low
        pin Anchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "candidate_pin_fingerprint_mismatch",
        candidateEffect: "generated::StalePin",
        anchor: "generated::Anchor"
      })
    );
    expect(output).toContain("stale candidate effect pin");
    expect(output).toContain("candidate effect generated::StalePin pins generated::Anchor");
  });

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

  test("resolves concrete trait forbid targets in named modules", () => {
    const parsed = parseShapeModule(`
      module audit

      trait Protected {
        forbid final HardDelete<AuditEvent>
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

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("AuditEvent has trait Protected");
    expect(output).toContain("Protected forbids final HardDelete<AuditEvent>");
  });

  test("resolves imported concrete rule forbid targets", () => {
    const domain = parseShapeModule(`
      module domain

      trait Protected {
      }

      resource AuditEvent : Protected
    `);
    const policy = parseShapeModule(`
      module policy
      import domain

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>
        fn purgeOldEvents
          effects complete {
            HardDelete<AuditEvent>
          }
      }

      rule protected_events_are_not_deleted {
        when T has Protected
        forbid final HardDelete<AuditEvent>
      }
    `);

    expect(domain.ok).toBe(true);
    expect(policy.ok).toBe(true);
    if (!domain.ok || !policy.ok) {
      return;
    }

    const result = checkShapeModules([domain.module, policy.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("AuditEvent has trait Protected");
    expect(output).toContain("Protected forbids final HardDelete<AuditEvent>");
  });

  test("rejects unknown and ambiguous concrete forbid targets", () => {
    const unknown = parseShapeModule(`
      module policy

      trait Broken {
        forbid final HardDelete<MissingEvent>
      }
    `);
    expect(unknown.ok).toBe(true);
    if (!unknown.ok) {
      return;
    }
    const unknownResult = checkShapeModules([unknown.module]);
    expect(unknownResult.exitCode).toBe(1);
    expect(formatDiagnostics(unknownResult)).toContain("resource MissingEvent is referenced");

    const left = parseShapeModule("module left\nresource AuditEvent");
    const right = parseShapeModule("module right\nresource AuditEvent");
    const ambiguous = parseShapeModule(`
      module policy
      import left
      import right

      trait Broken {
        forbid final HardDelete<AuditEvent>
      }
    `);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    expect(ambiguous.ok).toBe(true);
    if (!left.ok || !right.ok || !ambiguous.ok) {
      return;
    }
    const ambiguousResult = checkShapeModules([left.module, right.module, ambiguous.module]);
    const ambiguousOutput = formatDiagnostics(ambiguousResult);
    expect(ambiguousResult.exitCode).toBe(1);
    expect(ambiguousOutput).toContain("ambiguous resource");
    expect(ambiguousOutput).toContain("Use a module-qualified reference");
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

  test("applies change declaration function additions to the base model", () => {
    const base = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>
      }
    `);
    const change = parseShapeModule(`
      module review.add_audit_retention_purge
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

  test("applies change declaration function removals before checking", () => {
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
      module review.remove_audit_retention_purge
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

  test("checks functions re-added after removal", () => {
    const base = parseShapeModule(`
      module audit

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>

        fn purgeOldEvents
          effects unknown
      }
    `);
    const change = parseShapeModule(`
      module review.replace_audit_retention_purge
      import audit

      change ReplaceAuditRetentionPurge {
        remove fn AuditStore.purgeOldEvents
        add fn AuditStore.purgeOldEvents
          effects complete {
            HardDelete<AuditEvent>
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
    expect(formatDiagnostics(result)).toContain("forbidden effect");
    expect(formatDiagnostics(result)).toContain("AuditStore.purgeOldEvents");
  });

  test("rejects context targeting a removed function", () => {
    const base = parseShapeModule(`
      module gateway

      component Gateway {
        fn derivePolicyDecision
          effects unknown
      }

      rationale DecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
      }
    `);
    const change = parseShapeModule(`
      module review.remove_decision
      import gateway

      change RemoveDecision {
        remove fn Gateway.derivePolicyDecision
      }
    `);

    expect(base.ok).toBe(true);
    expect(change.ok).toBe(true);
    if (!base.ok || !change.ok) {
      return;
    }

    const result = checkShapeModules([base.module, change.module]);

    expect(result.exitCode).toBe(1);
    expect(formatDiagnostics(result)).toContain("invalid context target");
    expect(formatDiagnostics(result)).toContain("Gateway.derivePolicyDecision");
  });

  test("applies change declaration top-level declaration modifications", () => {
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
      module review.reclassify_audit_event
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

  test("applies change declaration add relation operations before hypercycle checks", () => {
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
      module review.add_audit_calls_gateway
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

  test("applies change declaration modify relation operations before hypercycle checks", () => {
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
      module review.repoint_audit_call
      import deps

      change RepointAuditCall {
        modify relation AuditCallsSink {
          kind calls
          connects AuditStore -> Gateway
        }
      }
    `);
    const removesViolation = parseShapeModule(`
      module review.repoint_audit_call_away
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

  test("applies change declaration remove relation operations before hypercycle checks", () => {
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
      module review.remove_audit_calls_gateway
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

  test("fails coverage when governed files change without shape update", () => {
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
        on_change require shape_update
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
        on_change require shape_update
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
        on_change require shape_update
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
        on_change require shape_update
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
      "missing_shape_update"
    );
  });

  test("passes coverage when a change declaration references the governed source", () => {
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
        on_change require shape_update
      }
    `);
    const change = parseShapeModule(`
      module review.add_append
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
        { module: change.module, filePath: "shape/audit-update.shape" }
      ],
      {
        changedFiles: ["src/audit/store.ts", "shape/audit-update.shape"]
      }
    );

    expect(result.exitCode).toBe(0);
  });

  test("passes coverage when an absolute global Shape file references the governed source", () => {
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
              evidence ts("src/audit/store.ts:8-14")
          }
      }

      implementation AuditStoreImpl {
        paths {
          "src/audit/**/*.ts"
        }
        conforms_to AuditStore
        on_change require shape_update
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules(
      [{ module: parsed.module, filePath: resolve(repoRoot, "shape/audit.shape") }],
      {
        changedFiles: ["src/audit/store.ts", "shape/audit.shape"]
      }
    );

    expect(result.exitCode).toBe(0);
  });

  test("rejects stale change declaration source references for current coverage", () => {
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
        on_change require shape_update
      }
    `);
    const change = parseShapeModule(`
      module review.add_append
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
        { module: change.module, filePath: "shape/audit-update.shape" }
      ],
      {
        changedFiles: ["src/audit/store.ts"]
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toContain(
      "missing_shape_update"
    );
  });

  test("rejects removed function source references for current coverage", () => {
    const base = parseShapeModule(`
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

      implementation AuditStoreImpl {
        paths {
          "src/audit/**/*.ts"
        }
        conforms_to AuditStore
        on_change require shape_update
      }
    `);
    const change = parseShapeModule(`
      module review.remove_append
      import audit

      change RemoveAppend {
        remove fn AuditStore.appendEvent
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
        { module: change.module, filePath: "shape/audit-update.shape" }
      ],
      {
        changedFiles: ["src/audit/store.ts", "shape/audit.shape", "shape/audit-update.shape"],
        includeFacts: true
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.map((diagnostic) => diagnostic.kind)).toContain(
      "missing_shape_update"
    );
    expect(
      result.facts?.some(
        (fact) => fact.kind === "shape_update_for" && fact.path === "src/audit/store.ts"
      )
    ).toBe(false);
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
      [{ module: withAttestation.module, filePath: "shape/existing-waiver.shape" }],
      {
        changedFiles: ["packages/shp-checker/src/checker.ts"]
      }
    );
    expect(staleAttestation.exitCode).toBe(1);
    expect(staleAttestation.diagnostics.map((diagnostic) => diagnostic.kind)).toContain(
      "missing_bound_docs_change"
    );

    const attested = checkShapeModules(
      [{ module: withAttestation.module, filePath: "shape/current-waiver.shape" }],
      {
        changedFiles: ["packages/shp-checker/src/checker.ts", "shape/current-waiver.shape"]
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
        name: "deps::GatewayCallsGhost",
        relationKind: "calls"
      })
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "hyperedge_member",
        hyperedge: "deps::GatewayCallsGhost",
        endpoint: "deps::Gateway",
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

  test("accepts matching relation fingerprint expectations and exposes them in facts and explain", () => {
    const parsed = parseShapeModule(`
      module generated.audit

      trait GeneratedAstAnchor {
      }

      component AuditStore {
      }

      resource AuditStoreAstAnchor : GeneratedAstAnchor {
        storage ast.anchor("{}")
        fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }

      relation AuditStoreGeneratedFromAnchor {
        kind generated_from
        connects AuditStore -> AuditStoreAstAnchor
        expects AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module], { includeFacts: true });

    expect(result.exitCode).toBe(0);
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "resource_fingerprint",
        resource: "generated.audit::AuditStoreAstAnchor",
        provider: "ast.semantic_subtree_v1"
      })
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "hyperedge_fingerprint_expectation",
        hyperedge: "generated.audit::AuditStoreGeneratedFromAnchor",
        endpoint: "generated.audit::AuditStoreAstAnchor"
      })
    );
    expect(explainShapeModules([parsed.module], "AuditStoreAstAnchor")).toContain("fingerprints:");
    expect(explainShapeModules([parsed.module], "AuditStoreGeneratedFromAnchor")).toContain(
      "fingerprint expectations:"
    );
  });

  test("rejects stale relation fingerprint expectations", () => {
    const parsed = parseShapeModule(`
      module generated.audit

      trait GeneratedAstAnchor {
      }

      component AuditStore {
      }

      resource AuditStoreAstAnchor : GeneratedAstAnchor {
        fingerprint ast.semantic_subtree_v1("sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
      }

      relation AuditStoreGeneratedFromAnchor {
        kind generated_from
        connects AuditStore -> AuditStoreAstAnchor
        expects AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("stale fingerprint expectation");
    expect(output).toContain("expected: sha256:aaaaaaaa");
    expect(output).toContain("actual: sha256:bbbbbbbb");
  });

  test("rejects missing relation fingerprint providers", () => {
    const parsed = parseShapeModule(`
      module generated.audit

      trait GeneratedAstAnchor {
      }

      component AuditStore {
      }

      resource AuditStoreAstAnchor : GeneratedAstAnchor

      relation AuditStoreGeneratedFromAnchor {
        kind generated_from
        connects AuditStore -> AuditStoreAstAnchor
        expects AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("stale fingerprint expectation");
    expect(output).toContain("actual: missing");
  });

  test("rejects duplicate fingerprint providers on a resource", () => {
    const parsed = parseShapeModule(`
      module generated.audit

      resource AuditStoreAstAnchor {
        fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        fingerprint ast.semantic_subtree_v1("sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("duplicate fingerprint");
    expect(output).toContain("ast.semantic_subtree_v1");
  });

  test("rejects fingerprint expectations for non-endpoints and component endpoints", () => {
    const parsed = parseShapeModule(`
      module generated.audit

      component AuditStore {
      }
      component Other {
      }
      resource AuditStoreAstAnchor {
        fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }

      relation AuditStoreGeneratedFromAnchor {
        kind generated_from
        connects AuditStore -> Other
        expects AuditStoreAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        expects Other fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }
    `);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = checkShapeModules([parsed.module]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain(
      "fingerprint expectation AuditStoreAstAnchor is not a connects endpoint"
    );
    expect(output).toContain("fingerprint expectation endpoint Other must be a resource");
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
        hyperedge: "deps::GatewayCallsAudit",
        endpoint: "deps::Gateway",
        role: "caller"
      })
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "hyperedge_member",
        hyperedge: "deps::GatewayCallsAudit",
        endpoint: "deps::AuditStore",
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

      trait Immutable {
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

      rule immutable_forbids_delete {
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

  test("applies repeated rule subjects as conjunctions", () => {
    const parsed = parseShapeModule(`
      module rules

      trait Immutable {
      }

      trait Archived {
      }

      resource LedgerEntry : Immutable, Archived

      component LedgerStore {
        owns LedgerEntry
        grants HardDelete<LedgerEntry>

        fn purgeEntry
          effects complete {
            HardDelete<LedgerEntry>
          }
      }

      rule archived_immutable_forbids_delete {
        when T has Immutable
        when T has Archived
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
    expect(output).toContain("rule archived_immutable_forbids_delete forbids final HardDelete<T>");
  });

  test("rejects final forbid rules with multiple subjects", () => {
    const parsed = parseShapeModule(`
      module rules

      trait Immutable {
      }

      trait Archived {
      }

      rule invalid_multi_subject_final_forbid {
        when T has Immutable
        when U has Archived
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
    expect(output).toContain("invalid rule");
    expect(output).toContain("final effect forbids may bind only one subject");
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
        target: "gateway::Gateway.derivePolicyDecision"
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

  test("formats effect candidate syntax canonically", () => {
    const result = formatShapeSource(`
      module shape.generated.ast.audit
      resource AuditEvent
      resource AuditStoreAppendEventAstAnchor { fingerprint ast.semantic_subtree_v1('sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') }
      component AuditStore { fn appendEvent effects unknown }
      effect candidate AppendEventCandidate { confidence low source ts('src/audit/store.ts:8-14') effect Append<AuditEvent> fn AuditStore.appendEvent pin AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1('sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') }
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toContain("effect candidate AppendEventCandidate");
    expect(result.formatted).toContain("  fn AuditStore.appendEvent");
    expect(result.formatted).toContain("  effect Append<AuditEvent>");
    expect(result.formatted).toContain("  confidence low");
    expect(result.formatted).toContain(
      '  pin AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")'
    );
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
      "component AuditStore {}"
    );

    expect(prompt).toContain("Use effects unknown when uncertainty remains");
    expect(prompt).toContain("HardDelete");
    expect(prompt).toContain("If adding PreserveInline");
    expect(prompt).toContain("Do not use rationale or memory to waive final forbidden effects");
    expect(critic).toContain("Did the model update cover every governed changed file?");
    expect(critic).toContain("Did the model update touch a guarded target without reevaluation?");
  });

  test("generates a valid reviewable global model scaffold", () => {
    const source = generateShapeUpdateDraft({
      moduleName: "audit",
      componentName: "AuditStore",
      changedFiles: ["src/audit/purge.ts"]
    });
    const parsed = parseShapeModule(source);

    expect(source).toContain("effects unknown");
    expect(source).toContain('source ts("src/audit/purge.ts")');
    expect(parsed.ok).toBe(true);
  });

  test("uses a valid fallback source language for unknown file extensions", () => {
    const source = generateShapeUpdateDraft({
      moduleName: "audit",
      componentName: "AuditStore",
      changedFiles: ["README"]
    });
    const parsed = parseShapeModule(source);

    expect(source).toContain('source file("README")');
    expect(source).not.toContain("source source(");
    expect(parsed.ok).toBe(true);
  });

  test("can generate an optional memory guard scaffold", () => {
    const source = generateShapeUpdateDraft({
      moduleName: "audit",
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

    const formatted = formatOnSave(source);
    expect(formatted.ok).toBe(true);
    if (formatted.ok) {
      expect(formatted.formatted).toContain("component AuditStore");
    }
  });

  test("keeps qualified function definition lookup scoped to components", () => {
    const scopedSource = `
      component Alpha {
        fn handle
          effects unknown
      }

      component Beta {
        fn handle
          effects unknown
      }
    `;

    const alpha = getDefinitionLocation(scopedSource, "Alpha.handle");
    const beta = getDefinitionLocation(scopedSource, "Beta.handle");

    expect(alpha?.line).toBeGreaterThan(1);
    expect(beta?.line).toBeGreaterThan(alpha?.line ?? 0);
  });

  test("derives editor shape-trait help from the prelude registry", () => {
    for (const requirement of PRELUDE_CONTEXT_REQUIREMENTS) {
      expect(getCompletions("", requirement.trait)).toContain(requirement.trait);
      expect(getHoverText("", requirement.trait)).toContain(requirement.contextType);
    }
    for (const relationKind of PRELUDE_RELATION_KIND_NAMES) {
      expect(getCompletions("", relationKind)).toContain(relationKind);
    }
  });
});

describe("AST to Shape generation", () => {
  test("does not treat missing glibc report fields as musl without loader evidence", () => {
    expect(detectLinuxMuslRuntime({}, "x64", () => false)).toBe(false);
    expect(
      detectLinuxMuslRuntime({ componentVersions: { glibc: "2.39" } }, "x64", () => true)
    ).toBe(false);
    expect(detectLinuxMuslRuntime({}, "x64", (path) => path === "/lib/ld-musl-x86_64.so.1")).toBe(
      true
    );
  });

  test("projects Rust AST JSON into a semantic draft plus optional raw trace", () => {
    const ast = rustAuditAstJson();
    const graphResult = buildCodeSemanticGraphFromAstJson(ast);

    expect(graphResult.ok).toBe(true);
    if (!graphResult.ok) {
      throw new Error(formatAstTestDiagnostics(graphResult.diagnostics));
    }

    expect(graphResult.value.rawNodes).toHaveLength(ast.files[0]?.nodes.length ?? 0);
    const output = requireGeneratedOutput(
      generateShapeFromCodeSemanticGraph(graphResult.value, {
        moduleName: "generated.audit",
        rawModuleName: "generated.audit.raw"
      })
    );

    expect(output.semanticShape).toContain("resource AuditEvent : GeneratedCandidate");
    expect(output.semanticShape).toContain("component AuditStore : GeneratedCandidate");
    expect(output.semanticShape).toContain("fn append_event");
    expect(output.semanticShape).toContain("kind calls");
    expect(output.semanticShape).toContain("trait GeneratedAstAnchor");
    expect(output.semanticShape).toContain("fingerprint ast.semantic_subtree_v1");
    expect(output.semanticShape).toContain('storage ast.anchor("src/audit/store.rs:9-11")');
    expect(output.semanticShape).not.toContain('storage ast.anchor("{\\"target\\"');
    expect(output.semanticShape).toContain("kind generated_from");
    expect(output.semanticShape).toContain("expects AuditStoreAstAnchor fingerprint");
    expect(output.semanticShape).toContain("fn AuditStore.append_event generated from");
    expect(output.semanticShape).toContain("implementation AuditStoreImpl");
    expect(output.semanticShape).not.toContain("AuditStoreImpl_");
    expect(output.semanticShape).not.toContain("GeneratedAstNode");
    expect(output.rawShape).toContain("GeneratedAstNode");
    expect(output.rawShape).toContain("kind ast_child");

    const semantic = parseShapeModule(output.semanticShape);
    expect(semantic.ok).toBe(true);
    if (!semantic.ok) {
      throw new Error(semantic.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    }
    const formattedSemantic = formatShapeSource(output.semanticShape);
    expect(formattedSemantic.ok).toBe(true);
    if (formattedSemantic.ok) {
      expect(formattedSemantic.formatted).toBe(output.semanticShape);
    }
    const semanticCheck = checkShapeModules([semantic.module]);
    expect(semanticCheck.exitCode).toBe(1);
    expect(formatDiagnostics(semanticCheck)).toContain("unknown effects");

    const rawShape = output.rawShape ?? "";
    const raw = parseShapeModule(rawShape);
    expect(raw.ok).toBe(true);
    if (!raw.ok) {
      throw new Error(raw.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    }
    const formattedRaw = formatShapeSource(rawShape);
    expect(formattedRaw.ok).toBe(true);
    if (formattedRaw.ok) {
      expect(formattedRaw.formatted).toBe(rawShape);
    }
    expect(checkShapeModules([raw.module]).exitCode).toBe(0);
  });

  for (const fixture of languageAstFixtures()) {
    test(`generates parseable semantic Shape for ${fixture.language}`, () => {
      const result = generateShapeFromAstJson(fixture.ast, {
        moduleName: `generated.${fixture.language}`
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(formatAstTestDiagnostics(result.diagnostics));
      }
      expect(result.value.semanticShape).toContain(fixture.expected);
      expect(parseShapeModule(result.value.semanticShape).ok).toBe(true);
    });
  }

  test("attaches Go receiver methods to their component instead of a file module", () => {
    const result = generateShapeFromAstJson(goReceiverAstJson(), {
      moduleName: "generated.go"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(formatAstTestDiagnostics(result.diagnostics));
    }
    expect(result.value.semanticShape).toContain("component AuditStore : GeneratedCandidate");
    expect(result.value.semanticShape).toContain("  fn AppendEvent");
    expect(result.value.semanticShape).not.toContain("component StoreModule");
  });

  test("keeps anchor names stable while semantic fingerprints change with function bodies", () => {
    const before = buildCodeSemanticGraphFromAstJson(functionFingerprintAst("fn main() {}"));
    const after = buildCodeSemanticGraphFromAstJson(
      functionFingerprintAst("fn main() { let x = 1; }")
    );

    expect(before.ok).toBe(true);
    expect(after.ok).toBe(true);
    if (!before.ok || !after.ok) {
      throw new Error("failed to build test graphs");
    }

    const beforeAnchor = astAnchorForTarget(before.value, "MainModule.main");
    const afterAnchor = astAnchorForTarget(after.value, "MainModule.main");
    expect(beforeAnchor?.name).toBe(afterAnchor?.name);
    expect(beforeAnchor?.fingerprint.value).not.toBe(afterAnchor?.fingerprint.value);
  });

  test("flags authored AST relations when regenerated anchor fingerprints change", () => {
    const versionOne = buildCodeSemanticGraphFromAstJson(functionFingerprintAst("fn main() {}"));
    const versionTwo = buildCodeSemanticGraphFromAstJson(
      functionFingerprintAst("fn main() { let x = 1; }")
    );

    expect(versionOne.ok).toBe(true);
    expect(versionTwo.ok).toBe(true);
    if (!versionOne.ok || !versionTwo.ok) {
      throw new Error("failed to build test graphs");
    }

    const firstAnchor = astAnchorForTarget(versionOne.value, "MainModule.main");
    const secondAnchor = astAnchorForTarget(versionTwo.value, "MainModule.main");
    expect(firstAnchor).toBeDefined();
    expect(secondAnchor).toBeDefined();
    if (!firstAnchor || !secondAnchor) {
      throw new Error("missing test anchor");
    }
    expect(firstAnchor.name).toBe(secondAnchor.name);
    expect(firstAnchor.fingerprint.value).not.toBe(secondAnchor.fingerprint.value);

    const authoredPin = parseShapeModule(`
      module reviewed.main
      import shape.generated.ast.main

      relation ReviewedMainEvidence {
        kind generated_from
        connects MainModule -> ${firstAnchor.name}
        expects ${firstAnchor.name} fingerprint ${firstAnchor.fingerprint.provider}("${firstAnchor.fingerprint.value}")
      }
    `);
    expect(authoredPin.ok).toBe(true);
    if (!authoredPin.ok) {
      throw new Error(formatAstTestDiagnostics(authoredPin.diagnostics));
    }

    const generatedVersionOne = parseShapeModule(
      requireGeneratedOutput(
        generateShapeFromCodeSemanticGraph(versionOne.value, {
          moduleName: "shape.generated.ast.main"
        })
      ).semanticShape
    );
    const generatedVersionTwo = parseShapeModule(
      requireGeneratedOutput(
        generateShapeFromCodeSemanticGraph(versionTwo.value, {
          moduleName: "shape.generated.ast.main"
        })
      ).semanticShape
    );
    expect(generatedVersionOne.ok).toBe(true);
    expect(generatedVersionTwo.ok).toBe(true);
    if (!generatedVersionOne.ok || !generatedVersionTwo.ok) {
      throw new Error("generated fingerprint Shape did not parse");
    }

    const matching = checkShapeModules([
      { module: generatedVersionOne.module, filePath: "shape/generated/ast/main.shape" },
      { module: authoredPin.module }
    ]);
    expect(
      matching.diagnostics.some((diagnostic) => diagnostic.kind === "fingerprint_mismatch")
    ).toBe(false);

    const stale = checkShapeModules([
      { module: generatedVersionTwo.module, filePath: "shape/generated/ast/main.shape" },
      { module: authoredPin.module }
    ]);
    const staleOutput = formatDiagnostics(stale);
    expect(stale.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "fingerprint_mismatch",
        relation: "reviewed.main::ReviewedMainEvidence",
        endpoint: `shape.generated.ast.main::${firstAnchor.name}`,
        expected: firstAnchor.fingerprint.value,
        actual: secondAnchor.fingerprint.value
      })
    );
    expect(staleOutput).toContain("stale fingerprint expectation");
    expect(staleOutput).toContain("relation ReviewedMainEvidence expects");
  });

  test("does not churn semantic fingerprints for unrelated or formatting-only edits", () => {
    const base = buildCodeSemanticGraphFromAstJson(
      multiFunctionFingerprintAst("fn main(){let x=1;}", "fn helper() {}")
    );
    const unrelatedChanged = buildCodeSemanticGraphFromAstJson(
      multiFunctionFingerprintAst(
        "fn main() { let   x = 1; } // comment",
        "fn helper() { let y = 2; }"
      )
    );

    expect(base.ok).toBe(true);
    expect(unrelatedChanged.ok).toBe(true);
    if (!base.ok || !unrelatedChanged.ok) {
      throw new Error("failed to build test graphs");
    }

    const baseAnchor = astAnchorForTarget(base.value, "MainModule.main");
    const changedAnchor = astAnchorForTarget(unrelatedChanged.value, "MainModule.main");
    expect(baseAnchor?.fingerprint.value).toBe(changedAnchor?.fingerprint.value);
  });

  test("classifies function fingerprint churn across code evolution scenarios", () => {
    const base = graphFromAstForTest(
      functionFingerprintAst("fn main(input: u32) -> u32 { input + 1 }")
    );
    const baseAnchor = requireAstAnchor(base, "MainModule.main");
    const cases = [
      {
        label: "body literal changes",
        ast: functionFingerprintAst("fn main(input: u32) -> u32 { input + 2 }"),
        changes: true
      },
      {
        label: "signature parameter type changes",
        ast: functionFingerprintAst("fn main(input: u64) -> u32 { input + 1 }"),
        changes: true
      },
      {
        label: "return type changes",
        ast: functionFingerprintAst("fn main(input: u32) -> i64 { input + 1 }"),
        changes: true
      },
      {
        label: "operator changes",
        ast: functionFingerprintAst("fn main(input: u32) -> u32 { input - 1 }"),
        changes: true
      },
      {
        label: "formatting and comments change only",
        ast: functionFingerprintAst(
          "fn   main ( input : u32 ) -> u32 { /* explain */ input + 1 // keep\n }"
        ),
        changes: false
      },
      {
        label: "path span and parser node id change only",
        ast: functionFingerprintAst({
          text: "fn main(input: u32) -> u32 { input + 1 }",
          path: "crates/app/main.rs",
          nodeId: "renumbered_main",
          span: span(40, 3, 44, 4)
        }),
        changes: false
      }
    ];

    for (const scenario of cases) {
      const graph = graphFromAstForTest(scenario.ast);
      const anchor = requireAstAnchor(graph, "MainModule.main");
      expect(anchor.name).toBe(baseAnchor.name);
      if (scenario.changes) {
        expect(anchor.fingerprint.value).not.toBe(baseAnchor.fingerprint.value);
      } else {
        expect(anchor.fingerprint.value).toBe(baseAnchor.fingerprint.value);
      }
    }
  });

  test("classifies component declaration shell fingerprints across member evolution", () => {
    const base = graphFromAstForTest(componentShellFingerprintAst());
    const baseComponentAnchor = requireAstAnchor(base, "AuditStore");
    const baseFunctionAnchor = requireAstAnchor(base, "AuditStore.appendEvent");

    const methodBodyChanged = graphFromAstForTest(
      componentShellFingerprintAst({
        methodText: "appendEvent(event: AuditEvent) {\n  this.repo.archive(event);\n}"
      })
    );
    expect(requireAstAnchor(methodBodyChanged, "AuditStore").fingerprint.value).toBe(
      baseComponentAnchor.fingerprint.value
    );
    expect(
      requireAstAnchor(methodBodyChanged, "AuditStore.appendEvent").fingerprint.value
    ).not.toBe(baseFunctionAnchor.fingerprint.value);

    const methodSignatureChanged = graphFromAstForTest(
      componentShellFingerprintAst({
        methodText: "appendEvent(event: AuditEvent, actor: Actor) {\n  this.repo.insert(event);\n}"
      })
    );
    expect(requireAstAnchor(methodSignatureChanged, "AuditStore").fingerprint.value).not.toBe(
      baseComponentAnchor.fingerprint.value
    );
    expect(
      requireAstAnchor(methodSignatureChanged, "AuditStore.appendEvent").fingerprint.value
    ).not.toBe(baseFunctionAnchor.fingerprint.value);

    const fieldChanged = graphFromAstForTest(
      componentShellFingerprintAst({
        fieldText: "repo: DurableAuditRepo;"
      })
    );
    expect(requireAstAnchor(fieldChanged, "AuditStore").fingerprint.value).not.toBe(
      baseComponentAnchor.fingerprint.value
    );
    expect(requireAstAnchor(fieldChanged, "AuditStore.appendEvent").fingerprint.value).toBe(
      baseFunctionAnchor.fingerprint.value
    );

    const parserShapeChanged = graphFromAstForTest(
      componentShellFingerprintAst({
        path: "packages/audit/store.ts",
        typeNodeId: "renumbered_store",
        fieldNodeId: "renumbered_field",
        methodNodeId: "renumbered_append",
        typeSpan: span(20, 1, 24, 2),
        fieldSpan: span(21, 3, 21, 24),
        methodSpan: span(22, 3, 23, 4)
      })
    );
    expect(requireAstAnchor(parserShapeChanged, "AuditStore").name).toBe(baseComponentAnchor.name);
    expect(requireAstAnchor(parserShapeChanged, "AuditStore").fingerprint.value).toBe(
      baseComponentAnchor.fingerprint.value
    );
    expect(requireAstAnchor(parserShapeChanged, "AuditStore.appendEvent").name).toBe(
      baseFunctionAnchor.name
    );
    expect(requireAstAnchor(parserShapeChanged, "AuditStore.appendEvent").fingerprint.value).toBe(
      baseFunctionAnchor.fingerprint.value
    );
  });

  test("classifies resource declaration fingerprints across schema evolution", () => {
    const base = graphFromAstForTest(resourceShellFingerprintAst());
    const baseAnchor = requireAstAnchor(base, "AuditEvent");

    const fieldTypeChanged = graphFromAstForTest(
      resourceShellFingerprintAst({
        fieldText: "id: EventId,"
      })
    );
    expect(requireAstAnchor(fieldTypeChanged, "AuditEvent").name).toBe(baseAnchor.name);
    expect(requireAstAnchor(fieldTypeChanged, "AuditEvent").fingerprint.value).not.toBe(
      baseAnchor.fingerprint.value
    );

    const fieldAdded = graphFromAstForTest(
      resourceShellFingerprintAst({
        extraFieldText: "actor: String,"
      })
    );
    expect(requireAstAnchor(fieldAdded, "AuditEvent").name).toBe(baseAnchor.name);
    expect(requireAstAnchor(fieldAdded, "AuditEvent").fingerprint.value).not.toBe(
      baseAnchor.fingerprint.value
    );

    const commentsFormattingAndParserShapeChanged = graphFromAstForTest(
      resourceShellFingerprintAst({
        path: "crates/audit/event.rs",
        typeNodeId: "renumbered_event",
        fieldNodeId: "renumbered_id",
        typeSpan: span(100, 1, 103, 2),
        fieldSpan: span(101, 3, 101, 28),
        fieldText: "id   :   String, // durable identity"
      })
    );
    expect(requireAstAnchor(commentsFormattingAndParserShapeChanged, "AuditEvent").name).toBe(
      baseAnchor.name
    );
    expect(
      requireAstAnchor(commentsFormattingAndParserShapeChanged, "AuditEvent").fingerprint.value
    ).toBe(baseAnchor.fingerprint.value);
  });

  test("renamed AST targets leave authored pins unresolved instead of matching a new anchor", () => {
    const versionOne = graphFromAstForTest(functionFingerprintAst("fn main() {}"));
    const firstAnchor = requireAstAnchor(versionOne, "MainModule.main");
    const versionTwo = graphFromAstForTest(
      functionFingerprintAst({
        functionName: "launch",
        text: "fn launch() {}"
      })
    );
    const renamedAnchor = requireAstAnchor(versionTwo, "MainModule.launch");

    expect(renamedAnchor.name).not.toBe(firstAnchor.name);

    const authoredPin = parseShapeModule(`
      module reviewed.main
      import shape.generated.ast.main

      relation ReviewedMainEvidence {
        kind generated_from
        connects MainModule -> ${firstAnchor.name}
        expects ${firstAnchor.name} fingerprint ${firstAnchor.fingerprint.provider}("${firstAnchor.fingerprint.value}")
      }
    `);
    expect(authoredPin.ok).toBe(true);
    if (!authoredPin.ok) {
      throw new Error(formatAstTestDiagnostics(authoredPin.diagnostics));
    }

    const generatedVersionTwo = parseShapeModule(
      requireGeneratedOutput(
        generateShapeFromCodeSemanticGraph(versionTwo, {
          moduleName: "shape.generated.ast.main"
        })
      ).semanticShape
    );
    expect(generatedVersionTwo.ok).toBe(true);
    if (!generatedVersionTwo.ok) {
      throw new Error("generated renamed Shape did not parse");
    }

    const result = checkShapeModules([
      { module: generatedVersionTwo.module, filePath: "shape/generated/ast/main.shape" },
      { module: authoredPin.module }
    ]);
    const output = formatDiagnostics(result);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unknown_name",
        nameKind: "relation_endpoint",
        name: `reviewed.main::${firstAnchor.name}`
      })
    );
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.kind === "fingerprint_mismatch")
    ).toBe(false);
    expect(output).toContain(firstAnchor.name);
    expect(output).toContain("unknown relation_endpoint");
  });

  test("rejects AST JSON without token data for semantic fingerprints", () => {
    const result = generateShapeFromAstJson({
      language: "rust",
      files: [
        {
          path: "src/main.rs",
          root: "root",
          nodes: [
            { id: "root", kind: "source_file", children: ["main"] },
            { id: "main", kind: "function_item", attributes: { name: "main" } }
          ]
        }
      ]
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "missing_fingerprint_tokens" })
      );
    }
  });

  test("keeps same-named AST declarations from different files as distinct identities", () => {
    const graph = graphFromAstForTest({
      language: "typescript",
      files: [
        {
          path: "src/left/store.ts",
          root: "leftRoot",
          nodes: [
            { id: "leftRoot", kind: "program", children: ["leftStore"] },
            {
              id: "leftStore",
              kind: "class_declaration",
              text: "class AuditStore { read() {} }",
              children: ["leftRead"]
            },
            { id: "leftRead", kind: "method_definition", text: "read() {}" }
          ]
        },
        {
          path: "src/right/store.ts",
          root: "rightRoot",
          nodes: [
            { id: "rightRoot", kind: "program", children: ["rightStore"] },
            {
              id: "rightStore",
              kind: "class_declaration",
              text: "class AuditStore { read() {} }",
              children: ["rightRead"]
            },
            { id: "rightRead", kind: "method_definition", text: "read() {}" }
          ]
        }
      ]
    });
    const stores = graph.containers.filter((container) => container.name.startsWith("AuditStore"));

    expect(stores).toHaveLength(2);
    expect(new Set(stores.map((store) => store.id)).size).toBe(2);
    expect(new Set(stores.map((store) => store.name)).size).toBe(2);
  });

  test("allocates deterministic names for overloaded AST functions", () => {
    const graph = graphFromAstForTest({
      language: "typescript",
      files: [
        {
          path: "src/store.ts",
          root: "root",
          nodes: [
            { id: "root", kind: "program", children: ["store"] },
            {
              id: "store",
              kind: "class_declaration",
              text: "class AuditStore { read(id: string) {} read(id: number) {} }",
              children: ["readString", "readNumber"]
            },
            { id: "readString", kind: "method_definition", text: "read(id: string) {}" },
            { id: "readNumber", kind: "method_definition", text: "read(id: number) {}" }
          ]
        }
      ]
    });
    const store = graph.containers.find((container) => container.name === "AuditStore");
    const functions = graph.functions.filter((fn) => fn.ownerId === store?.id);

    expect(functions).toHaveLength(2);
    expect(new Set(functions.map((fn) => fn.name)).size).toBe(2);
  });

  test("rejects invalid semantic graph edges instead of dropping them during rendering", () => {
    const graph = graphFromAstForTest(functionFingerprintAst("fn main() {}"));
    graph.relations.push({
      id: "bad_relation",
      kind: "calls",
      fromId: "missing_from",
      toId: graph.containers[0]?.id ?? "missing_to",
      path: "src/main.rs",
      confidence: "high",
      summary: "invalid test edge"
    });

    const result = generateShapeFromCodeSemanticGraph(graph, { moduleName: "generated.invalid" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalid_semantic_relation" })
      );
    }
  });

  test("preserves explicit source language for extensionless files", async () => {
    const source = "fn main() {}\n";
    const functionNode = fakeTreeSitterNode({
      kind: "function_item",
      startByte: 0,
      endByte: 12,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 12 }
    });
    const root = fakeTreeSitterNode({
      kind: "source_file",
      startByte: 0,
      endByte: source.length,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 1, column: 0 },
      children: [{ fieldName: "item", node: functionNode }]
    });

    const graph = await parseSourceFilesToCodeSemanticGraph(
      [{ path: "src/main", source, language: "rust" }],
      { parserProvider: () => ({ rootNode: root }) }
    );

    expect(graph.ok).toBe(true);
    if (!graph.ok) {
      throw new Error(formatAstTestDiagnostics(graph.diagnostics));
    }
    const output = requireGeneratedOutput(
      generateShapeFromCodeSemanticGraph(graph.value, {
        moduleName: "generated.rust"
      })
    );
    expect(output.semanticShape).toContain('source rust("src/main:1-1")');
    expect(output.semanticShape).not.toContain('source file("src/main:1-1")');
  });

  test("infers JSX and TSX parser languages from file extensions", async () => {
    const source = "export function Widget() { return <div />; }\n";
    const root = fakeTreeSitterNode({
      kind: "program",
      startByte: 0,
      endByte: source.length,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 1, column: 0 }
    });
    const languages: string[] = [];

    const result = await parseSourceFilesToCodeSemanticGraph(
      [
        { path: "src/widget.jsx", source },
        { path: "src/widget.tsx", source }
      ],
      {
        parserProvider: (language) => {
          languages.push(language);
          return { rootNode: root };
        }
      }
    );

    expect(result.ok).toBe(true);
    expect(languages).toEqual(["javascript", "tsx"]);
  });

  test("configures complete bundled parser assets before parser lookup", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shp-parser-assets-test-"));
    try {
      const executablePath = join(tempDir, "bin", "shp");
      const libsDir = bundledTreeSitterParserLibsDir(executablePath);
      await mkdir(libsDir, { recursive: true });
      for (const language of BUNDLED_TREE_SITTER_LANGUAGES) {
        await writeFile(join(libsDir, treeSitterParserLibraryName(language)), "");
      }

      let configuredCacheDir: string | undefined;
      const diagnostics = configureBundledTreeSitterParsers(
        {
          configure: (config?: { cacheDir?: string }) => {
            configuredCacheDir = config?.cacheDir;
          }
        },
        executablePath
      );

      expect(diagnostics).toEqual([]);
      expect(configuredCacheDir).toBe(libsDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("normalizes Tree-sitter-like source nodes with field names, spans, and hashes", async () => {
    const source = "fn main() {}\n";
    const functionNode = fakeTreeSitterNode({
      kind: "function_item",
      startByte: 0,
      endByte: 12,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 12 }
    });
    const root = fakeTreeSitterNode({
      kind: "source_file",
      startByte: 0,
      endByte: source.length,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 1, column: 0 },
      children: [{ fieldName: "item", node: functionNode }]
    });

    const result = await parseSourceFilesToCodeSemanticGraph([{ path: "src/main.rs", source }], {
      parserProvider: () => ({ rootNode: root })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(formatAstTestDiagnostics(result.diagnostics));
    }
    expect(result.value.files[0]?.sourceHash).toMatch(/^[0-9a-f]{8}$/);
    expect(result.value.rawNodes).toHaveLength(2);
    const normalizedFunction = result.value.rawNodes.find((node) => node.kind === "function_item");
    expect(normalizedFunction?.fieldName).toBe("item");
    expect(normalizedFunction?.span?.startLine).toBe(1);
    expect(normalizedFunction?.text).toBe("fn main() {}");
    expect(normalizedFunction?.textHash).toMatch(/^[0-9a-f]{8}$/);
  });

  test("rejects parser errors unless explicitly allowed", async () => {
    const root = fakeTreeSitterNode({
      kind: "source_file",
      startByte: 0,
      endByte: 4,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 4 },
      hasError: true
    });

    const rejected = await parseSourceFilesToCodeSemanticGraph(
      [{ path: "src/broken.py", source: "def " }],
      { parserProvider: () => ({ rootNode: root }) }
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.map((diagnostic) => diagnostic.code)).toContain("parse_error");
    }

    const allowed = await parseSourceFilesToCodeSemanticGraph(
      [{ path: "src/broken.py", source: "def " }],
      { allowParseErrors: true, parserProvider: () => ({ rootNode: root }) }
    );
    expect(allowed.ok).toBe(true);
  });

  test("rejects malformed AST JSON instead of dropping raw nodes", () => {
    const result = buildCodeSemanticGraphFromAstJson({
      language: "rust",
      files: [
        {
          path: "src/broken.rs",
          root: "root",
          nodes: [
            {
              id: "root",
              kind: "source_file",
              attributes: { nested: { unsupported: true } },
              children: ["missing"]
            },
            { id: "orphan", kind: "function_item", text: "fn orphan() {}" }
          ]
        }
      ]
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
      expect(codes).toContain("nested_attribute");
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

function rustAuditAstJson() {
  return {
    language: "rust",
    files: [
      {
        path: "src/audit/store.rs",
        root: "root",
        nodes: [
          {
            id: "root",
            kind: "source_file",
            span: span(1, 1, 24, 1),
            children: ["event", "repo", "store", "repoImpl", "storeImpl"]
          },
          {
            id: "event",
            kind: "struct_item",
            attributes: { name: "AuditEvent" },
            span: span(1, 1, 3, 2),
            text: "struct AuditEvent {\n  id: String,\n}"
          },
          {
            id: "repo",
            kind: "struct_item",
            attributes: { name: "AuditRepo" },
            span: span(5, 1, 7, 2),
            text: "struct AuditRepo {\n  client: DbClient,\n}"
          },
          {
            id: "store",
            kind: "struct_item",
            attributes: { name: "AuditStore" },
            span: span(9, 1, 11, 2),
            text: "struct AuditStore {\n  repo: AuditRepo,\n}"
          },
          {
            id: "repoImpl",
            kind: "impl_item",
            span: span(13, 1, 17, 2),
            text: "impl AuditRepo {\n  fn insert(&self, event: AuditEvent) {}\n}",
            children: [{ id: "repoImplType", field: "type" }, "repoInsert"]
          },
          {
            id: "repoImplType",
            kind: "type_identifier",
            span: span(13, 6, 13, 15),
            text: "AuditRepo"
          },
          {
            id: "repoInsert",
            kind: "function_item",
            attributes: { name: "insert" },
            span: span(14, 3, 14, 45),
            text: "fn insert(&self, event: AuditEvent) {}"
          },
          {
            id: "storeImpl",
            kind: "impl_item",
            span: span(19, 1, 24, 2),
            text: "impl AuditStore {\n  fn append_event(&self, event: AuditEvent) {\n    self.repo.insert(event);\n  }\n}",
            children: [{ id: "storeImplType", field: "type" }, "storeAppend"]
          },
          {
            id: "storeImplType",
            kind: "type_identifier",
            span: span(19, 6, 19, 16),
            text: "AuditStore"
          },
          {
            id: "storeAppend",
            kind: "function_item",
            attributes: { name: "append_event" },
            span: span(20, 3, 22, 4),
            text: "fn append_event(&self, event: AuditEvent) {\n  self.repo.insert(event);\n}"
          }
        ]
      }
    ]
  };
}

type FunctionFingerprintAstInput = {
  text: string;
  path?: string;
  nodeId?: string;
  functionName?: string;
  span?: SourceSpan;
};

function functionFingerprintAst(input: string | FunctionFingerprintAstInput): unknown {
  const normalized = typeof input === "string" ? { text: input } : input;
  return multiFunctionFingerprintAst(normalized.text, undefined, normalized);
}

function multiFunctionFingerprintAst(
  mainText: string,
  helperText?: string,
  input: Partial<FunctionFingerprintAstInput> = {}
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

type ComponentShellFingerprintAstInput = {
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

function componentShellFingerprintAst(input: ComponentShellFingerprintAstInput = {}): unknown {
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
          {
            id: "root",
            kind: "program",
            children: [typeNodeId]
          },
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

type ResourceShellFingerprintAstInput = {
  path?: string;
  fieldText?: string;
  extraFieldText?: string;
  typeNodeId?: string;
  fieldNodeId?: string;
  extraFieldNodeId?: string;
  typeSpan?: SourceSpan;
  fieldSpan?: SourceSpan;
};

function resourceShellFingerprintAst(input: ResourceShellFingerprintAstInput = {}): unknown {
  const path = input.path ?? "src/audit/event.rs";
  const typeNodeId = input.typeNodeId ?? "event";
  const fieldNodeId = input.fieldNodeId ?? "eventId";
  const extraFieldNodeId = input.extraFieldNodeId ?? "actor";
  const fieldText = input.fieldText ?? "id: String,";
  const children = input.extraFieldText ? [fieldNodeId, extraFieldNodeId] : [fieldNodeId];
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
            children: [typeNodeId]
          },
          {
            id: typeNodeId,
            kind: "struct_item",
            attributes: { name: "AuditEvent" },
            span: input.typeSpan,
            text: `struct AuditEvent {\n  ${fieldText}${
              input.extraFieldText ? `\n  ${input.extraFieldText}` : ""
            }\n}`,
            children
          },
          {
            id: fieldNodeId,
            kind: "field_declaration",
            span: input.fieldSpan,
            text: fieldText
          },
          ...(input.extraFieldText
            ? [
                {
                  id: extraFieldNodeId,
                  kind: "field_declaration",
                  text: input.extraFieldText
                }
              ]
            : [])
        ]
      }
    ]
  };
}

function astAnchorForTarget(graph: CodeSemanticGraph, target: string): CodeAstAnchor | undefined {
  return graph.anchors.find((anchor) => anchor.target === target);
}

function graphFromAstForTest(ast: unknown): CodeSemanticGraph {
  const result = buildCodeSemanticGraphFromAstJson(ast);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(formatAstTestDiagnostics(result.diagnostics));
  }
  return result.value;
}

function requireAstAnchor(graph: CodeSemanticGraph, target: string): CodeAstAnchor {
  const anchor = astAnchorForTarget(graph, target);
  expect(anchor).toBeDefined();
  if (!anchor) {
    throw new Error(`missing AST anchor for ${target}`);
  }
  return anchor;
}

function languageAstFixtures(): { language: string; expected: string; ast: unknown }[] {
  return [
    {
      language: "rust",
      expected: "component AuditStore : GeneratedCandidate",
      ast: rustAuditAstJson()
    },
    {
      language: "typescript",
      expected: "fn appendEvent",
      ast: classFixtureAst({
        language: "typescript",
        path: "src/audit/store.ts",
        rootKind: "program",
        classKind: "class_declaration",
        methodKind: "method_definition",
        classText:
          "class AuditStore {\n  repo: AuditRepo;\n  appendEvent(event: AuditEvent) {\n    this.repo.insert(event);\n  }\n}"
      })
    },
    {
      language: "python",
      expected: "fn append_event",
      ast: classFixtureAst({
        language: "python",
        path: "src/audit/store.py",
        rootKind: "module",
        classKind: "class_definition",
        methodKind: "function_definition",
        classText:
          "class AuditStore:\n    repo: AuditRepo\n    def append_event(self, event):\n        self.repo.insert(event)"
      })
    },
    {
      language: "go",
      expected: "component AuditStore : GeneratedCandidate",
      ast: goReceiverAstJson()
    }
  ];
}

function goReceiverAstJson(): unknown {
  return {
    language: "go",
    files: [
      {
        path: "src/audit/store.go",
        root: "root",
        nodes: [
          {
            id: "root",
            kind: "source_file",
            children: ["store", "append"]
          },
          {
            id: "store",
            kind: "type_declaration",
            attributes: { name: "AuditStore" },
            text: "type AuditStore struct {\n  repo AuditRepo\n}"
          },
          {
            id: "append",
            kind: "function_declaration",
            attributes: { name: "AppendEvent" },
            text: "func (s *AuditStore) AppendEvent(event AuditEvent) {\n  s.repo.Insert(event)\n}"
          }
        ]
      }
    ]
  };
}

function classFixtureAst(input: {
  language: string;
  path: string;
  rootKind: string;
  classKind: string;
  methodKind: string;
  classText: string;
}): unknown {
  return {
    language: input.language,
    files: [
      {
        path: input.path,
        root: "root",
        nodes: [
          {
            id: "root",
            kind: input.rootKind,
            children: ["repo", "store"]
          },
          {
            id: "repo",
            kind: input.classKind,
            attributes: { name: "AuditRepo" },
            text: "class AuditRepo {\n  insert(event: AuditEvent) {}\n}",
            children: ["insert"]
          },
          {
            id: "insert",
            kind: input.methodKind,
            attributes: { name: "insert" },
            text: "insert(event: AuditEvent) {}"
          },
          {
            id: "store",
            kind: input.classKind,
            attributes: { name: "AuditStore" },
            text: input.classText,
            children: ["append"]
          },
          {
            id: "append",
            kind: input.methodKind,
            attributes: {
              name: input.language === "python" ? "append_event" : "appendEvent"
            },
            text:
              input.language === "python"
                ? "def append_event(self, event):\n    self.repo.insert(event)"
                : "appendEvent(event: AuditEvent) {\n  this.repo.insert(event);\n}"
          }
        ]
      }
    ]
  };
}

function span(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): SourceSpan {
  return { startLine, startColumn, endLine, endColumn };
}

function formatAstTestDiagnostics(diagnostics: { message: string }[]): string {
  return diagnostics.map((diagnostic) => diagnostic.message).join("\n");
}

type FakeTreeSitterPosition = {
  row: number;
  column: number;
};

type FakeTreeSitterNode = {
  kind: () => string;
  isNamed: () => boolean;
  startPosition: () => FakeTreeSitterPosition;
  endPosition: () => FakeTreeSitterPosition;
  startByte: () => number;
  endByte: () => number;
  childCount: () => number;
  child: (index: number) => FakeTreeSitterNode | undefined;
  fieldNameForChild: (index: number) => string | undefined;
  hasError: () => boolean;
};

function fakeTreeSitterNode(input: {
  kind: string;
  startByte: number;
  endByte: number;
  startPosition: FakeTreeSitterPosition;
  endPosition: FakeTreeSitterPosition;
  children?: { fieldName?: string; node: FakeTreeSitterNode }[];
  hasError?: boolean;
}): FakeTreeSitterNode {
  const children = input.children ?? [];
  return {
    kind: () => input.kind,
    isNamed: () => true,
    startPosition: () => input.startPosition,
    endPosition: () => input.endPosition,
    startByte: () => input.startByte,
    endByte: () => input.endByte,
    childCount: () => children.length,
    child: (index) => children[index]?.node,
    fieldNameForChild: (index) => children[index]?.fieldName,
    hasError: () => input.hasError === true
  };
}
