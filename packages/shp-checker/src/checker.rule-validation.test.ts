import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  checkShapeFiles,
  checkShapeModules,
  formatDiagnostics,
  parseShapeModule
} from "./index.ts";
import { checkShapeSource } from "./test-support.ts";

const repoRoot = resolve(import.meta.dir, "../../..");

const invalidGenericFixtures = [
  {
    label: "an unbound condition-trait parameter",
    path: "fixtures/fail/rule_unbound_condition_trait/rules.shape",
    rule: "unbound_condition_trait",
    trait: "Unbound",
    reasonFragments: ["Resource", "unbound"]
  },
  {
    label: "a Fn-bound condition trait",
    path: "fixtures/fail/rule_function_condition_trait/rules.shape",
    rule: "function_condition_trait",
    trait: "FunctionScoped",
    reasonFragments: ["Resource", "Fn"]
  },
  {
    label: "a Function-bound condition trait",
    path: "fixtures/fail/rule_function_alias_condition_trait/rules.shape",
    rule: "function_alias_condition_trait",
    trait: "FunctionScoped",
    reasonFragments: ["Resource", "Function"]
  },
  {
    label: "a Component-bound condition trait",
    path: "fixtures/fail/rule_component_condition_trait/rules.shape",
    rule: "component_condition_trait",
    trait: "ComponentScoped",
    reasonFragments: ["Resource", "Component"]
  },
  {
    label: "an unsupported condition-trait bound",
    path: "fixtures/fail/rule_unsupported_condition_trait/rules.shape",
    rule: "unsupported_condition_trait",
    trait: "ServiceScoped",
    reasonFragments: ["Resource", "Service"]
  },
  {
    label: "a multi-parameter condition trait",
    path: "fixtures/fail/rule_multi_parameter_condition_trait/rules.shape",
    rule: "multi_parameter_condition_trait",
    trait: "PairScoped",
    reasonFragments: ["exactly one", "2"]
  }
] as const;

