import type {
  RelationDecl,
  RelationEndpoint,
  RelationRoleEntry
} from "../../language/generated/ast.ts";
import {
  isRelationConnectsDecl,
  isRelationFingerprintExpectationDecl,
  isRelationKindDecl,
  isRelationRolesDecl,
  isRelationSummaryDecl
} from "../../language/generated/ast.ts";
import type {
  FingerprintExpectationInfo,
  HyperedgeInfo,
  HyperedgeMember,
  LoweringContext,
  Model,
  Provenance
} from "../model.ts";
import { PRELUDE_RELATION_KINDS } from "../../prelude.ts";
import { declKey, displaySymbol } from "../display.ts";
import { describeProvenance, provenance } from "../provenance.ts";
import { resolveVertexName } from "../symbols.ts";
import { unquoteShapeString } from "../../shape-strings.ts";

export function lowerRelation(
  relation: RelationDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, relation.name);
  const prov = provenance(context.filePath, `relation ${name}`);
  if (model.hypergraph.edges.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "relation",
      name,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(model.hypergraph.edges.get(name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info = buildRelationInfo(relation, name, prov, context, model);
  if (!info) {
    return;
  }
  const members = info.members;

  model.hypergraph.edges.set(name, info);
  for (const member of members) {
    const incident = model.hypergraph.incidence.get(member.endpoint) ?? [];
    incident.push(name);
    model.hypergraph.incidence.set(member.endpoint, incident);
  }

  model.facts.push({
    kind: "hyperedge",
    name,
    relationKind: info.kind,
    ordered: info.ordered,
    provenance: prov
  });
  for (const member of members) {
    model.facts.push({
      kind: "hyperedge_member",
      hyperedge: name,
      endpoint: member.endpoint,
      index: member.index,
      role: member.role,
      provenance: provenance(context.filePath, `relation ${name} connects ${member.endpoint}`)
    });
  }
  for (const expectation of info.fingerprintExpectations) {
    model.facts.push({
      kind: "hyperedge_fingerprint_expectation",
      hyperedge: name,
      endpoint: expectation.endpoint,
      provider: expectation.provider,
      value: expectation.value,
      provenance: expectation.provenance
    });
  }
}

function buildRelationInfo(
  relation: RelationDecl,
  name: string,
  prov: Provenance,
  context: LoweringContext,
  model: Model
): HyperedgeInfo | undefined {
  let kindValue: string | undefined;
  let kindSeen = false;
  let connectsDecl: ReturnType<typeof collectConnects> | undefined;
  let summary: string | undefined;
  let summarySeen = false;
  let rolesSeen = false;
  const roleDecls: RelationRoleEntry[] = [];
  const fingerprintExpectations: FingerprintExpectationInfo[] = [];

  for (const member of relation.members) {
    if (isRelationKindDecl(member)) {
      if (kindSeen) {
        model.diagnostics.push({
          kind: "invalid_relation",
          name,
          reason: "duplicate kind",
          filePath: context.filePath,
          causedBy: [describeProvenance(prov)]
        });
        continue;
      }
      kindSeen = true;
      kindValue = member.value;
    } else if (isRelationConnectsDecl(member)) {
      if (connectsDecl) {
        model.diagnostics.push({
          kind: "invalid_relation",
          name,
          reason: "duplicate connects",
          filePath: context.filePath,
          causedBy: [describeProvenance(prov)]
        });
        continue;
      }
      connectsDecl = collectConnects(member, context, model);
    } else if (isRelationRolesDecl(member)) {
      if (rolesSeen) {
        model.diagnostics.push({
          kind: "invalid_relation",
          name,
          reason: "duplicate roles",
          filePath: context.filePath,
          causedBy: [describeProvenance(prov)]
        });
        continue;
      }
      rolesSeen = true;
      for (const role of member.roles) {
        roleDecls.push(role);
      }
    } else if (isRelationFingerprintExpectationDecl(member)) {
      const endpoint = resolveVertexName(member.endpoint.name, context, model);
      fingerprintExpectations.push({
        endpoint,
        provider: member.provider,
        value: unquoteShapeString(member.value),
        provenance: provenance(
          context.filePath,
          `relation ${name} expects ${endpoint} fingerprint ${member.provider}`
        )
      });
    } else if (isRelationSummaryDecl(member)) {
      if (summarySeen) {
        model.diagnostics.push({
          kind: "invalid_relation",
          name,
          reason: "duplicate summary",
          filePath: context.filePath,
          causedBy: [describeProvenance(prov)]
        });
        continue;
      }
      summarySeen = true;
      summary = unquoteShapeString(member.value);
    }
  }

  if (!kindValue) {
    model.diagnostics.push({
      kind: "invalid_relation",
      name,
      reason: "missing kind",
      filePath: context.filePath,
      causedBy: [describeProvenance(prov)]
    });
    return;
  }

  if (!connectsDecl) {
    model.diagnostics.push({
      kind: "invalid_relation",
      name,
      reason: "missing connects",
      filePath: context.filePath,
      causedBy: [describeProvenance(prov)]
    });
    return;
  }

  if (connectsDecl.endpoints.length < 2) {
    model.diagnostics.push({
      kind: "invalid_relation",
      name,
      reason: "connects requires at least two endpoints",
      filePath: context.filePath,
      causedBy: [describeProvenance(prov)]
    });
    return;
  }

  const seen = new Set<string>();
  for (const endpoint of connectsDecl.endpoints) {
    if (seen.has(endpoint)) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `duplicate endpoint ${displaySymbol(endpoint)}`,
        filePath: context.filePath,
        causedBy: [describeProvenance(prov)]
      });
      return;
    }
    seen.add(endpoint);
  }

  const rule = PRELUDE_RELATION_KINDS.get(kindValue);
  if (rule) {
    if (rule.arity === "binary" && connectsDecl.endpoints.length !== 2) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `kind ${kindValue} requires exactly two endpoints`,
        filePath: context.filePath,
        causedBy: [describeProvenance(prov)]
      });
      return;
    }
    if (rule.arity === "ordered" && !connectsDecl.ordered) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `kind ${kindValue} requires ordered connects (A -> B -> ...)`,
        filePath: context.filePath,
        causedBy: [describeProvenance(prov)]
      });
      return;
    }
    if (rule.cycleTraversal === "directed_pairs" && !connectsDecl.ordered) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `kind ${kindValue} requires ordered connects (A -> B)`,
        filePath: context.filePath,
        causedBy: [describeProvenance(prov)]
      });
      return;
    }
  }

  const endpointSet = new Set(connectsDecl.endpoints);
  const roleByEndpoint = new Map<string, string>();
  for (const role of roleDecls) {
    const roleName = resolveVertexName(role.name, context, model);
    if (!endpointSet.has(roleName)) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `role ${displaySymbol(roleName)} is not a connects endpoint`,
        filePath: context.filePath,
        causedBy: [describeProvenance(prov)]
      });
      continue;
    }
    if (roleByEndpoint.has(roleName)) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `duplicate role for ${displaySymbol(roleName)}`,
        filePath: context.filePath,
        causedBy: [describeProvenance(prov)]
      });
      continue;
    }
    roleByEndpoint.set(roleName, role.role);
  }

  for (const expectation of fingerprintExpectations) {
    if (!endpointSet.has(expectation.endpoint)) {
      model.diagnostics.push({
        kind: "invalid_relation",
        name,
        reason: `fingerprint expectation ${displaySymbol(expectation.endpoint)} is not a connects endpoint`,
        filePath: context.filePath,
        causedBy: [describeProvenance(expectation.provenance)]
      });
    }
  }

  const members: HyperedgeMember[] = connectsDecl.endpoints.map((endpoint, index) => ({
    endpoint,
    index,
    role: roleByEndpoint.get(endpoint)
  }));

  const info: HyperedgeInfo = {
    name,
    kind: kindValue,
    ordered: connectsDecl.ordered,
    members,
    fingerprintExpectations,
    summary,
    provenance: prov
  };
  return info;
}

export function removeRelation(name: string, model: Model): void {
  const info = model.hypergraph.edges.get(name);
  if (!info) {
    return;
  }
  model.hypergraph.edges.delete(name);
  for (const member of info.members) {
    const incident = model.hypergraph.incidence.get(member.endpoint);
    if (!incident) {
      continue;
    }
    const filtered = incident.filter((edge) => edge !== name);
    if (filtered.length === 0) {
      model.hypergraph.incidence.delete(member.endpoint);
    } else {
      model.hypergraph.incidence.set(member.endpoint, filtered);
    }
  }
}

export function collectConnects(
  member: { endpoints: RelationEndpoint[]; ordered: boolean },
  context: LoweringContext,
  model: Model
): {
  endpoints: string[];
  ordered: boolean;
} {
  return {
    endpoints: member.endpoints.map((endpoint) => resolveVertexName(endpoint.name, context, model)),
    ordered: member.ordered
  };
}
