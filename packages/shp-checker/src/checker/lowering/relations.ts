import * as ast from "../../language/generated/ast.ts";
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
import { duplicateDeclaration, invalidRelation, provenance } from "../provenance.ts";
import { resolveVertexName } from "../symbols.ts";
import { unquoteShapeString } from "../../shape-strings.ts";

export function lowerRelation(
  relation: ast.RelationDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, relation.name);
  const prov = provenance(context.filePath, `relation ${name}`);
  if (model.hypergraph.edges.has(name)) {
    model.diagnostics.push(
      duplicateDeclaration("relation", name, model.hypergraph.edges.get(name)?.provenance, prov)
    );
    return;
  }

  const info = buildRelationInfo(relation, name, prov, context, model);
  if (!info) {
    return;
  }
  model.hypergraph.edges.set(name, info);

  model.facts.push({
    kind: "hyperedge",
    name,
    relationKind: info.kind,
    ordered: info.ordered,
    provenance: prov
  });
  for (const member of info.members) {
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
  relation: ast.RelationDecl,
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
  const roleDecls: ast.RelationRoleEntry[] = [];
  const fingerprintExpectations: FingerprintExpectationInfo[] = [];
  const reportInvalid = (reason: string, cause = prov): void => {
    model.diagnostics.push(invalidRelation(name, reason, cause));
  };

  for (const member of relation.members) {
    if (ast.isRelationKindDecl(member)) {
      if (kindSeen) {
        reportInvalid("duplicate kind");
        continue;
      }
      kindSeen = true;
      kindValue = member.value;
    } else if (ast.isRelationConnectsDecl(member)) {
      if (connectsDecl) {
        reportInvalid("duplicate connects");
        continue;
      }
      connectsDecl = collectConnects(member, context, model);
    } else if (ast.isRelationRolesDecl(member)) {
      if (rolesSeen) {
        reportInvalid("duplicate roles");
        continue;
      }
      rolesSeen = true;
      for (const role of member.roles) {
        roleDecls.push(role);
      }
    } else if (ast.isRelationFingerprintExpectationDecl(member)) {
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
    } else if (ast.isRelationSummaryDecl(member)) {
      if (summarySeen) {
        reportInvalid("duplicate summary");
        continue;
      }
      summarySeen = true;
      summary = unquoteShapeString(member.value);
    }
  }

  if (!kindValue) {
    reportInvalid("missing kind");
    return;
  }

  if (!connectsDecl) {
    reportInvalid("missing connects");
    return;
  }

  if (connectsDecl.endpoints.length < 2) {
    reportInvalid("connects requires at least two endpoints");
    return;
  }

  const members = new Map<string, HyperedgeMember>();
  for (const [index, endpoint] of connectsDecl.endpoints.entries()) {
    if (members.has(endpoint)) {
      reportInvalid(`duplicate endpoint ${displaySymbol(endpoint)}`);
      return;
    }
    members.set(endpoint, { endpoint, index });
  }

  const rule = PRELUDE_RELATION_KINDS.get(kindValue);
  if (rule) {
    if (rule.arity === "binary" && connectsDecl.endpoints.length !== 2) {
      reportInvalid(`kind ${kindValue} requires exactly two endpoints`);
      return;
    }
    if (rule.arity === "ordered" && !connectsDecl.ordered) {
      reportInvalid(`kind ${kindValue} requires ordered connects (A -> B -> ...)`);
      return;
    }
    if (rule.traversal === "directed_pairs" && !connectsDecl.ordered) {
      reportInvalid(`kind ${kindValue} requires ordered connects (A -> B)`);
      return;
    }
  }

  for (const role of roleDecls) {
    const roleName = resolveVertexName(role.name, context, model);
    const member = members.get(roleName);
    if (!member) {
      reportInvalid(`role ${displaySymbol(roleName)} is not a connects endpoint`);
      continue;
    }
    if (Object.hasOwn(member, "role")) {
      reportInvalid(`duplicate role for ${displaySymbol(roleName)}`);
      continue;
    }
    member.role = role.role;
  }

  for (const expectation of fingerprintExpectations) {
    if (!members.has(expectation.endpoint)) {
      reportInvalid(
        `fingerprint expectation ${displaySymbol(expectation.endpoint)} is not a connects endpoint`,
        expectation.provenance
      );
    }
  }

  const info: HyperedgeInfo = {
    name,
    kind: kindValue,
    ordered: connectsDecl.ordered,
    members: [...members.values()],
    fingerprintExpectations,
    summary,
    provenance: prov
  };
  return info;
}

export function collectConnects(
  member: { endpoints: ast.RelationEndpoint[]; ordered: boolean },
  context: LoweringContext,
  model: Model
) {
  return {
    endpoints: member.endpoints.map((endpoint) => resolveVertexName(endpoint.name, context, model)),
    ordered: member.ordered
  };
}
