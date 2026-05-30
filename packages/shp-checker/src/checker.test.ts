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
  listMemoryGuardsShapeModules,
  listShapeObligations,
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
  type CodeSemanticGraph
} from "./ast-generation-core.ts";
import { signatureText } from "./ast-generation-tokens.ts";
import { shapeReservedWords, stableJson, stableShapeId } from "./ast-generation-utils.ts";
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
  return checkShapeModules([requireParsed(source)]);
}

function requireParsed(source: string) {
  const parsed = parseShapeModule(source);
  if (!parsed.ok) {
    throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  return parsed.module;
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
    expect(output).toContain("candidate effect StalePin pins Anchor");
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
      module governance
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

  test("keeps rule subjects in when clauses instead of generic rule headers", () => {
    const parsed = parseShapeModule(`
      module governance

      trait Immutable {
      }

      rule immutable_forbids_delete<T> {
        forbid final HardDelete<T>
      }
    `);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toContain(
        "Expecting token of type '{'"
      );
    }
  });

  test("rejects unknown and ambiguous concrete forbid targets", () => {
    const unknown = parseShapeModule(`
      module governance

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
      module governance
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

  test("explain and graph report ambiguous unqualified symbols", () => {
    const left = parseShapeModule(`
      module left
      component Ledger {
      }
    `);
    const right = parseShapeModule(`
      module right
      component Ledger {
      }
    `);

    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (!left.ok || !right.ok) {
      return;
    }

    const explanation = explainShapeModules([left.module, right.module], "Ledger");
    expect(explanation).toContain("Ambiguous shape symbol Ledger.");
    expect(explanation).toContain("component left::Ledger");
    expect(explanation).toContain("component right::Ledger");
    expect(explanation).toContain("Use a module-qualified reference.");

    const graph = graphShapeModules([left.module, right.module], "Ledger");
    expect(graph).toContain("Ambiguous shape symbol Ledger.");
    expect(graph).toContain("component left::Ledger");
    expect(graph).toContain("component right::Ledger");
  });

  test("explain and graph report cross-kind ambiguous unqualified symbols", () => {
    const left = parseShapeModule(`
      module left
      resource Ledger
    `);
    const right = parseShapeModule(`
      module right
      component Ledger {
      }
    `);

    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (!left.ok || !right.ok) {
      return;
    }

    const explanation = explainShapeModules([left.module, right.module], "Ledger");
    expect(explanation).toContain("Ambiguous shape symbol Ledger.");
    expect(explanation).toContain("resource left::Ledger");
    expect(explanation).toContain("component right::Ledger");
    expect(explanation).toContain("Use a module-qualified reference.");

    const graph = graphShapeModules([left.module, right.module], "Ledger");
    expect(graph).toContain("Ambiguous shape symbol Ledger.");
    expect(graph).toContain("resource left::Ledger");
    expect(graph).toContain("component right::Ledger");
    expect(graph).toContain("Use a module-qualified reference.");
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

describe("Shape property-level guarded changes", () => {
  function inlineGuardModel(modifyTraits: string, modifyDescription: string): string {
    return `
      module gateway

      resource PolicySnapshot
      resource DecisionLog

      component Gateway {
        owns PolicySnapshot
        owns DecisionLog
        grants Read<PolicySnapshot>
        grants Append<DecisionLog>
        fn derivePolicyDecision : PreserveInline
          description required "Policy branches stay local for auditability."
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale DerivePolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Branches inline for auditability."
        owner GatewayTeam
        protects shape PreserveInline
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      change RefactorDecision {
        modify fn Gateway.derivePolicyDecision${modifyTraits}${modifyDescription}
          effects complete {
            Read<PolicySnapshot>
            Append<DecisionLog>
          }
      }
    `;
  }

  test("passes when a precise guard's protected trait is preserved", () => {
    const result = checkShapeSource(
      inlineGuardModel(
        " : PreserveInline",
        '\n          description required "Policy branches stay local for auditability."'
      )
    );

    expect(result.exitCode).toBe(0);
  });

  test("fails when a guarded shape trait is removed", () => {
    const result = checkShapeSource(
      inlineGuardModel(
        "",
        '\n          description required "Policy branches stay local for auditability."'
      )
    );
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("guarded shape changed");
    expect(output).toContain("removes shape trait PreserveInline from the guarded target");
  });

  test("fails when a guarded description is removed", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : RefactorSensitive
          description required "Decision rationale lives next to the code."
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory DecisionDescriptionGuard : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Explained
        confidence High
        summary "The local description is required context for reviewers."
        owner GatewayTeam
        protects description
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      change DropDescription {
        modify fn Gateway.derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("guarded shape changed");
    expect(output).toContain("removes description from the guarded target");
  });

  test("passes a precise guarded property removal with a matching reevaluation", () => {
    const result = checkShapeSource(`
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

      rationale DerivePolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Branches inline for auditability."
        owner GatewayTeam
        protects shape PreserveInline
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      reevaluation InlineExtracted {
        satisfies rationale DerivePolicyInline
        outcome Replaced
        summary "Helper extraction keeps the audited branch structure."
        evidence test("gateway/inline.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }

      change ExtractHelper {
        modify fn Gateway.derivePolicyDecision
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("keeps coarse guard behavior when no protected property is detectable", () => {
    const result = checkShapeSource(`
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

      rationale CheckOrderMatters : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why Auditability
        summary "Check order controls the visible failure."
        owner GatewayTeam
        protects shape CheckOrder
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      change ReorderChecks {
        modify fn Gateway.derivePolicyDecision : ProtectedCheckOrder
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("guarded shape changed");
    expect(output).toContain("modifies the guarded target");
  });

  test("enforces guards on a modified component target", () => {
    const guarded = `
      module gateway

      resource PolicySnapshot

      component Gateway : RefactorSensitive {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory GatewayBoundary : ${contextRef("RefactorConstraint", "component Gateway")} {
        applies_to component Gateway
        status Unexplained
        confidence High
        summary "The Gateway boundary isolates policy evaluation."
        owner GatewayTeam
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      change WidenGateway {
        modify component Gateway : RefactorSensitive {
          owns PolicySnapshot
          grants Read<PolicySnapshot>
          grants Append<PolicySnapshot>
          fn read
            effects complete {
              Read<PolicySnapshot>
            }
        }
      }
    `;
    const withoutReevaluation = checkShapeSource(guarded);
    const output = formatDiagnostics(withoutReevaluation);

    expect(withoutReevaluation.exitCode).toBe(1);
    expect(output).toContain("guarded shape changed");
    expect(output).toContain("component Gateway is protected by memory");

    const withReevaluation = checkShapeSource(`${guarded}
      reevaluation GatewayBoundaryRechecked {
        satisfies memory GatewayBoundary
        outcome Confirmed
        summary "Widening the grant preserves the isolation boundary."
        evidence test("gateway/boundary.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }
    `);

    expect(withReevaluation.exitCode).toBe(0);
  });

  test("fires a precise guard when the protected trait is removed by remove fn", () => {
    const result = checkShapeSource(`
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

      rationale DerivePolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Branches inline for auditability."
        owner GatewayTeam
        protects shape PreserveInline
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      change RemoveDecision {
        remove fn Gateway.derivePolicyDecision
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("removes shape trait PreserveInline from the guarded target");
  });

  test("enforces coarse guards on a removed component", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway : RefactorSensitive {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory GatewayBoundary : ${contextRef("RefactorConstraint", "component Gateway")} {
        applies_to component Gateway
        status Unexplained
        confidence High
        summary "The Gateway boundary isolates policy evaluation."
        owner GatewayTeam
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      change DropGateway {
        remove component Gateway
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("component Gateway is protected by memory");
    expect(output).toContain("modifies the guarded target");
  });

  test("falls back to coarse when protects clauses mix detectable and free-form", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot
      resource DecisionLog

      component Gateway {
        owns PolicySnapshot
        owns DecisionLog
        grants Read<PolicySnapshot>
        grants Append<DecisionLog>
        fn derivePolicyDecision : PreserveInline
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale DerivePolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Branches inline for auditability."
        owner GatewayTeam
        protects shape PreserveInline
        protects shape CheckOrder
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      change WidenEffects {
        modify fn Gateway.derivePolicyDecision : PreserveInline
          effects complete {
            Read<PolicySnapshot>
            Append<DecisionLog>
          }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("modifies the guarded target");
    expect(output).not.toContain("removes shape trait");
  });

  test("lists a valueless protects description without a trailing space", () => {
    const listing = listMemoryGuardsShapeModules([
      requireParsed(`
        module gateway

        resource PolicySnapshot

        component Gateway {
          owns PolicySnapshot
          grants Read<PolicySnapshot>
          fn derivePolicyDecision : RefactorSensitive
            description required "Decision rationale lives next to the code."
            effects complete {
              Read<PolicySnapshot>
            }
        }

        memory DecisionDescriptionGuard : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
          applies_to fn Gateway.derivePolicyDecision
          status Explained
          confidence High
          summary "The local description is required context for reviewers."
          owner GatewayTeam
          protects description
        }
      `)
    ]);

    expect(listing).toContain("protects: description");
    expect(listing.split("\n").some((line) => line.endsWith(" "))).toBe(false);
  });

  test("treats a description-protect on a component as coarse, not silently inert", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway : RefactorSensitive {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory GatewayBoundary : ${contextRef("RefactorConstraint", "component Gateway")} {
        applies_to component Gateway
        status Unexplained
        confidence High
        summary "The Gateway boundary isolates policy evaluation."
        owner GatewayTeam
        protects description
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      change DropGateway {
        remove component Gateway
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("modifies the guarded target");
  });
});

describe("Shape role and approver policy", () => {
  function policyModel(options: {
    policy?: boolean;
    sensitive?: boolean;
    roles?: boolean;
    reviewer?: string;
    approver?: string;
  }): string {
    const policy = options.policy ? "policy ReviewPolicy {\n  require approver\n}" : "";
    const roles = options.roles ? "role Security\n      role GatewayTeam" : "";
    const sensitive = options.sensitive ? "\n        sensitive" : "";
    const approver = options.approver ? `\n        approver ${options.approver}` : "";
    return `
      module gateway

      resource PolicySnapshot

      ${roles}

      ${policy}

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High${sensitive}
        summary "Security-sensitive decision path."
        owner GatewayTeam
      }

      reevaluation DecisionReviewed {
        satisfies memory DecisionConstraint
        outcome Confirmed
        summary "Reviewed and confirmed."
        evidence test("gateway/decision.test.ts")
        reviewer ${options.reviewer ?? "GatewayTeam"}${approver}
        decided_on "2026-06-02"
      }
    `;
  }

  test("requires an approver for a sensitive memory under an approver policy", () => {
    const missing = checkShapeSource(policyModel({ policy: true, sensitive: true }));
    const output = formatDiagnostics(missing);

    expect(missing.exitCode).toBe(1);
    expect(output).toContain("missing approver required by policy");

    const satisfied = checkShapeSource(
      policyModel({ policy: true, sensitive: true, approver: "Security" })
    );
    expect(satisfied.exitCode).toBe(0);
  });

  test("keeps approver optional without an approver policy", () => {
    const result = checkShapeSource(policyModel({ sensitive: true }));

    expect(result.exitCode).toBe(0);
  });

  test("keeps approver optional for non-sensitive memories under a policy", () => {
    const result = checkShapeSource(policyModel({ policy: true }));

    expect(result.exitCode).toBe(0);
  });

  test("rejects a reviewer that is not a declared role", () => {
    const result = checkShapeSource(policyModel({ roles: true, reviewer: "UnknownTeam" }));
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("unknown reviewer role UnknownTeam");
  });

  test("rejects an approver that is not a declared role", () => {
    const result = checkShapeSource(policyModel({ roles: true, approver: "Outsiders" }));
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("unknown approver role Outsiders");
  });

  test("accepts declared reviewer and approver roles", () => {
    const result = checkShapeSource(
      policyModel({ roles: true, reviewer: "GatewayTeam", approver: "Security" })
    );

    expect(result.exitCode).toBe(0);
  });

  test("does not validate roles when none are declared", () => {
    const result = checkShapeSource(policyModel({ reviewer: "AnyTeam", approver: "AnyApprover" }));

    expect(result.exitCode).toBe(0);
  });

  test("parses and formats role, policy, and sensitive declarations", () => {
    const result = formatShapeSource(`
      policy ReviewPolicy { require approver }
      role Security
      component Gateway { grants Read<PolicySnapshot> owns PolicySnapshot fn derivePolicyDecision : RefactorSensitive effects complete { Read<PolicySnapshot> } }
      resource PolicySnapshot
      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} { sensitive summary 'Sensitive.' applies_to fn Gateway.derivePolicyDecision owner GatewayTeam status Unexplained confidence High }
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toContain("role Security");
    expect(result.formatted).toContain("policy ReviewPolicy {\n  require approver\n}");
    expect(result.formatted).toContain("  confidence High\n  sensitive\n");

    const reformatted = formatShapeSource(result.formatted);
    expect(reformatted.ok).toBe(true);
    if (reformatted.ok) {
      expect(reformatted.formatted).toBe(result.formatted);
    }
    // Declaration order: resource (1) < role (7A) < policy (7B) < memory (9).
    const order = ["resource PolicySnapshot", "role Security", "policy ReviewPolicy", "memory"].map(
      (token) => result.formatted.indexOf(token)
    );
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  test("authorises a role declared in another module", () => {
    const roles = requireParsed(`
      module governance
      role Security
    `);
    const gateway = requireParsed(`
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

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        summary "Decision path."
        owner Security
      }

      reevaluation DecisionReviewed {
        satisfies memory DecisionConstraint
        outcome Confirmed
        summary "Reviewed."
        evidence test("gateway/decision.test.ts")
        reviewer Security
        decided_on "2026-06-02"
      }
    `);

    expect(checkShapeModules([roles, gateway]).exitCode).toBe(0);
  });

  test("keeps approver optional under a policy that does not require an approver", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      policy AdvisoryPolicy {
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        sensitive
        summary "Sensitive."
        owner GatewayTeam
      }

      reevaluation DecisionReviewed {
        satisfies memory DecisionConstraint
        outcome Confirmed
        summary "Reviewed."
        evidence test("gateway/decision.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("accepts duplicate role declarations idempotently", () => {
    const result = checkShapeSource(`
      module gateway
      role Security
      role Security
    `);

    expect(result.exitCode).toBe(0);
  });
});

describe("Shape user-defined context obligations", () => {
  test("a user trait require_context obligation behaves like a prelude one", () => {
    const base = `
      module gateway

      resource PolicySnapshot

      trait PreserveLocal<T: Fn> {
        require_context LocalRationale<T> satisfied_by rationale
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : PreserveLocal
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `;
    const missing = checkShapeSource(base);
    const missingOutput = formatDiagnostics(missing);
    expect(missing.exitCode).toBe(1);
    expect(missingOutput).toContain("missing required context");
    expect(missingOutput).toContain(
      contextRef("LocalRationale", fnTarget("Gateway.derivePolicyDecision"))
    );
    expect(missingOutput).toContain("trait PreserveLocal require_context");

    const satisfied = checkShapeSource(`${base}
      rationale LocalReason : ${contextRef("LocalRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Kept local."
        owner GatewayTeam
      }
    `);
    expect(satisfied.exitCode).toBe(0);
  });

  test("satisfied_by restricts which context kind satisfies the obligation", () => {
    const base = `
      module bridge

      resource Attestation

      trait DelaySensitive<T: Fn> {
        require_context DelayConstraint<T> satisfied_by memory
      }

      component BridgePoller {
        owns Attestation
        grants Read<Attestation>
        fn pollAttestation : DelaySensitive
          effects complete {
            Read<Attestation>
          }
      }
    `;
    const withRationale = checkShapeSource(`${base}
      rationale PollDelay : ${contextRef("DelayConstraint", fnTarget("BridgePoller.pollAttestation"))} {
        applies_to fn BridgePoller.pollAttestation
        why ExternalProtocolConstraint
        summary "A rationale must not satisfy a memory-only obligation."
        owner BridgeTeam
      }
    `);
    expect(withRationale.exitCode).toBe(1);

    const withMemory = checkShapeSource(`${base}
      memory PollDelay : ${contextRef("DelayConstraint", fnTarget("BridgePoller.pollAttestation"))} {
        applies_to fn BridgePoller.pollAttestation
        status Unexplained
        confidence High
        summary "Lowering the delay caused settlement failures."
        owner BridgeTeam
      }
    `);
    expect(withMemory.exitCode).toBe(0);
  });

  test("derives the target kind from the trait type parameter bound", () => {
    const missing = checkShapeSource(`
      module audit

      trait ComponentBoundary<T: Component> {
        require_context BoundaryReason<T>
      }

      resource AuditEvent

      component AuditStore : ComponentBoundary {
        owns AuditEvent
        grants Read<AuditEvent>
        fn read
          effects complete {
            Read<AuditEvent>
          }
      }
    `);
    const output = formatDiagnostics(missing);

    expect(missing.exitCode).toBe(1);
    expect(output).toContain("component AuditStore has shape ComponentBoundary");
    expect(output).toContain(contextRef("BoundaryReason", "component AuditStore"));
  });

  test("keeps the hardcoded prelude obligations working alongside user traits", () => {
    const result = checkShapeSource(`
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
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain(
      contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))
    );
  });

  test("parses and formats require_context trait members", () => {
    const result = formatShapeSource(`
      trait PreserveLocal<T: Fn> { require_context LocalRationale<T> satisfied_by rationale or memory }
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.formatted).toContain(
      "require_context LocalRationale<T> satisfied_by rationale or memory"
    );
  });

  test("accepts either kind when satisfied_by is omitted", () => {
    const base = (context: string) => `
      module gateway

      resource PolicySnapshot

      trait FlexibleLocal<T: Fn> {
        require_context LocalReason<T>
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : FlexibleLocal
          effects complete {
            Read<PolicySnapshot>
          }
      }

      ${context}
    `;
    const withRationale = checkShapeSource(
      base(`rationale R : ${contextRef("LocalReason", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Reason."
        owner GatewayTeam
      }`)
    );
    const withMemory = checkShapeSource(
      base(`memory M : ${contextRef("LocalReason", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        summary "Reason."
        owner GatewayTeam
      }`)
    );

    expect(withRationale.exitCode).toBe(0);
    expect(withMemory.exitCode).toBe(0);
  });

  test("satisfies a component-target user obligation with a memory", () => {
    const result = checkShapeSource(`
      module audit

      trait ComponentBoundary<T: Component> {
        require_context BoundaryReason<T> satisfied_by memory
      }

      resource AuditEvent

      component AuditStore : ComponentBoundary {
        owns AuditEvent
        grants Read<AuditEvent>
        fn read
          effects complete {
            Read<AuditEvent>
          }
      }

      memory AuditStoreBoundary : ${contextRef("BoundaryReason", "component AuditStore")} {
        applies_to component AuditStore
        status Unexplained
        confidence High
        summary "Boundary is load-bearing."
        owner AuditTeam
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("defaults an unbound type parameter to a function target", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      trait Unbound<T> {
        require_context UnboundReason<T>
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : Unbound
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain(contextRef("UnboundReason", fnTarget("Gateway.derivePolicyDecision")));
  });

  test("reports require_context with an undeclared type parameter or unsupported bound", () => {
    const result = checkShapeSource(`
      module m

      trait BadTarget<T: Component> {
        require_context Reason<X>
      }

      trait BadBound<T: Fnn> {
        require_context Reason<T>
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("invalid require_context");
    expect(output).toContain("type parameter X is not declared by the trait");
    expect(output).toContain("unsupported bound Fnn");
  });

  test("a user trait shadows a same-named prelude obligation via name resolution", () => {
    // Declaring a trait named like a prelude trait (RefactorSensitive) makes
    // `: RefactorSensitive` resolve to the local trait, so the user obligation
    // replaces the prelude one rather than stacking with it.
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      trait RefactorSensitive<T: Fn> {
        require_context LocalReason<T> satisfied_by rationale
      }

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision : RefactorSensitive
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale R : ${contextRef("LocalReason", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Reason."
        owner GatewayTeam
      }
    `);

    // The prelude RefactorSensitive requires a memory; the local trait requires
    // a rationale. A rationale satisfying the local obligation passes, proving
    // the local trait shadowed the prelude one.
    expect(result.exitCode).toBe(0);
  });
});

describe("Shape nested memory guard blocks", () => {
  const nested = `
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

    rationale PolicyInline : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
      applies_to fn Gateway.derivePolicyDecision
      why CognitiveLocality
      summary "Inline."
      protects {
        shape PreserveInline
        description
      }
      guards {
        on_change require ${contextRef("ReEvaluation", "Self")}
        forbid transform ExtractHelper
      }
      who {
        owner GatewayTeam
      }
      when {
        review_by "2026-08-18"
      }
    }
  `;

  const flat = `
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

    rationale PolicyInline : ${contextRef("CheckOrderRationale", fnTarget("Gateway.derivePolicyDecision"))} {
      applies_to fn Gateway.derivePolicyDecision
      why CognitiveLocality
      summary "Inline."
      owner GatewayTeam
      review_by "2026-08-18"
      protects shape PreserveInline
      protects description
      guards on_change require ${contextRef("ReEvaluation", "Self")}
      guards forbid transform ExtractHelper
    }
  `;

  test("parses and checks nested rationale blocks", () => {
    expect(checkShapeSource(nested).exitCode).toBe(0);
  });

  test("formatter canonicalizes nested blocks to the flat form", () => {
    const nestedFormatted = formatShapeSource(nested);
    const flatFormatted = formatShapeSource(flat);

    expect(nestedFormatted.ok).toBe(true);
    expect(flatFormatted.ok).toBe(true);
    if (!nestedFormatted.ok || !flatFormatted.ok) {
      return;
    }
    expect(nestedFormatted.formatted).toBe(flatFormatted.formatted);
    expect(nestedFormatted.formatted).not.toContain("protects {");
    expect(nestedFormatted.formatted).not.toContain("who {");
  });

  test("nested guards block still enforces a forbid-transform guard", () => {
    const result = checkShapeSource(`
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

      rationale PolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Inline."
        guards {
          forbid transform ExtractHelper
        }
      }

      change ExtractIt {
        modify fn Gateway.derivePolicyDecision : PreserveInline
          transform ExtractHelper
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("applies the ExtractHelper transform to the guarded target");
  });

  test("supports nested blocks in a memory declaration", () => {
    const result = checkShapeSource(`
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

      memory PollConstraint : ${contextRef("RefactorConstraint", fnTarget("BridgePoller.pollAttestation"))} {
        applies_to fn BridgePoller.pollAttestation
        status Unexplained
        confidence High
        summary "Timing-sensitive."
        who {
          owner BridgeTeam
        }
      }
    `);

    expect(result.exitCode).toBe(0);
  });
});

describe("Shape grammar keyword reservation", () => {
  test("reserved words cover every ID-shaped grammar keyword", async () => {
    const grammar = await Bun.file(join(import.meta.dir, "language", "shape.langium")).text();
    const keywords = new Set(
      [...grammar.matchAll(/'([a-zA-Z_][a-zA-Z0-9_]*)'/g)].map((match) => match[1] as string)
    );
    const reserved = shapeReservedWords();
    const missing = [...keywords].filter((keyword) => !reserved.has(keyword)).sort();

    expect(missing).toEqual([]);
  });
});

describe("Shape dependency-target guards", () => {
  function relationGuardModel(options: { reevaluation?: boolean; remove?: boolean } = {}): string {
    const change = options.remove
      ? `change RewireFlow {
          remove relation PollerCallsSettlement
        }`
      : `change RewireFlow {
          modify relation PollerCallsSettlement {
            kind calls
            connects BridgePoller -> Settlement
            summary "RewiredFlow"
          }
        }`;
    const reevaluation = options.reevaluation
      ? `reevaluation FlowRewireReviewed {
          satisfies memory PollerSettlementCoupling
          outcome Confirmed
          summary "The rewired flow preserves settlement timing."
          evidence test("bridge/flow.test.ts")
          reviewer BridgeTeam
          decided_on "2026-06-02"
        }`
      : "";
    return `
      module deps

      resource Attestation

      component BridgePoller {
        owns Attestation
        grants Read<Attestation>
        fn poll
          effects complete {
            Read<Attestation>
          }
      }

      component Settlement {
        grants Read<Attestation>
        fn settle
          effects complete {
            Read<Attestation>
          }
      }

      relation PollerCallsSettlement {
        kind calls
        connects BridgePoller -> Settlement
        summary "BridgeFlow"
      }

      memory PollerSettlementCoupling : ${contextRef("RefactorConstraint", "relation PollerCallsSettlement")} {
        applies_to relation PollerCallsSettlement
        status Unexplained
        confidence High
        summary "The poller-settlement call edge is timing-sensitive."
        owner BridgeTeam
        guards on_change require ${contextRef("ReEvaluation", "Self")}
      }

      ${change}
      ${reevaluation}
    `;
  }

  test("fails when a guarded dependency edge is modified without reevaluation", () => {
    const result = checkShapeSource(relationGuardModel());
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("guarded shape changed");
    expect(output).toContain("relation PollerCallsSettlement is protected by memory");
  });

  test("passes a guarded dependency edge change with a matching reevaluation", () => {
    const result = checkShapeSource(relationGuardModel({ reevaluation: true }));

    expect(result.exitCode).toBe(0);
  });

  test("fails when a guarded dependency edge is removed without reevaluation", () => {
    const result = checkShapeSource(relationGuardModel({ remove: true }));

    expect(result.exitCode).toBe(1);
    expect(formatDiagnostics(result)).toContain("guarded shape changed");
  });

  test("does not guard an unprotected dependency edge change", () => {
    const result = checkShapeSource(`
      module deps

      resource Attestation

      component BridgePoller {
        owns Attestation
        grants Read<Attestation>
        fn poll
          effects complete {
            Read<Attestation>
          }
      }

      component Settlement {
        grants Read<Attestation>
        fn settle
          effects complete {
            Read<Attestation>
          }
      }

      relation PollerCallsSettlement {
        kind calls
        connects BridgePoller -> Settlement
        summary "BridgeFlow"
      }

      change RewireFlow {
        modify relation PollerCallsSettlement {
          kind calls
          connects BridgePoller -> Settlement
          summary "RewiredFlow"
        }
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("explains dependency-edge guards and satisfying context", () => {
    const explanation = explainShapeModules(
      [requireParsed(relationGuardModel())],
      "PollerCallsSettlement"
    );

    expect(explanation).toContain("kind: relation");
    expect(explanation).toContain("memory guards:");
    expect(explanation).toContain("memory deps::PollerSettlementCoupling");
  });
});

describe("Shape transform guards", () => {
  function transformGuardModel(forbidden: string, applied: string): string {
    return `
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

      rationale DerivePolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Branches inline for auditability."
        owner GatewayTeam
        guards forbid transform ${forbidden}
      }

      change ApplyTransform {
        modify fn Gateway.derivePolicyDecision : PreserveInline
          transform ${applied}
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `;
  }

  test("fails when a forbidden transform is applied without reevaluation", () => {
    const result = checkShapeSource(transformGuardModel("ExtractHelper", "ExtractHelper"));
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("guarded shape changed");
    expect(output).toContain("applies the ExtractHelper transform to the guarded target");
  });

  test("does not fire when an applied transform is not forbidden", () => {
    const result = checkShapeSource(transformGuardModel("ExtractHelper", "RenameSymbol"));

    expect(result.exitCode).toBe(0);
  });

  test("passes a forbidden transform with a matching reevaluation", () => {
    const result = checkShapeSource(`
      ${transformGuardModel("ExtractHelper", "ExtractHelper")}
      reevaluation ExtractHelperReviewed {
        satisfies rationale DerivePolicyInline
        outcome Replaced
        summary "Helper extraction keeps the audited branch structure intact."
        evidence test("gateway/extract-helper.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("matches a forbidden transform among several applied labels", () => {
    const result = checkShapeSource(
      transformGuardModel("SplitDecisionTree", "RenameSymbol, SplitDecisionTree")
    );
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("applies the SplitDecisionTree transform to the guarded target");
  });

  test("parses and formats transform intent and forbid-transform guards", () => {
    const result = formatShapeSource(`
      rationale DerivePolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} { guards forbid transform ExtractHelper summary 'Inline.' owner GatewayTeam why CognitiveLocality applies_to fn Gateway.derivePolicyDecision }
      component Gateway { grants Read<PolicySnapshot> owns PolicySnapshot fn derivePolicyDecision : PreserveInline effects complete { Read<PolicySnapshot> } }
      resource PolicySnapshot
      change ApplyTransform { modify fn Gateway.derivePolicyDecision : PreserveInline transform ExtractHelper, RemoveDescription effects complete { Read<PolicySnapshot> } }
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toContain("guards forbid transform ExtractHelper");
    expect(result.formatted).toContain("    transform ExtractHelper, RemoveDescription");
  });

  test("enforces forbid-transform guards declared on a memory", () => {
    const guarded = `
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

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        summary "Splitting the decision tree changed visible failures before."
        owner GatewayTeam
        guards forbid transform SplitDecisionTree
      }

      change SplitIt {
        modify fn Gateway.derivePolicyDecision : RefactorSensitive
          transform SplitDecisionTree
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `;
    const withoutReevaluation = checkShapeSource(guarded);
    expect(withoutReevaluation.exitCode).toBe(1);
    expect(formatDiagnostics(withoutReevaluation)).toContain(
      "applies the SplitDecisionTree transform to the guarded target"
    );

    const withReevaluation = checkShapeSource(`${guarded}
      reevaluation DecisionSplitReviewed {
        satisfies memory DecisionConstraint
        outcome Replaced
        summary "The split preserves visible failure ordering."
        evidence test("gateway/split.test.ts")
        reviewer GatewayTeam
        decided_on "2026-06-02"
      }
    `);
    expect(withReevaluation.exitCode).toBe(0);
  });

  test("treats transform intent on an unguarded function as inert", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn derivePolicyDecision
          effects complete {
            Read<PolicySnapshot>
          }
      }

      change ExtractIt {
        modify fn Gateway.derivePolicyDecision
          transform ExtractHelper
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("matches multiple forbidden transforms independently", () => {
    const result = checkShapeSource(`
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

      rationale DerivePolicyInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        why CognitiveLocality
        summary "Branches inline for auditability."
        owner GatewayTeam
        guards forbid transform ExtractHelper
        guards forbid transform SplitDecisionTree
      }

      change RefactorBoth {
        modify fn Gateway.derivePolicyDecision : PreserveInline
          transform ExtractHelper, SplitDecisionTree
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("applies the ExtractHelper transform");
    expect(output).toContain("applies the SplitDecisionTree transform");
  });

  test("reports a single diagnostic when on_change and forbid-transform both fire", () => {
    const result = checkShapeSource(`
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

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        summary "Extracting a helper has historically changed behaviour."
        owner GatewayTeam
        guards on_change require ${contextRef("ReEvaluation", "Self")}
        guards forbid transform ExtractHelper
      }

      change ExtractIt {
        modify fn Gateway.derivePolicyDecision : RefactorSensitive
          transform ExtractHelper
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const guardedChanges = result.diagnostics.filter(
      (diagnostic) => diagnostic.kind === "guarded_shape_changed"
    );

    expect(guardedChanges).toHaveLength(1);
    expect(formatDiagnostics(result)).toContain(
      "applies the ExtractHelper transform to the guarded target"
    );
  });

  test("keeps the coarse guard when a non-matching transform is applied alongside on_change", () => {
    const result = checkShapeSource(`
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

      memory DecisionConstraint : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} {
        applies_to fn Gateway.derivePolicyDecision
        status Unexplained
        confidence High
        summary "Extracting a helper has historically changed behaviour."
        owner GatewayTeam
        guards on_change require ${contextRef("ReEvaluation", "Self")}
        guards forbid transform ExtractHelper
      }

      change RenameIt {
        modify fn Gateway.derivePolicyDecision : RefactorSensitive
          transform RenameSymbol
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const guardedChanges = result.diagnostics.filter(
      (diagnostic) => diagnostic.kind === "guarded_shape_changed"
    );

    expect(guardedChanges).toHaveLength(1);
    expect(formatDiagnostics(result)).toContain("modifies the guarded target");
  });
});

describe("Shape component and resource shape traits", () => {
  test("requires a RefactorConstraint memory for a RefactorSensitive component", () => {
    const missing = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway : RefactorSensitive {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const missingOutput = formatDiagnostics(missing);

    expect(missing.exitCode).toBe(1);
    expect(missingOutput).toContain("missing required context");
    expect(missingOutput).toContain("component Gateway has shape RefactorSensitive");
    expect(missingOutput).toContain(contextRef("RefactorConstraint", "component Gateway"));

    const satisfied = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway : RefactorSensitive {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }

      memory GatewayShapeConstraint : ${contextRef("RefactorConstraint", "component Gateway")} {
        applies_to component Gateway
        status Unexplained
        confidence High
        summary "The Gateway boundary isolates policy evaluation from transport."
        owner GatewayTeam
      }
    `);

    expect(satisfied.exitCode).toBe(0);
  });

  test("requires a RefactorConstraint memory for a RefactorSensitive resource", () => {
    const missing = checkShapeSource(`
      module audit

      resource AuditEvent : RefactorSensitive

      component AuditStore {
        owns AuditEvent
        grants Read<AuditEvent>
        fn read
          effects complete {
            Read<AuditEvent>
          }
      }
    `);
    const missingOutput = formatDiagnostics(missing);

    expect(missing.exitCode).toBe(1);
    expect(missingOutput).toContain("resource AuditEvent has shape RefactorSensitive");
    expect(missingOutput).toContain(contextRef("RefactorConstraint", "resource AuditEvent"));

    const satisfied = checkShapeSource(`
      module audit

      resource AuditEvent : RefactorSensitive

      component AuditStore {
        owns AuditEvent
        grants Read<AuditEvent>
        fn read
          effects complete {
            Read<AuditEvent>
          }
      }

      memory AuditEventLayout : ${contextRef("RefactorConstraint", "resource AuditEvent")} {
        applies_to resource AuditEvent
        status Explained
        confidence High
        summary "External auditors depend on the AuditEvent field layout."
        owner AuditTeam
      }
    `);

    expect(satisfied.exitCode).toBe(0);
  });

  test("satisfies a NonIdiomatic component with a rationale", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway : NonIdiomatic {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale GatewayDesign : ${contextRef("DesignRationale", "component Gateway")} {
        applies_to component Gateway
        why LegacyCompatibility
        summary "Gateway keeps a non-idiomatic facade for the legacy transport."
        owner GatewayTeam
      }
    `);

    expect(result.exitCode).toBe(0);
  });

  test("requires a TestOnlyPurpose rationale for a TestOnly component", () => {
    const missing = checkShapeSource(`
      module e2e

      resource Fixture

      component E2EHarness : TestOnly {
        owns Fixture
        grants Read<Fixture>
        fn seed
          effects complete {
            Read<Fixture>
          }
      }
    `);
    const missingOutput = formatDiagnostics(missing);

    expect(missing.exitCode).toBe(1);
    expect(missingOutput).toContain("component E2EHarness has shape TestOnly");
    expect(missingOutput).toContain(contextRef("TestOnlyPurpose", "component E2EHarness"));

    const satisfied = checkShapeSource(`
      module e2e

      resource Fixture

      component E2EHarness : TestOnly {
        owns Fixture
        grants Read<Fixture>
        fn seed
          effects complete {
            Read<Fixture>
          }
      }

      rationale E2EHarnessPurpose : ${contextRef("TestOnlyPurpose", "component E2EHarness")} {
        applies_to component E2EHarness
        why E2ETesting
        summary "E2EHarness exists only to drive end-to-end fixtures."
        owner QaTeam
      }
    `);

    expect(satisfied.exitCode).toBe(0);
  });

  test("satisfies a NonIdiomatic resource with a rationale", () => {
    const missing = checkShapeSource(`
      module legacy

      resource LegacyRecord : NonIdiomatic

      component LegacyStore {
        owns LegacyRecord
        grants Read<LegacyRecord>
        fn read
          effects complete {
            Read<LegacyRecord>
          }
      }
    `);
    const missingOutput = formatDiagnostics(missing);

    expect(missing.exitCode).toBe(1);
    expect(missingOutput).toContain("resource LegacyRecord has shape NonIdiomatic");
    expect(missingOutput).toContain(contextRef("DesignRationale", "resource LegacyRecord"));

    const satisfied = checkShapeSource(`
      module legacy

      resource LegacyRecord : NonIdiomatic

      component LegacyStore {
        owns LegacyRecord
        grants Read<LegacyRecord>
        fn read
          effects complete {
            Read<LegacyRecord>
          }
      }

      rationale LegacyRecordShape : ${contextRef("DesignRationale", "resource LegacyRecord")} {
        applies_to resource LegacyRecord
        why ExternalProtocolConstraint
        summary "LegacyRecord mirrors a non-idiomatic upstream wire format."
        owner LegacyTeam
      }
    `);

    expect(satisfied.exitCode).toBe(0);
  });

  test("does not let a rationale satisfy a memory-only RefactorSensitive obligation", () => {
    const result = checkShapeSource(`
      module gateway

      resource PolicySnapshot

      component Gateway : RefactorSensitive {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }

      rationale GatewayShape : ${contextRef("RefactorConstraint", "component Gateway")} {
        applies_to component Gateway
        why LegacyCompatibility
        summary "A rationale must not satisfy a RefactorConstraint obligation."
        owner GatewayTeam
      }
    `);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("component Gateway has shape RefactorSensitive");
  });

  test("keeps semantic resource traits free of shape-trait obligations", () => {
    const parsed = requireParsed(`
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
    const result = checkShapeModules([parsed], { includeFacts: true });

    expect(result.exitCode).toBe(0);
    expect(
      result.facts?.some(
        (fact) => fact.kind === "context_required" && fact.target.endsWith("AuditEvent")
      )
    ).toBe(false);
  });

  test("emits context_required facts for component and resource targets", () => {
    const parsed = requireParsed(`
      module gateway

      resource PolicySnapshot : RefactorSensitive

      component Gateway : RefactorSensitive {
        owns PolicySnapshot
        grants Read<PolicySnapshot>
        fn read
          effects complete {
            Read<PolicySnapshot>
          }
      }
    `);
    const result = checkShapeModules([parsed], { includeFacts: true });

    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "context_required",
        targetKind: "component",
        target: "gateway::Gateway",
        contextType: "RefactorConstraint",
        requiredBy: "RefactorSensitive"
      })
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: "context_required",
        targetKind: "resource",
        target: "gateway::PolicySnapshot",
        contextType: "RefactorConstraint",
        requiredBy: "RefactorSensitive"
      })
    );
  });

  test("explains component classifiers and required context", () => {
    const explanation = explainShapeModules(
      [
        requireParsed(`
          module gateway

          resource PolicySnapshot

          component Gateway : RefactorSensitive {
            owns PolicySnapshot
            grants Read<PolicySnapshot>
            fn read
              effects complete {
                Read<PolicySnapshot>
              }
          }

          memory GatewayShapeConstraint : ${contextRef("RefactorConstraint", "component Gateway")} {
            applies_to component Gateway
            status Unexplained
            confidence High
            summary "The Gateway boundary isolates policy evaluation from transport."
            owner GatewayTeam
          }
        `)
      ],
      "Gateway"
    );

    expect(explanation).toContain("classifiers:");
    expect(explanation).toContain("RefactorSensitive");
    expect(explanation).toContain("required context:");
    expect(explanation).toContain(contextRef("RefactorConstraint", "component Gateway"));
    expect(explanation).toContain("satisfied by:");
    expect(explanation).toContain("memory gateway::GatewayShapeConstraint");
  });

  test("explains resource traits and required context", () => {
    const explanation = explainShapeModules(
      [
        requireParsed(`
          module audit

          resource AuditEvent : RefactorSensitive

          component AuditStore {
            owns AuditEvent
            grants Read<AuditEvent>
            fn read
              effects complete {
                Read<AuditEvent>
              }
          }

          memory AuditEventLayout : ${contextRef("RefactorConstraint", "resource AuditEvent")} {
            applies_to resource AuditEvent
            status Explained
            confidence High
            summary "External auditors depend on the AuditEvent field layout."
            owner AuditTeam
          }
        `)
      ],
      "AuditEvent"
    );

    expect(explanation).toContain("required context:");
    expect(explanation).toContain(contextRef("RefactorConstraint", "resource AuditEvent"));
    expect(explanation).toContain("satisfied by:");
    expect(explanation).toContain("memory audit::AuditEventLayout");
  });
});

describe("Shape memory freshness checking", () => {
  function refactorMemorySource(reviewBy?: string): string {
    const reviewByLine = reviewBy === undefined ? "" : `\n        review_by "${reviewBy}"`;
    return `
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
        summary "Earlier attempts to lower this delay caused settlement failures."
        owner BridgeTeam${reviewByLine}
      }
    `;
  }

  function checkWithFreshness(source: string, freshnessDate?: string) {
    const parsed = parseShapeModule(source);
    if (!parsed.ok) {
      throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    }
    return checkShapeModules([parsed.module], { freshnessDate });
  }

  test("flags design memory whose review_by is before the freshness date", () => {
    const result = checkWithFreshness(refactorMemorySource("2026-01-01"), "2026-05-30");
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("stale design memory");
    expect(output).toContain("memory BridgePollingDelayConstraint");
    expect(output).toContain("review_by date 2026-01-01 is before 2026-05-30");
  });

  test("keeps memory fresh on the review_by date itself", () => {
    const result = checkWithFreshness(refactorMemorySource("2026-05-30"), "2026-05-30");

    expect(result.exitCode).toBe(0);
  });

  test("treats future review_by dates as fresh", () => {
    const result = checkWithFreshness(refactorMemorySource("2027-01-01"), "2026-05-30");

    expect(result.exitCode).toBe(0);
  });

  test("ignores memory without a review_by date", () => {
    const result = checkWithFreshness(refactorMemorySource(), "2026-05-30");

    expect(result.exitCode).toBe(0);
  });

  test("does not enforce non-ISO review_by values", () => {
    const result = checkWithFreshness(refactorMemorySource("soon"), "2026-05-30");

    expect(result.exitCode).toBe(0);
  });

  test("does not enforce calendar-invalid ISO-shaped review_by values", () => {
    // These match the YYYY-MM-DD regex but are not real dates; the calendar
    // round-trip in isIsoDate must reject them rather than letting Date roll
    // them forward (2026-02-30 -> 2026-03-02) and suppress a real diagnostic.
    for (const invalid of ["2026-02-30", "2026-13-40"]) {
      const result = checkWithFreshness(refactorMemorySource(invalid), "2026-05-30");
      expect(result.exitCode).toBe(0);
    }
  });

  test("never reports staleness when freshness checking is disabled", () => {
    const result = checkWithFreshness(refactorMemorySource("2020-01-01"));

    expect(result.exitCode).toBe(0);
  });

  test("flags stale rationale review_by dates as well", () => {
    const result = checkWithFreshness(
      `
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
          review_by "2025-01-01"
        }
      `,
      "2026-05-30"
    );
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("stale design memory");
    expect(output).toContain("rationale DerivePolicyDecisionInline");
  });

  test("surfaces stale design memory through obligations in strict freshness mode", () => {
    const parsed = parseShapeModule(refactorMemorySource("2026-01-01"));
    if (!parsed.ok) {
      throw new Error("expected module to parse");
    }

    const withFreshness = listShapeObligations([parsed.module], { freshnessDate: "2026-05-30" });
    expect(withFreshness).toContain("stale design memory:");
    expect(withFreshness).toContain(
      "memory BridgePollingDelayConstraint review_by 2026-01-01 is before 2026-05-30"
    );

    const withoutFreshness = listShapeObligations([parsed.module]);
    expect(withoutFreshness).not.toContain("stale design memory");
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

  test("formats a valueless protects description clause", () => {
    const result = formatShapeSource(`
      memory DescriptionGuard : ${contextRef("RefactorConstraint", fnTarget("Gateway.derivePolicyDecision"))} { protects description summary 'Local description is required context.' applies_to fn Gateway.derivePolicyDecision owner GatewayTeam status Explained confidence High }
      component Gateway { grants Read<PolicySnapshot> owns PolicySnapshot fn derivePolicyDecision : RefactorSensitive effects complete { Read<PolicySnapshot> } }
      resource PolicySnapshot
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.formatted).toContain("  protects description\n");
    expect(result.formatted).not.toContain("protects description ");
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

  test("uses wide deterministic suffixes for generated identity names", () => {
    expect(stableShapeId("src/generated/very/long/path/main.ts:node-a", "Generated")).toMatch(
      /_[0-9a-f]{16}$/
    );
  });

  test("serializes canonical JSON keys by codepoint order", () => {
    expect(stableJson({ b: 1, a: 2, A: 3 })).toBe('{"A":3,"a":2,"b":1}');
    const privateUse = "\ue000";
    const astral = "😀";
    const payload = stableJson({ [astral]: 1, [privateUse]: 2 });
    expect(payload.indexOf(JSON.stringify(privateUse))).toBeLessThan(
      payload.indexOf(JSON.stringify(astral))
    );
  });

  test("keeps braces inside literals out of fingerprint signatures", () => {
    expect(
      signatureText('fn handle(label = "{open}", value: Value) { value }', "typescript")
    ).toContain("value: Value)");
  });

  test("keeps full brace-less declarations in fingerprint signatures", () => {
    expect(signatureText("fn handle(\n  a: A,\n  b: B\n);", "rust")).toContain("b: B");
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

  test("extracts Go named receiver field calls", () => {
    const result = generateShapeFromAstJson(goReceiverCallAstJson(), {
      moduleName: "generated.go"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(formatAstTestDiagnostics(result.diagnostics));
    }
    expect(result.value.semanticShape).toContain("kind calls");
    expect(result.value.semanticShape).toContain("connects AuditStore -> AuditRepo");
  });

  test("skips self-referential receiver calls", () => {
    const result = generateShapeFromAstJson({
      language: "typescript",
      files: [
        {
          path: "src/tree.ts",
          root: "root",
          nodes: [
            { id: "root", kind: "program", children: ["node"] },
            {
              id: "node",
              kind: "class_declaration",
              attributes: { name: "TreeNode" },
              text: "class TreeNode { child: TreeNode; walk() { this.child.walk(); } }",
              children: ["walk"]
            },
            {
              id: "walk",
              kind: "method_definition",
              attributes: { name: "walk" },
              text: "walk() { this.child.walk(); }"
            }
          ]
        }
      ]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(formatAstTestDiagnostics(result.diagnostics));
    }
    expect(result.value.semanticShape).not.toContain("kind calls");
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

    const beforeAnchor = requireAstAnchor(before.value, "MainModule.main");
    const afterAnchor = requireAstAnchor(after.value, "MainModule.main");
    expect(beforeAnchor.name).toBe(afterAnchor.name);
    expect(beforeAnchor.fingerprint.value).not.toBe(afterAnchor.fingerprint.value);
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

    const firstAnchor = requireAstAnchor(versionOne.value, "MainModule.main");
    const secondAnchor = requireAstAnchor(versionTwo.value, "MainModule.main");
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

    const baseAnchor = requireAstAnchor(base.value, "MainModule.main");
    const changedAnchor = requireAstAnchor(unrelatedChanged.value, "MainModule.main");
    expect(baseAnchor.fingerprint.value).toBe(changedAnchor.fingerprint.value);
  });

  test("does not churn fingerprints for CRLF inside string literals", () => {
    const lf = graphFromAstForTest(
      functionFingerprintAst('fn main() { let text = "alpha\nbeta"; }')
    );
    const crlf = graphFromAstForTest(
      functionFingerprintAst('fn main() { let text = "alpha\r\nbeta"; }')
    );

    expect(requireAstAnchor(lf, "MainModule.main").fingerprint.value).toBe(
      requireAstAnchor(crlf, "MainModule.main").fingerprint.value
    );
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

  test("warns and skips fingerprints when AST JSON lacks token data", () => {
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

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "warning", code: "missing_fingerprint_tokens" })
    );
    if (result.ok) {
      expect(result.value.semanticShape).toContain("resource MainModuleMainAstAnchor");
      expect(result.value.semanticShape).not.toContain("fingerprint ast.semantic_subtree_v1");
      expect(result.value.semanticShape).not.toContain("expects MainModuleMainAstAnchor");
    }
  });

  test("skips candidate effects whose anchors cannot be pinned", () => {
    const graph: CodeSemanticGraph = {
      files: [],
      rawNodes: [],
      containers: [
        {
          id: "owner",
          name: "AuditStore",
          kind: "type",
          path: "src/audit.ts",
          language: "typescript",
          confidence: "medium"
        }
      ],
      functions: [
        {
          id: "fn",
          name: "saveEvent",
          path: "src/audit.ts",
          language: "typescript",
          ownerId: "owner",
          anchorId: "anchor",
          confidence: "medium",
          sourceRef: "src/audit.ts:1-3"
        }
      ],
      resources: [
        {
          id: "resource",
          name: "AuditEvent",
          path: "src/audit.ts",
          language: "typescript",
          confidence: "medium",
          reason: "test resource",
          sourceRef: "src/audit.ts:1-1"
        }
      ],
      anchors: [
        {
          id: "anchor",
          name: "AuditStoreSaveEventAstAnchor",
          path: "src/audit.ts",
          language: "typescript",
          nodeId: "fn-node",
          kind: "method_definition",
          sourceRef: "src/audit.ts:1-3",
          target: "AuditStore.saveEvent",
          targetKind: "fn"
        }
      ],
      relations: [],
      candidateEffects: [
        {
          id: "candidate",
          name: "AuditStoreSaveEventAppendAuditEventCandidateEffect",
          functionId: "fn",
          effect: "Append",
          targetResourceId: "resource",
          sourceRef: "src/audit.ts:1-3",
          confidence: "low",
          anchorId: "anchor",
          summary: "saveEvent may append AuditEvent"
        }
      ],
      diagnostics: []
    };

    const output = requireGeneratedOutput(generateShapeFromCodeSemanticGraph(graph));
    expect(output.semanticShape).toContain("resource AuditStoreSaveEventAstAnchor");
    expect(output.semanticShape).not.toContain("effect candidate");
    expect(output.semanticShape).not.toContain("pin AuditStoreSaveEventAstAnchor");
  });

  test("handles deeply nested AST JSON nodes without recursive stack overflow", () => {
    const depth = 6000;
    const nodes = Array.from({ length: depth }, (_, index) => ({
      id: `node-${index}`,
      kind: "wrapper",
      children: [index + 1 === depth ? "main" : `node-${index + 1}`]
    }));
    const result = buildCodeSemanticGraphFromAstJson({
      language: "rust",
      files: [
        {
          path: "src/main.rs",
          root: "node-0",
          nodes: [
            ...nodes,
            {
              id: "main",
              kind: "function_item",
              attributes: { name: "main" },
              text: "fn main() {}"
            }
          ]
        }
      ]
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rawNodes).toHaveLength(depth + 1);
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

  test("handles deeply nested Tree-sitter nodes without recursive stack overflow", async () => {
    const source = "class Deep { run() {} }\n";
    let child = fakeTreeSitterNode({
      kind: "method_definition",
      startByte: 13,
      endByte: 21,
      startPosition: { row: 0, column: 13 },
      endPosition: { row: 0, column: 21 }
    });
    for (let index = 0; index < 6000; index += 1) {
      child = fakeTreeSitterNode({
        kind: "parenthesized_expression",
        startByte: 13,
        endByte: 21,
        startPosition: { row: 0, column: 13 },
        endPosition: { row: 0, column: 21 },
        children: [{ node: child }]
      });
    }
    const classNode = fakeTreeSitterNode({
      kind: "class_declaration",
      startByte: 0,
      endByte: 21,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 21 },
      children: [{ fieldName: "body", node: child }]
    });
    const root = fakeTreeSitterNode({
      kind: "program",
      startByte: 0,
      endByte: source.length,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 1, column: 0 },
      children: [{ node: classNode }]
    });

    const result = await parseSourceFilesToCodeSemanticGraph([{ path: "src/deep.ts", source }], {
      parserProvider: () => ({ rootNode: root })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(formatAstTestDiagnostics(result.diagnostics));
    }
    expect(result.value.rawNodes.length).toBeGreaterThan(6000);
    expect(requireAstAnchor(result.value, "Deep").fingerprint.value).toMatch(
      /^sha256:[0-9a-f]{64}$/
    );
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

type FingerprintedAstAnchor = CodeSemanticGraph["anchors"][number] & {
  fingerprint: NonNullable<CodeSemanticGraph["anchors"][number]["fingerprint"]>;
};

function astAnchorForTarget(
  graph: CodeSemanticGraph,
  target: string
): CodeSemanticGraph["anchors"][number] | undefined {
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

function requireAstAnchor(graph: CodeSemanticGraph, target: string): FingerprintedAstAnchor {
  const anchor = astAnchorForTarget(graph, target);
  expect(anchor).toBeDefined();
  if (!anchor) {
    throw new Error(`missing AST anchor for ${target}`);
  }
  expect(anchor.fingerprint).toBeDefined();
  if (!anchor.fingerprint) {
    throw new Error(`missing AST anchor fingerprint for ${target}`);
  }
  return anchor as FingerprintedAstAnchor;
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

function goReceiverCallAstJson(): unknown {
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
            children: ["repo", "store", "save", "run"]
          },
          {
            id: "repo",
            kind: "type_declaration",
            attributes: { name: "AuditRepo" },
            text: "type AuditRepo struct {\n}"
          },
          {
            id: "store",
            kind: "type_declaration",
            attributes: { name: "AuditStore" },
            text: "type AuditStore struct {\n  repo *AuditRepo\n}"
          },
          {
            id: "save",
            kind: "function_declaration",
            attributes: { name: "Save" },
            text: "func (r *AuditRepo) Save(event AuditEvent) {\n}"
          },
          {
            id: "run",
            kind: "function_declaration",
            attributes: { name: "Run" },
            text: "func (s *AuditStore) Run(event AuditEvent) {\n  s.repo.Save(event)\n}"
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
  walk: () => FakeTreeSitterCursor;
  hasError: () => boolean;
};

type FakeTreeSitterCursor = {
  gotoFirstChild: () => boolean;
  gotoNextSibling: () => boolean;
  node: () => FakeTreeSitterNode | undefined;
  fieldName: () => string | undefined;
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
    walk: () => {
      let index = -1;
      return {
        gotoFirstChild: () => {
          if (children.length === 0) {
            return false;
          }
          index = 0;
          return true;
        },
        gotoNextSibling: () => {
          if (index + 1 >= children.length) {
            return false;
          }
          index += 1;
          return true;
        },
        node: () => children[index]?.node,
        fieldName: () => children[index]?.fieldName
      };
    },
    hasError: () => input.hasError === true
  };
}
