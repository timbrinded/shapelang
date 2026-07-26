import { describe, expect, test } from "bun:test";
import { checkShapeModules } from "../index.ts";
import {
  checkSource,
  lockedIntended,
  parseModuleOrThrow,
  render,
  requireDiagnostic,
  requireNoDiagnostic
} from "./harness.ts";

const ANCHOR = "docs-site/src/content/docs/concepts/rules-hypercycles.md";

describe("#20 forbidden dependency paths", () => {
  test(
    lockedIntended(
      "a matching multi-kind path reports every directed hop and its relation provenance",
      ANCHOR
    ),
    () => {
      const result = checkSource(`
        module deps

        resource SecretStore
        component Gateway {}
        component PolicyService {}

        relation GatewayCallsPolicy {
          kind calls
          connects Gateway -> PolicyService
        }
        relation PolicyProvidesSecret {
          kind provides
          connects PolicyService -> SecretStore
        }

        rule no_gateway_to_secrets {
          forbid path Gateway -> SecretStore over calls or provides
        }
      `);
      const diagnostic = requireDiagnostic(result, "forbidden_path");

      expect(diagnostic.rule).toBe("deps::no_gateway_to_secrets");
      expect(diagnostic.source).toBe("deps::Gateway");
      expect(diagnostic.target).toBe("deps::SecretStore");
      expect(diagnostic.steps).toEqual([
        {
          from: "deps::Gateway",
          to: "deps::PolicyService",
          relation: "deps::GatewayCallsPolicy",
          kind: "calls"
        },
        {
          from: "deps::PolicyService",
          to: "deps::SecretStore",
          relation: "deps::PolicyProvidesSecret",
          kind: "provides"
        }
      ]);
      expect(diagnostic.causedBy).toEqual([
        "rule no_gateway_to_secrets forbids path Gateway -> SecretStore over calls or provides",
        "relation GatewayCallsPolicy",
        "relation PolicyProvidesSecret"
      ]);
      expect(render(result)).toContain("witness: Gateway -> PolicyService -> SecretStore");
    }
  );

  test(lockedIntended("direction and kind filters exclude non-matching paths", ANCHOR), () => {
    const source = (rule: string): string => `
        module deps

        component Gateway {}
        component PolicyService {}
        resource SecretStore

        relation GatewayCallsPolicy {
          kind calls
          connects Gateway -> PolicyService
        }
        relation PolicyProvidesSecret {
          kind provides
          connects PolicyService -> SecretStore
        }

        rule path_rule {
          ${rule}
        }
      `;

    requireNoDiagnostic(
      checkSource(source("forbid path SecretStore -> Gateway over calls or provides")),
      "forbidden_path"
    );
    requireNoDiagnostic(
      checkSource(source("forbid path Gateway -> SecretStore over calls")),
      "forbidden_path"
    );
    requireNoDiagnostic(
      checkSource(`
          module deps
          component Gateway {}
          component Isolated {}
          resource SecretStore
          relation GatewayProvidesSecret {
            kind provides
            connects Gateway -> SecretStore
          }
          rule no_isolated_route {
            forbid path Isolated -> SecretStore over provides
          }
        `),
      "forbidden_path"
    );
    requireDiagnostic(
      checkSource(source("forbid path Gateway -> SecretStore over calls or provides")),
      "forbidden_path"
    );
  });

  test(
    lockedIntended(
      "canonical BFS chooses the fewest-hop witness and ignores relation order for ties",
      ANCHOR
    ),
    () => {
      const relations = [
        `relation StartCallsBeta {
          kind calls
          connects Start -> Beta
        }`,
        `relation BetaCallsTarget {
          kind calls
          connects Beta -> Target
        }`,
        `relation StartCallsAlpha {
          kind calls
          connects Start -> Alpha
        }`,
        `relation AlphaCallsTarget {
          kind calls
          connects Alpha -> Target
        }`
      ];
      const source = (blocks: string[]): string => `
        module deps
        component Alpha {}
        component Beta {}
        component Start {}
        component Target {}
        ${blocks.join("\n")}
        rule no_route {
          forbid path Start -> Target over calls
        }
      `;

      const declared = requireDiagnostic(checkSource(source(relations)), "forbidden_path");
      const reversed = requireDiagnostic(
        checkSource(source([...relations].reverse())),
        "forbidden_path"
      );

      expect(declared.steps.map((step) => step.relation)).toEqual([
        "deps::StartCallsAlpha",
        "deps::AlphaCallsTarget"
      ]);
      expect(reversed.steps).toEqual(declared.steps);

      const direct = requireDiagnostic(
        checkSource(
          source([
            ...relations,
            `relation ZDirectRoute {
              kind calls
              connects Start -> Target
            }`
          ])
        ),
        "forbidden_path"
      );
      expect(direct.steps.map((step) => step.relation)).toEqual(["deps::ZDirectRoute"]);
    }
  );

  test(
    lockedIntended(
      "equal-length witnesses use vertex, relation-kind, and relation-name tie breakers",
      ANCHOR
    ),
    () => {
      const result = checkSource(`
        module deps
        component Alpha {}
        component Beta {}
        component Start {}
        component Target {}

        relation StartCallsBeta {
          kind calls
          connects Start -> Beta
        }
        relation BetaCallsTarget {
          kind calls
          connects Beta -> Target
        }
        relation ZStartCallsAlpha {
          kind calls
          connects Start -> Alpha
        }
        relation AStartCallsAlpha {
          kind calls
          connects Start -> Alpha
        }
        relation AlphaCallsTarget {
          kind calls
          connects Alpha -> Target
        }

        rule no_route {
          forbid path Start -> Target over calls
        }
      `);
      const diagnostic = requireDiagnostic(result, "forbidden_path");

      expect(diagnostic.steps.map((step) => step.relation)).toEqual([
        "deps::AStartCallsAlpha",
        "deps::AlphaCallsTarget"
      ]);

      const parallel = requireDiagnostic(
        checkSource(`
          module deps
          component Start {}
          component Target {}
          relation ZCalls {
            kind calls
            connects Start -> Target
          }
          relation ACallbacks {
            kind callbacks
            connects Start -> Target
          }
          rule no_route {
            forbid path Start -> Target over calls or callbacks
          }
        `),
        "forbidden_path"
      );
      expect(parallel.steps[0]).toEqual({
        from: "deps::Start",
        to: "deps::Target",
        relation: "deps::ACallbacks",
        kind: "callbacks"
      });
    }
  );

  test(
    lockedIntended(
      "an ordered relation contributes one provenance entry but retains every consecutive hop",
      ANCHOR
    ),
    () => {
      const diagnostic = requireDiagnostic(
        checkSource(`
          module deps
          component Gateway {}
          component PolicyService {}
          resource SecretStore
          relation SecretReadPath {
            kind coordinated_call
            connects Gateway -> PolicyService -> SecretStore
          }
          rule no_secret_route {
            forbid path Gateway -> SecretStore over coordinated_call
          }
        `),
        "forbidden_path"
      );

      expect(diagnostic.steps).toHaveLength(2);
      expect(diagnostic.steps.map((step) => step.relation)).toEqual([
        "deps::SecretReadPath",
        "deps::SecretReadPath"
      ]);
      expect(
        diagnostic.causedBy.filter((cause) => cause === "relation SecretReadPath")
      ).toHaveLength(1);
    }
  );

  test(lockedIntended("cycles do not prevent BFS from reaching a valid target", ANCHOR), () => {
    const diagnostic = requireDiagnostic(
      checkSource(`
          module deps
          component Gateway {}
          component PolicyService {}
          resource SecretStore
          relation GatewayCallsPolicy {
            kind calls
            connects Gateway -> PolicyService
          }
          relation PolicyCallsGateway {
            kind calls
            connects PolicyService -> Gateway
          }
          relation PolicyProvidesSecret {
            kind provides
            connects PolicyService -> SecretStore
          }
          rule no_secret_route {
            forbid path Gateway -> SecretStore over calls or provides
          }
        `),
      "forbidden_path"
    );

    expect(diagnostic.steps.map((step) => step.relation)).toEqual([
      "deps::GatewayCallsPolicy",
      "deps::PolicyProvidesSecret"
    ]);
  });

  test(
    lockedIntended("invalid rules and graph entries fail without path witnesses", ANCHOR),
    () => {
      const sameEndpoint = checkSource(`
        module deps
        component Gateway {}
        rule no_loop {
          forbid path Gateway -> Gateway over calls
        }
      `);
      expect(requireDiagnostic(sameEndpoint, "invalid_rule").reason).toContain(
        "endpoints must be distinct"
      );
      requireNoDiagnostic(sameEndpoint, "forbidden_path");

      const customKind = checkSource(`
        module deps
        component Gateway {}
        component PolicyService {}
        relation GatewayCustomPolicy {
          kind custom_flow
          connects Gateway -> PolicyService
        }
        rule no_custom_route {
          forbid path Gateway -> PolicyService over custom_flow
        }
      `);
      expect(requireDiagnostic(customKind, "invalid_rule").reason).toContain(
        "custom_flow has no directed traversal semantics"
      );
      requireNoDiagnostic(customKind, "forbidden_path");

      const unknownEndpoint = checkSource(`
        module deps
        component PolicyService {}
        rule no_ghost_route {
          forbid path Ghost -> PolicyService over calls
        }
      `);
      expect(requireDiagnostic(unknownEndpoint, "unknown_name").name).toBe("deps::Ghost");
      requireNoDiagnostic(unknownEndpoint, "forbidden_path");

      const ambiguousEndpoint = checkSource(`
        module deps
        resource Shared
        component Shared {}
        component Target {}
        rule no_ambiguous_route {
          forbid path Shared -> Target over calls
        }
      `);
      expect(requireDiagnostic(ambiguousEndpoint, "invalid_rule").reason).toContain(
        "resolves to both a component and a resource"
      );
      requireNoDiagnostic(ambiguousEndpoint, "forbidden_path");

      const unknownIntermediate = checkSource(`
        module deps
        component Start {}
        component Target {}
        relation StartCallsGhost {
          kind calls
          connects Start -> Ghost
        }
        relation GhostCallsTarget {
          kind calls
          connects Ghost -> Target
        }
        rule no_invalid_route {
          forbid path Start -> Target over calls
        }
      `);
      expect(requireDiagnostic(unknownIntermediate, "unknown_name").name).toBe("deps::Ghost");
      requireNoDiagnostic(unknownIntermediate, "forbidden_path");

      const invalidProvidesRoles = checkSource(`
        module deps
        resource Start
        component Target {}
        relation InvalidProvides {
          kind provides
          connects Start -> Target
        }
        rule no_invalid_route {
          forbid path Start -> Target over provides
        }
      `);
      expect(requireDiagnostic(invalidProvidesRoles, "invalid_relation").reason).toContain(
        "provider Start must be a component"
      );
      requireNoDiagnostic(invalidProvidesRoles, "forbidden_path");
    }
  );

  test(lockedIntended("module-qualified endpoints resolve across imported modules", ANCHOR), () => {
    const gateway = parseModuleOrThrow(`
        module gateway
        component Gateway {}
      `);
    const secrets = parseModuleOrThrow(`
        module secrets
        resource SecretStore
      `);
    const ruleset = parseModuleOrThrow(`
        module ruleset
        import gateway
        import secrets
        relation GatewayProvidesSecret {
          kind provides
          connects gateway::Gateway -> secrets::SecretStore
        }
        rule no_cross_module_secret_route {
          forbid path gateway::Gateway -> secrets::SecretStore over provides
        }
      `);

    const diagnostic = requireDiagnostic(
      checkShapeModules([gateway, secrets, ruleset]),
      "forbidden_path"
    );
    expect(diagnostic.steps[0]).toEqual({
      from: "gateway::Gateway",
      to: "secrets::SecretStore",
      relation: "ruleset::GatewayProvidesSecret",
      kind: "provides"
    });

    const left = parseModuleOrThrow(`
        module left
        component Shared {}
      `);
    const right = parseModuleOrThrow(`
        module right
        component Shared {}
      `);
    const ambiguousRule = parseModuleOrThrow(`
        module consumer
        import left
        import right
        rule no_ambiguous_route {
          forbid path Shared -> Shared over calls
        }
      `);
    const ambiguousResult = checkShapeModules([left, right, ambiguousRule]);
    const ambiguousDiagnostics = ambiguousResult.diagnostics.filter(
      (diagnostic) => diagnostic.kind === "ambiguous_name"
    );
    expect(ambiguousDiagnostics).toHaveLength(1);
    expect(ambiguousDiagnostics[0]?.name).toBe("Shared");
    requireNoDiagnostic(ambiguousResult, "forbidden_path");
  });

  test(
    lockedIntended(
      "diagnostics qualify only colliding path vertices and relation names",
      "docs-site/src/content/docs/reference/diagnostics.md"
    ),
    () => {
      const left = parseModuleOrThrow(`
        module left
        component Mid {}
        component Shared {}
        relation Route {
          kind calls
          connects Shared -> Mid
        }
      `);
      const right = parseModuleOrThrow(`
        module right
        import left
        component Shared {}
        relation Route {
          kind calls
          connects left::Mid -> Shared
        }
      `);
      const ruleset = parseModuleOrThrow(`
        module ruleset
        import left
        import right
        rule no_shared_route {
          forbid path left::Shared -> right::Shared over calls
        }
      `);

      const output = render(checkShapeModules([left, right, ruleset]));
      expect(output).toContain("calls left::Route: left::Shared -> Mid");
      expect(output).toContain("calls right::Route: Mid -> right::Shared");
      expect(output).toContain("witness: left::Shared -> Mid -> right::Shared");
      expect(output).not.toContain("left::Mid");
    }
  );
});