describe("Shape rule condition validation", () => {
  test("accepts the Resource-bound rule-condition fixture", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/pass/rule_resource_condition/rules.shape")
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("accepts a Resource-bound condition trait declared after its rule", () => {
    const result = checkShapeSource(`
      module rules

      rule protected_events_are_not_deleted {
        when T has Protected
        forbid final HardDelete<T>
      }

      trait Protected<T: Resource> {
      }
    `);

    expect(result.diagnostics).toEqual([]);
  });

  test("accepts a zero-parameter marker trait as a resource condition", () => {
    const result = checkShapeSource(`
      module rules

      trait Immutable {
      }

      resource AuditEvent : Immutable

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>
        fn purgeEvent
          effects complete {
            HardDelete<AuditEvent>
          }
      }

      rule immutable_events_are_not_deleted {
        when T has Immutable
        forbid final HardDelete<T>
      }
    `);

    expect(result.diagnostics.some((diagnostic) => diagnostic.kind === "invalid_rule")).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "final_forbidden_effect",
        effect: "HardDelete",
        target: "rules::AuditEvent"
      })
    );
  });

  test("rejects an unknown trait in a rule condition at the when clause", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/rule_unknown_condition_trait/rules.shape")
    ]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        kind: "unknown_name",
        nameKind: "trait",
        name: "rules::MissingTrait"
      })
    );
    expect(output).toContain("rule unknown_condition_trait when T has MissingTrait");
  });

  test("rejects a qualified unknown trait in a rule condition", () => {
    const result = checkShapeSource(`
      module rules

      rule qualified_unknown_condition_trait {
        when T has domain::MissingTrait
        forbid final HardDelete<T>
      }
    `);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        kind: "unknown_name",
        nameKind: "trait",
        name: "domain::MissingTrait"
      })
    );
    expect(formatDiagnostics(result)).toContain(
      "rule qualified_unknown_condition_trait when T has MissingTrait"
    );
  });

  test("rejects an unbound final-forbid subject without applying the rule", async () => {
    const result = await checkShapeFiles([
      resolve(repoRoot, "fixtures/fail/rule_unknown_subject/rules.shape")
    ]);
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        kind: "unknown_name",
        nameKind: "resource",
        name: "rules::U"
      })
    );
    expect(output).toContain("rule unknown_rule_subject forbids final HardDelete<U>");
    expect(output).not.toContain("error: forbidden effect");
  });

  test("reports an ambiguous condition trait without cascading diagnostics", () => {
    const left = parseShapeModule("module left\ntrait Protected {}");
    const right = parseShapeModule("module right\ntrait Protected {}");
    const policy = parseShapeModule(`
      module rules
      import right
      import left

      rule ambiguous_condition_trait {
        when T has Protected
        forbid final HardDelete<T>
      }
    `);

    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    expect(policy.ok).toBe(true);
    if (!left.ok || !right.ok || !policy.ok) {
      return;
    }

    const first = checkShapeModules([left.module, right.module, policy.module]);
    const second = checkShapeModules([right.module, left.module, policy.module]);

    expect(first.diagnostics).toHaveLength(1);
    expect(first.diagnostics[0]).toEqual(
      expect.objectContaining({
        kind: "ambiguous_name",
        nameKind: "trait",
        matches: ["left::Protected", "right::Protected"]
      })
    );
    expect(formatDiagnostics(first)).toBe(formatDiagnostics(second));
  });

  for (const scenario of invalidGenericFixtures) {
    test(`rejects ${scenario.label} without applying its final forbid`, async () => {
      const result = await checkShapeFiles([resolve(repoRoot, scenario.path)]);
      const invalidRules = result.diagnostics.filter(
        (diagnostic) => diagnostic.kind === "invalid_rule"
      );

      expect(result.exitCode).toBe(1);
      expect(result.diagnostics).toHaveLength(1);
      expect(invalidRules).toHaveLength(1);
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.kind === "final_forbidden_effect")
      ).toBe(false);

      const diagnostic = invalidRules[0];
      if (diagnostic?.kind !== "invalid_rule") {
        return;
      }
      expect(diagnostic.rule).toBe(`rules::${scenario.rule}`);
      for (const fragment of scenario.reasonFragments) {
        expect(diagnostic.reason).toContain(fragment);
      }
      expect(diagnostic.causedBy.join("\n")).toContain(
        `rule ${scenario.rule} when T has ${scenario.trait}`
      );
      expect(diagnostic.causedBy.join("\n")).toContain(`trait ${scenario.trait}`);
    });
  }

  test("keeps the prelude AppendOnly parameter resource-compatible in rules", () => {
    const result = checkShapeSource(`
      module rules

      resource AuditEvent : AppendOnly

      component AuditStore {
        owns AuditEvent
        grants Redact<AuditEvent>
        fn redactEvent
          effects complete {
            Redact<AuditEvent>
          }
      }

      rule append_only_is_not_redacted {
        when T has AppendOnly
        forbid final Redact<T>
      }
    `);

    expect(result.diagnostics.some((diagnostic) => diagnostic.kind === "invalid_rule")).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "final_forbidden_effect",
        effect: "Redact",
        target: "rules::AuditEvent"
      })
    );
  });

  test("treats unseeded built-in resource traits as resource-compatible in rules", () => {
    const result = checkShapeSource(`
      module rules

      resource AuditEvent : PII

      component AuditStore {
        owns AuditEvent
        grants HardDelete<AuditEvent>
        fn purgeEvent
          effects complete {
            HardDelete<AuditEvent>
          }
      }

      rule personal_data_is_not_deleted {
        when T has PII
        forbid final HardDelete<T>
      }
    `);

    expect(result.diagnostics.some((diagnostic) => diagnostic.kind === "invalid_rule")).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "final_forbidden_effect",
        effect: "HardDelete",
        target: "rules::AuditEvent"
      })
    );
  });

  test("keeps concrete rule targets distinct from the generic subject", () => {
    const result = checkShapeSource(`
      module rules

      trait Protected<T: Resource> {
      }

      resource AuditEvent : Protected
      resource OtherEvent : Protected

      component AuditStore {
        owns AuditEvent
        owns OtherEvent
        grants HardDelete<AuditEvent>
        grants HardDelete<OtherEvent>
        fn purgeAudit
          effects complete {
            HardDelete<AuditEvent>
          }
        fn purgeOther
          effects complete {
            HardDelete<OtherEvent>
          }
      }

      rule protected_audit_is_not_deleted {
        when T has Protected
        forbid final HardDelete<AuditEvent>
      }
    `);
    const forbidden = result.diagnostics.filter(
      (diagnostic) => diagnostic.kind === "final_forbidden_effect"
    );

    expect(forbidden).toHaveLength(1);
    expect(forbidden[0]).toEqual(
      expect.objectContaining({
        functionName: "purgeAudit",
        target: "rules::AuditEvent"
      })
    );
  });

  test("orders invalid final-forbid subjects deterministically", () => {
    const first = checkShapeSource(`
      module rules

      trait Immutable {
      }

      trait Archived {
      }

      rule invalid_multi_subject_final_forbid {
        when U has Archived
        when T has Immutable
        forbid final HardDelete<T>
      }
    `);
    const second = checkShapeSource(`
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

    expect(formatDiagnostics(first)).toBe(formatDiagnostics(second));
    expect(formatDiagnostics(first)).toContain("found T, U");
  });
});
