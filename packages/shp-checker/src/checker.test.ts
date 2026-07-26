import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  checkShapeFiles,
  checkShapeModules,
  formatShapeSource,
  explainShapeModules,
  formatDiagnostics,
  graphAllShapeModules,
  graphShapeModules,
  parseShapeModule,
  statsShapeHypergraph
} from "./index.ts";
import { checkShapeSource, contextRef, fnTarget } from "./test-support.ts";

const repoRoot = resolve(import.meta.dir, "../../..");

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
          source ts("src/audit/store.ts#AuditStore.appendEvent")
          effects unknown
      }

      effect candidate AppendEventCandidate {
        fn AuditStore.appendEvent
        effect Append<AuditEvent>
        source ts("src/audit/store.ts#AuditStore.appendEvent")
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
    expect(output).toContain('evidence: ts("src/audit/purge.ts#purgeOldEvents")');
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
              evidence ts("src/audit/purge.ts#purgeOldEvents")
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
              evidence ts("src/audit/store.ts#appendEvent")
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
              evidence ts("src/audit/store.ts#appendEvent")
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
              evidence ts("src/audit/store.ts#appendEvent")
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

  test("rejects forbidden_path fixture with a per-hop witness", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/forbidden_path/deps.shape")
    ]);
    const output = formatDiagnostics(result);
    expect(result.exitCode).toBe(1);
    expect(output).toContain("error: forbidden path");
    expect(output).toContain("calls GatewayCallsPolicy: Gateway -> PolicyService");
    expect(output).toContain("provides PolicyProvidesSecret: PolicyService -> SecretStore");
    expect(output).toContain("witness: Gateway -> PolicyService -> SecretStore");
  });

  test("passes forbidden_path_absent fixture", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/forbidden_path_absent/deps.shape")
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
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
        who { owner GatewayTeam }
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
        who { owner GatewayTeam }
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
        guards { on_change require ${contextRef("ReEvaluation", "Self")} }
        summary "Previous refactors broke error normalisation."
        who { owner GatewayTeam }
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
