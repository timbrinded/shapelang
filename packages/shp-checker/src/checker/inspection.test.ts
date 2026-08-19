import { describe, expect, test } from "bun:test";
import { parseShapeModule } from "../parser.ts";
import { inspectShapeModules } from "./inspection.ts";
import type { CheckModuleInput } from "./model.ts";

describe("Shape model inspection", () => {
  test("exports a deterministic qualified effective-model DTO", () => {
    const resources = parseModule(
      `module atlas.resources

resource AuditEvent
`,
      "shape/resources.shape"
    );
    const service = parseModule(
      `module atlas.service

import atlas.resources

component AuditStore {
  owns AuditEvent
}

component Gateway {
  grants Read<AuditEvent>
  fn readAudit
    source ts("src/gateway.ts#readAudit")
    effects complete {
      Read<AuditEvent>
        evidence test("tests/gateway.test.ts#readAudit")
    }
}

relation GatewayCallsAudit {
  kind calls
  connects Gateway -> AuditStore
  summary "ReadPath"
}

implementation GatewaySource {
  paths { "src/gateway.ts" }
  conforms_to Gateway
  on_change require shape_update
}

binding GatewayDocs {
  when_changed paths { "src/gateway.ts" }
  require_changed paths { "docs/gateway.md" }
  allow attest docs_not_needed
}

rule no_call_cycles {
  forbid hypercycle over calls
}

memory GatewayReadConstraint : RefactorConstraint<fn Gateway.readAudit> {
  applies_to fn Gateway.readAudit
  status Explained
  confidence High
  summary "The read path stays visible."
  guards { on_change require ReEvaluation<Self> }
  who { owner GatewayTeam }
  evidence test("tests/gateway.test.ts#readAudit")
}
`,
      "shape/nested/service.shape"
    );

    const inspection = inspectShapeModules([service, resources], { shapeVersion: "0.7.0" });
    const reordered = inspectShapeModules([resources, service], { shapeVersion: "0.7.0" });

    expect(JSON.stringify(inspection)).toBe(JSON.stringify(reordered));
    expect(inspection).toMatchObject({
      schemaVersion: 1,
      shapeVersion: "0.7.0",
      documents: [
        { file: "shape/nested/service.shape", module: "atlas.service" },
        { file: "shape/resources.shape", module: "atlas.resources" }
      ],
      stats: {
        documents: 2,
        modules: 2,
        resources: 1,
        components: 2,
        functions: 1,
        effects: 1,
        relations: 1,
        implementations: 1,
        bindings: 1,
        rules: 1,
        memories: 1
      }
    });
    expect(inspection.components.find(({ name }) => name === "Gateway")).toMatchObject({
      id: "atlas.service::Gateway",
      module: "atlas.service",
      file: "shape/nested/service.shape",
      functions: ["atlas.service::Gateway.readAudit"]
    });
    expect(inspection.functions).toEqual([
      {
        id: "atlas.service::Gateway.readAudit",
        name: "readAudit",
        module: "atlas.service",
        file: "shape/nested/service.shape",
        origin: "authored",
        component: "atlas.service::Gateway",
        source: { language: "ts", path: "src/gateway.ts#readAudit" },
        unsafe: false,
        effectsComplete: true,
        effects: [
          {
            name: "Read",
            target: "atlas.resources::AuditEvent",
            evidence: { language: "test", path: "tests/gateway.test.ts#readAudit" }
          }
        ],
        requires: [],
        shapeTraits: []
      }
    ]);
    expect(inspection.relations[0]).toMatchObject({
      id: "atlas.service::GatewayCallsAudit",
      kind: "calls",
      from: "atlas.service::Gateway",
      to: "atlas.service::AuditStore"
    });
    expect(inspection.implementations[0]).toMatchObject({
      id: "atlas.service::GatewaySource",
      conformsTo: "atlas.service::Gateway",
      paths: ["src/gateway.ts"]
    });
    expect(inspection.bindings[0]).toMatchObject({
      id: "atlas.service::GatewayDocs",
      whenChanged: ["src/gateway.ts"],
      requireChanged: ["docs/gateway.md"],
      allowAttestations: ["docs_not_needed"]
    });
    expect(inspection.rules[0]).toMatchObject({
      id: "atlas.service::no_call_cycles",
      forbidHypercycles: [{ kinds: ["calls"] }]
    });
    expect(inspection.memories[0]).toMatchObject({
      id: "atlas.service::GatewayReadConstraint",
      target: { kind: "fn", id: "atlas.service::Gateway.readAudit" },
      owner: "GatewayTeam"
    });
    expect(JSON.stringify(inspection)).not.toContain("generatedAt");
  });

  test("preserves authored and generated AST origin", () => {
    const authored = parseModule(
      `module atlas.authored

resource AuditEvent
`,
      "shape/authored.shape"
    );
    const generated = parseModule(
      `module shape.generated.ast.demo

resource SyntaxAnchor
`,
      "shape/generated/ast/demo.shape"
    );

    const inspection = inspectShapeModules([generated, authored], { shapeVersion: "0.7.0" });

    expect(inspection.documents).toEqual([
      {
        file: "shape/authored.shape",
        module: "atlas.authored",
        imports: [],
        origin: "authored"
      },
      {
        file: "shape/generated/ast/demo.shape",
        module: "shape.generated.ast.demo",
        imports: [],
        origin: "generated_ast"
      }
    ]);
    expect(inspection.resources.map(({ id, origin }) => ({ id, origin }))).toEqual([
      { id: "atlas.authored::AuditEvent", origin: "authored" },
      { id: "shape.generated.ast.demo::SyntaxAnchor", origin: "generated_ast" }
    ]);
  });

  test("derives declaration origin from file provenance in a multi-file module", () => {
    const authored = parseModule(
      `module shape.generated.ast.shared

resource AuthoredContract
`,
      "shape/shared-contract.shape"
    );
    const generated = parseModule(
      `module shape.generated.ast.shared

resource GeneratedSyntaxAnchor
`,
      "shape/generated/ast/shared.shape"
    );

    const inspection = inspectShapeModules([authored, generated], { shapeVersion: "0.7.0" });
    const reordered = inspectShapeModules([generated, authored], { shapeVersion: "0.7.0" });

    expect(JSON.stringify(inspection)).toBe(JSON.stringify(reordered));
    expect(inspection.stats).toMatchObject({ documents: 2, modules: 1, resources: 2 });
    expect(inspection.resources.map(({ name, file, origin }) => ({ name, file, origin }))).toEqual([
      {
        name: "AuthoredContract",
        file: "shape/shared-contract.shape",
        origin: "authored"
      },
      {
        name: "GeneratedSyntaxAnchor",
        file: "shape/generated/ast/shared.shape",
        origin: "generated_ast"
      }
    ]);
  });
});

function parseModule(source: string, filePath: string): CheckModuleInput {
  const parsed = parseShapeModule(source, filePath);
  if (!parsed.ok) {
    throw new Error(parsed.diagnostics.map(({ message }) => message).join("\n"));
  }
  return { module: parsed.module, filePath };
}
