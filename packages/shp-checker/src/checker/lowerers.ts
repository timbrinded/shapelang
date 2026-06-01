// AST-to-model lowering: how each Shape declaration kind becomes effective-model
// state and facts, plus the change-declaration handling and the shared lowering
// helpers they build on. The orchestrator (checker/lowerer.ts) drives the
// two-pass pipeline and calls into the per-declaration lowerers exported here;
// this module never imports the orchestrator, so the dependency direction
// lowerer -> lowerers stays acyclic. Cross-layer model queries used by both
// lowering and rules live in checker/derivations.ts.
import type {
  AddDeclarationChange,
  AttestationDecl,
  BindingDecl,
  CandidateEffectDecl,
  ChangeDecl,
  ComponentDecl,
  DescriptionDecl,
  EffectEntry,
  EffectPattern,
  EffectsDecl,
  EffectTerm,
  FingerprintDecl,
  GuardForbidTransformDecl,
  GuardRequireDecl,
  ImplementationDecl,
  MemoryDecl,
  MemoryMember,
  ModifyDeclarationChange,
  PolicyDecl,
  RationaleDecl,
  RationaleMember,
  ReevaluationDecl,
  RelationDecl,
  RelationEndpoint,
  RelationRoleEntry,
  RemoveDeclarationChange,
  ResourceDecl,
  RoleDecl,
  RuleDecl,
  RuleForbidEffectDecl,
  RuleForbidHypercycleDecl,
  RuleForbidProvidesDecl,
  SourceRef,
  TargetKind,
  TargetRef,
  TraitDecl,
  TraitForbidDecl
} from "../language/generated/ast.ts";
import {
  isAddDeclarationChange,
  isAddFunctionChange,
  isAppliesToDecl,
  isApproverDecl,
  isAttestationDecl,
  isBindingAllowAttestDecl,
  isBindingDecl,
  isBindingRequireChangedDecl,
  isBindingWhenChangedDecl,
  isCandidateEffectAnchorDecl,
  isCandidateEffectConfidenceDecl,
  isCandidateEffectFunctionDecl,
  isCandidateEffectTermDecl,
  isCompleteEffects,
  isComponentDecl,
  isConfidenceDecl,
  isConformsToDecl,
  isDecidedOnDecl,
  isEvidenceLineDecl,
  isExpiresDecl,
  isFingerprintDecl,
  isFunctionRequiresDecl,
  isFunctionSummary,
  isGrantsDecl,
  isGuardForbidTransformDecl,
  isGuardsBlock,
  isImplementationDecl,
  isModifyDeclarationChange,
  isModifyFunctionChange,
  isObservedDecl,
  isOnChangeDecl,
  isOutcomeDecl,
  isOwnsDecl,
  isPathsBlock,
  isProtectsBlock,
  isReasonDecl,
  isRelationConnectsDecl,
  isRelationDecl,
  isRelationFingerprintExpectationDecl,
  isRelationKindDecl,
  isRelationRolesDecl,
  isRelationSummaryDecl,
  isRemoveDeclarationChange,
  isRemoveFunctionChange,
  isRequireApproverDecl,
  isRequireContextDecl,
  isResourceDecl,
  isReviewerDecl,
  isRuleDecl,
  isRuleForbidEffectDecl,
  isRuleForbidHypercycleDecl,
  isRuleForbidProvidesDecl,
  isRuleWhenHasDecl,
  isSatisfiesDecl,
  isSensitiveDecl,
  isStatusDecl,
  isSummaryDecl,
  isTraitDecl,
  isTraitForbidDecl,
  isUnknownEffects,
  isWhenBlock,
  isWhoBlock,
  isWhyDecl
} from "../language/generated/ast.ts";
import type {
  BindingInfo,
  CandidateEffectInfo,
  ComponentInfo,
  ContextObjectInfo,
  DescriptionInfo,
  EffectEntryInfo,
  EffectSummaryInfo,
  FinalForbidPattern,
  FingerprintExpectationInfo,
  FingerprintInfo,
  FunctionAst,
  FunctionInfo,
  HyperedgeInfo,
  HyperedgeMember,
  ImplementationInfo,
  LoweringContext,
  MemoryInfo,
  Model,
  Provenance,
  RationaleInfo,
  ReevaluationInfo,
  RuleInfo,
  ShapeTarget,
  SourceRefInfo,
  TermInfo,
  TraitContextRequirement
} from "./model.ts";
import type { ContextKind } from "../prelude.ts";
import { isPreludeTrait, PRELUDE_RELATION_KINDS } from "../prelude.ts";
import {
  declKey,
  displaySymbol,
  formatTerm,
  functionKey,
  functionTarget,
  splitFunctionTarget,
  splitQualifiedName,
  termKey
} from "./display.ts";
import { describeProvenance, provenance } from "./provenance.ts";
import {
  hasNonEmptyDescription,
  requirementsForTarget,
  requiresReevaluation,
  shapeTraitBearers
} from "./derivations.ts";
import {
  resolveContextObjectName,
  resolveDeclName,
  resolveDeclReference,
  resolveFunctionTargetName,
  resolveTargetName,
  resolveVertexName
} from "./symbols.ts";
import { normalizeShapeSourcePath, unquoteShapeString } from "../shape-strings.ts";

export function lowerResource(
  resource: ResourceDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, resource.name);
  const prov = provenance(context.filePath, `resource ${name}`);
  if (model.resources.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "resource",
      name,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(model.resources.get(name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const traits = new Map<string, Provenance>();
  for (const trait of resource.traits) {
    const traitName = resolveDeclName(trait.name, "trait", context, model);
    const traitProv = provenance(context.filePath, `resource ${name} : ${traitName}`);
    traits.set(traitName, traitProv);
    model.facts.push({
      kind: "resource_trait",
      resource: name,
      trait: traitName,
      provenance: traitProv
    });
  }

  const fingerprints = new Map<string, FingerprintInfo>();
  for (const member of resource.body?.members ?? []) {
    if (!isFingerprintDecl(member)) {
      continue;
    }
    const fingerprint = lowerFingerprint(member, context.filePath, `resource ${name}`);
    const existing = fingerprints.get(fingerprint.provider);
    if (existing) {
      model.diagnostics.push({
        kind: "duplicate_fingerprint",
        resource: name,
        provider: fingerprint.provider,
        filePath: context.filePath,
        causedBy: [
          describeProvenance(existing.provenance),
          describeProvenance(fingerprint.provenance)
        ]
      });
      continue;
    }
    fingerprints.set(fingerprint.provider, fingerprint);
    model.facts.push({
      kind: "resource_fingerprint",
      resource: name,
      provider: fingerprint.provider,
      value: fingerprint.value,
      provenance: fingerprint.provenance
    });
  }

  model.resources.set(name, {
    name,
    traits,
    fingerprints,
    generatedAstCandidate: context.generatedAst,
    provenance: prov
  });
  model.facts.push({ kind: "resource", name, provenance: prov });
}

export function lowerTrait(trait: TraitDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, trait.name);
  const prov = provenance(context.filePath, `trait ${name}`);
  if (model.traits.has(name) && !isPreludeTrait(model.traits.get(name))) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "trait",
      name,
      filePath: context.filePath,
      causedBy: [describeProvenance(model.traits.get(name)?.provenance), describeProvenance(prov)]
    });
    return;
  }

  const typeParams = trait.typeParams?.params.map((param) => param.name) ?? [];
  const finalForbids: FinalForbidPattern[] = [];
  const contextRequirements: TraitContextRequirement[] = [];
  for (const member of trait.members) {
    if (isTraitForbidDecl(member)) {
      finalForbids.push(
        lowerForbidPattern(member, context, model, `trait ${name}`, new Set(typeParams))
      );
    } else if (isRequireContextDecl(member)) {
      const memberProvenance = provenance(
        context.filePath,
        `trait ${name} require_context ${member.contextType}<${member.target}>`
      );
      const resolved = requireContextTargetKind(trait, member.target);
      if ("reason" in resolved) {
        model.diagnostics.push({
          kind: "invalid_require_context",
          trait: name,
          contextType: member.contextType,
          typeParam: member.target,
          reason: resolved.reason,
          filePath: context.filePath,
          causedBy: [describeProvenance(memberProvenance)]
        });
        continue;
      }
      contextRequirements.push({
        targetKind: resolved.kind,
        contextType: member.contextType,
        satisfiedBy: lowerSatisfiedByKinds(member.satisfiedBy),
        requiresDescription: false,
        provenance: memberProvenance
      });
    }
  }

  model.traits.set(name, {
    name,
    typeParams,
    finalForbids,
    contextRequirements,
    provenance: prov
  });
}

/**
 * Resolves the target kind of a `require_context` obligation from the bound of
 * the trait type parameter it names (`<T: Fn>` -> fn). An unbound type parameter
 * defaults to fn (the most common shape-trait target). A `<target>` that names
 * no declared type parameter, or a bound that is not Fn/Component/Resource, is
 * reported so a typo cannot silently drop the obligation.
 */
export function requireContextTargetKind(
  trait: TraitDecl,
  typeParamName: string
): { kind: TargetKind } | { reason: string } {
  const param = trait.typeParams?.params.find((entry) => entry.name === typeParamName);
  if (!param) {
    return { reason: `type parameter ${typeParamName} is not declared by the trait` };
  }
  if (!param.bound) {
    return { kind: "fn" };
  }
  switch (param.bound.toLowerCase()) {
    case "fn":
    case "function":
      return { kind: "fn" };
    case "component":
      return { kind: "component" };
    case "resource":
      return { kind: "resource" };
    default:
      return {
        reason: `type parameter ${typeParamName} has unsupported bound ${param.bound} (expected Fn, Component, or Resource)`
      };
  }
}

// satisfiedBy is already constrained to memory|rationale by the grammar
// (ContextObjectKind); the filter is defensive and an empty clause defaults to
// accepting either kind.
export function lowerSatisfiedByKinds(kinds: string[]): ContextKind[] {
  const allowed = kinds.filter(
    (kind): kind is ContextKind => kind === "rationale" || kind === "memory"
  );
  return allowed.length > 0 ? [...new Set(allowed)] : ["rationale", "memory"];
}

export function lowerComponent(
  component: ComponentDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, component.name);
  const prov = provenance(context.filePath, `component ${name}`);
  if (model.components.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "component",
      name,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(model.components.get(name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info: ComponentInfo = {
    name,
    classifiers: new Map(),
    grants: new Map(),
    owns: new Map(),
    functions: new Map(),
    generatedAstCandidate: context.generatedAst,
    provenance: prov
  };

  for (const classifier of component.classifiers) {
    const traitName = resolveDeclName(classifier.name, "trait", context, model);
    const classifierProv = provenance(context.filePath, `component ${name} : ${traitName}`);
    info.classifiers.set(traitName, classifierProv);
    model.facts.push({
      kind: "shape_trait",
      targetKind: "component",
      target: name,
      trait: traitName,
      provenance: classifierProv
    });
  }

  for (const member of component.members) {
    if (isOwnsDecl(member)) {
      const resourceName = resolveDeclName(member.resource.name, "resource", context, model);
      const memberProv = provenance(context.filePath, `component ${name} owns ${resourceName}`);
      info.owns.set(resourceName, memberProv);
      model.facts.push({
        kind: "owns",
        component: name,
        resource: resourceName,
        provenance: memberProv
      });
    } else if (isGrantsDecl(member)) {
      const grant = lowerTerm(member.term, context, model);
      const memberProv = provenance(
        context.filePath,
        `component ${name} grants ${formatTerm(grant.name, grant.target ?? "")}`
      );
      info.grants.set(termKey(grant), memberProv);
      model.facts.push({
        kind: "grants",
        component: name,
        effect: grant.name,
        target: grant.target ?? "",
        provenance: memberProv
      });
    } else if (isFunctionSummary(member)) {
      const fn = lowerFunction(member, name, context, model);
      info.functions.set(fn.name, fn);
      emitFunctionFacts(fn, model);
    }
  }

  model.components.set(name, info);
  model.facts.push({ kind: "component", name, provenance: prov });
}

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

  model.hypergraph.edges.set(name, info);
  for (const member of members) {
    const incident = model.hypergraph.incidence.get(member.endpoint) ?? [];
    incident.push(name);
    model.hypergraph.incidence.set(member.endpoint, incident);
  }

  model.facts.push({
    kind: "hyperedge",
    name,
    relationKind: kindValue,
    ordered: connectsDecl.ordered,
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
  for (const expectation of fingerprintExpectations) {
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

export function lowerCandidateEffect(
  candidateEffect: CandidateEffectDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, candidateEffect.name);
  const prov = provenance(context.filePath, `effect candidate ${name}`);
  if (model.candidateEffects.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "candidate_effect",
      name,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(model.candidateEffects.get(name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info: CandidateEffectInfo = {
    name,
    provenance: prov
  };
  const seen = {
    fn: 0,
    effect: 0,
    source: 0,
    confidence: 0,
    pin: 0
  };

  for (const member of candidateEffect.members) {
    if (isCandidateEffectFunctionDecl(member)) {
      seen.fn += 1;
      if (seen.fn > 1) {
        pushInvalidCandidateEffect(model, name, "duplicate fn", context.filePath, prov);
        continue;
      }
      info.functionTarget = resolveFunctionTargetName(member.function, context, model);
    } else if (isCandidateEffectTermDecl(member)) {
      seen.effect += 1;
      if (seen.effect > 1) {
        pushInvalidCandidateEffect(model, name, "duplicate effect", context.filePath, prov);
        continue;
      }
      info.term = lowerTerm(member.term, context, model);
    } else if (isCandidateEffectConfidenceDecl(member)) {
      seen.confidence += 1;
      if (seen.confidence > 1) {
        pushInvalidCandidateEffect(model, name, "duplicate confidence", context.filePath, prov);
        continue;
      }
      info.confidence = member.value;
    } else if (isCandidateEffectAnchorDecl(member)) {
      seen.pin += 1;
      if (seen.pin > 1) {
        pushInvalidCandidateEffect(model, name, "duplicate pin", context.filePath, prov);
        continue;
      }
      info.anchor = resolveDeclName(member.target.name, "resource", context, model);
      info.fingerprintProvider = member.provider;
      info.fingerprintValue = unquoteShapeString(member.value);
    } else {
      seen.source += 1;
      if (seen.source > 1) {
        pushInvalidCandidateEffect(model, name, "duplicate source", context.filePath, prov);
        continue;
      }
      info.source = lowerSourceRef(member);
    }
  }

  for (const [field, count] of Object.entries(seen)) {
    if (count === 0) {
      pushInvalidCandidateEffect(model, name, `missing ${field}`, context.filePath, prov);
    }
  }

  model.candidateEffects.set(name, info);
  model.facts.push({
    kind: "candidate_effect",
    name,
    functionTarget: info.functionTarget ?? "",
    effect: info.term?.name ?? "",
    target: info.term?.target ?? "",
    source: info.source,
    confidence: info.confidence,
    anchor: info.anchor,
    fingerprintProvider: info.fingerprintProvider,
    fingerprintValue: info.fingerprintValue,
    provenance: prov
  });
}

export function pushInvalidCandidateEffect(
  model: Model,
  name: string,
  reason: string,
  filePath: string | undefined,
  provenanceInfo: Provenance
): void {
  model.diagnostics.push({
    kind: "invalid_candidate_effect",
    name,
    reason,
    filePath,
    causedBy: [describeProvenance(provenanceInfo)]
  });
}

export function lowerImplementation(
  implementation: ImplementationDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, implementation.name);
  const prov = provenance(context.filePath, `implementation ${name}`);
  const info: ImplementationInfo = {
    name,
    paths: [],
    provenance: prov
  };

  for (const member of implementation.members) {
    if (isPathsBlock(member)) {
      for (const path of member.paths) {
        const glob = unquoteShapeString(path);
        const pathProv = provenance(context.filePath, `implementation ${name} path ${glob}`);
        info.paths.push({ glob, provenance: pathProv });
        model.facts.push({
          kind: "implementation_path",
          implementation: name,
          glob,
          provenance: pathProv
        });
      }
    } else if (isConformsToDecl(member)) {
      info.conformsTo = resolveDeclName(member.component.name, "component", context, model);
      model.facts.push({
        kind: "conforms_to",
        implementation: name,
        component: info.conformsTo,
        provenance: provenance(
          context.filePath,
          `implementation ${name} conforms_to ${info.conformsTo}`
        )
      });
    } else if (isOnChangeDecl(member)) {
      info.onChangeRequirement = member.requirement;
    }
  }

  model.implementations.push(info);
  model.facts.push({ kind: "implementation", name, provenance: prov });
}

export function lowerBinding(binding: BindingDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, binding.name);
  const prov = provenance(context.filePath, `binding ${name}`);
  if (model.bindings.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "binding",
      name,
      filePath: context.filePath,
      causedBy: [describeProvenance(model.bindings.get(name)?.provenance), describeProvenance(prov)]
    });
    return;
  }

  const info: BindingInfo = {
    name,
    whenChanged: [],
    requireChanged: [],
    allowAttestations: [],
    provenance: prov
  };

  for (const member of binding.members) {
    if (isBindingWhenChangedDecl(member)) {
      for (const path of member.body.paths) {
        const glob = unquoteShapeString(path);
        const pathProv = provenance(context.filePath, `binding ${name} when_changed ${glob}`);
        info.whenChanged.push({ glob, provenance: pathProv });
        model.facts.push({
          kind: "binding_when_changed",
          binding: name,
          glob,
          provenance: pathProv
        });
      }
    } else if (isBindingRequireChangedDecl(member)) {
      for (const path of member.body.paths) {
        const glob = unquoteShapeString(path);
        const pathProv = provenance(context.filePath, `binding ${name} require_changed ${glob}`);
        info.requireChanged.push({ glob, provenance: pathProv });
        model.facts.push({
          kind: "binding_require_changed",
          binding: name,
          glob,
          provenance: pathProv
        });
      }
    } else if (isBindingAllowAttestDecl(member)) {
      const attestProv = provenance(
        context.filePath,
        `binding ${name} allow attest ${member.kind}`
      );
      info.allowAttestations.push({ kind: member.kind, provenance: attestProv });
      model.facts.push({
        kind: "binding_allow_attest",
        binding: name,
        kindName: member.kind,
        provenance: attestProv
      });
    }
  }

  model.bindings.set(name, info);
  model.facts.push({ kind: "binding", name, provenance: prov });
}

export function lowerAttestation(
  attestation: AttestationDecl,
  context: LoweringContext,
  model: Model
): void {
  const source = lowerSourceRef(attestation.source);
  const path = normalizeShapeSourcePath(source.path);
  const reason = unquoteShapeString(attestation.reason.value);
  const prov = provenance(context.filePath, `attest ${attestation.kind} for ${path}`);
  model.attestations.push({ kind: attestation.kind, path, reason, provenance: prov });
  model.facts.push({
    kind: "attestation",
    kindName: attestation.kind,
    path,
    reason,
    provenance: prov
  });
}

export function lowerRule(rule: RuleDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, rule.name);
  const finalForbidSubjects = new Set(
    rule.members.filter(isRuleWhenHasDecl).map((member) => member.subject)
  );
  const hasFinalForbid = rule.members.some(
    (member) => isRuleForbidEffectDecl(member) && member.final
  );
  const finalForbidSubject =
    hasFinalForbid && finalForbidSubjects.size === 1 ? [...finalForbidSubjects][0] : undefined;
  const info: RuleInfo = {
    name,
    whenHas: [],
    finalForbidSubject,
    forbidEffects: [],
    forbidProvides: [],
    forbidHypercycles: [],
    provenance: provenance(context.filePath, `rule ${name}`)
  };

  for (const member of rule.members) {
    if (isRuleWhenHasDecl(member)) {
      info.whenHas.push({
        subject: member.subject,
        trait: resolveDeclName(member.trait, "trait", context, model)
      });
    } else if (isRuleForbidEffectDecl(member)) {
      info.forbidEffects.push(lowerRuleForbid(member, context, model, name, finalForbidSubjects));
    } else if (isRuleForbidProvidesDecl(member)) {
      info.forbidProvides.push(lowerRuleForbidProvides(member, context, model, name));
    } else if (isRuleForbidHypercycleDecl(member)) {
      info.forbidHypercycles.push(lowerRuleForbidHypercycle(member, context.filePath, name));
    }
  }

  model.rules.push(info);
  model.facts.push({ kind: "rule", name, provenance: info.provenance });
}

export function lowerRationale(
  rationale: RationaleDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, rationale.name);
  const prov = provenance(context.filePath, `rationale ${name}`);
  if (model.rationales.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "rationale",
      name,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(model.rationales.get(name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info: RationaleInfo = {
    name,
    contextType: rationale.contextType.name,
    target: lowerTargetRef(rationale.contextType.target, context, model),
    protects: [],
    guards: [],
    forbiddenTransforms: [],
    evidence: [],
    provenance: prov
  };

  for (const member of rationale.members) {
    if (lowerContextMember(member, info, "rationale", context, model)) {
      continue;
    }

    if (isWhyDecl(member)) {
      info.why = member.reason;
    }
  }

  model.rationales.set(name, info);
  model.facts.push({
    kind: "rationale",
    name,
    contextType: info.contextType,
    targetKind: info.target.kind,
    target: info.target.name,
    provenance: prov
  });
  emitGuardFacts("rationale", info, model);
}

export function lowerMemory(memory: MemoryDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, memory.name);
  const prov = provenance(context.filePath, `memory ${name}`);
  if (model.memories.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "memory",
      name,
      filePath: context.filePath,
      causedBy: [describeProvenance(model.memories.get(name)?.provenance), describeProvenance(prov)]
    });
    return;
  }

  const info: MemoryInfo = {
    name,
    contextType: memory.contextType.name,
    target: lowerTargetRef(memory.contextType.target, context, model),
    sensitive: false,
    protects: [],
    guards: [],
    forbiddenTransforms: [],
    observed: [],
    evidence: [],
    provenance: prov
  };

  for (const member of memory.members) {
    if (lowerContextMember(member, info, "memory", context, model)) {
      continue;
    }

    if (isStatusDecl(member)) {
      info.status = member.value;
    } else if (isConfidenceDecl(member)) {
      info.confidence = member.value;
    } else if (isObservedDecl(member)) {
      info.observed.push(lowerSourceRef(member));
    } else if (isSensitiveDecl(member)) {
      info.sensitive = true;
    }
  }

  model.memories.set(name, info);
  model.facts.push({
    kind: "memory",
    name,
    contextType: info.contextType,
    targetKind: info.target.kind,
    target: info.target.name,
    provenance: prov
  });
  emitGuardFacts("memory", info, model);
}

export function lowerContextMember(
  member: RationaleMember | MemoryMember,
  info: ContextObjectInfo,
  kind: ContextKind,
  context: LoweringContext,
  model: Model
): boolean {
  if (isAppliesToDecl(member)) {
    info.appliesTo = lowerTargetRef(member.target, context, model);
    return true;
  }
  if (isSummaryDecl(member)) {
    info.summary = unquoteShapeString(member.value);
    return true;
  }
  if (isEvidenceLineDecl(member)) {
    info.evidence.push(lowerSourceRef(member));
    return true;
  }
  // Grouped blocks are the only guard-member syntax; they lower into the
  // shared context info.
  if (isProtectsBlock(member)) {
    for (const entry of member.entries) {
      pushProtects(info, kind, entry.kind, entry.value, context, model);
    }
    return true;
  }
  if (isGuardsBlock(member)) {
    for (const entry of member.entries) {
      pushGuard(info, kind, entry, context);
    }
    return true;
  }
  if (isWhoBlock(member)) {
    if (member.owner) {
      info.owner = member.owner.value;
    }
    return true;
  }
  if (isWhenBlock(member)) {
    if (member.date) {
      info.reviewBy = unquoteShapeString(member.date.value);
    }
    return true;
  }
  return false;
}

export function pushProtects(
  info: ContextObjectInfo,
  kind: ContextKind,
  propertyKind: string,
  rawValue: string | undefined,
  context: LoweringContext,
  model: Model
): void {
  const value = rawValue ?? "";
  // Resolve a protected shape trait the same way classifiers resolve, so a
  // module-qualified or user-defined trait matches its `shape_trait_removed`
  // event. resolveDeclReference is used (not resolveDeclName) so a free-form
  // protected label never emits a spurious ambiguity diagnostic.
  const resolvedValue =
    propertyKind === "shape" && value
      ? resolveDeclReference(value, "trait", context, model).name
      : undefined;
  info.protects.push({
    kind: propertyKind,
    value,
    resolvedValue,
    provenance: provenance(
      context.filePath,
      `${kind} ${info.name} protects ${propertyKind}${value ? ` ${value}` : ""}`
    )
  });
}

export function pushGuard(
  info: ContextObjectInfo,
  kind: ContextKind,
  action: GuardRequireDecl | GuardForbidTransformDecl,
  context: LoweringContext
): void {
  if (isGuardForbidTransformDecl(action)) {
    info.forbiddenTransforms.push({
      label: action.label,
      provenance: provenance(
        context.filePath,
        `${kind} ${info.name} guards forbid transform ${action.label}`
      )
    });
  } else {
    info.guards.push({
      requirement: action.requirement,
      provenance: provenance(
        context.filePath,
        `${kind} ${info.name} guards on_change require ${action.requirement}`
      )
    });
  }
}

export function lowerReevaluation(
  reevaluation: ReevaluationDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, reevaluation.name);
  const prov = provenance(context.filePath, `reevaluation ${name}`);
  if (model.reevaluations.has(name)) {
    model.diagnostics.push({
      kind: "duplicate_declaration",
      declarationKind: "reevaluation",
      name,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(model.reevaluations.get(name)?.provenance),
        describeProvenance(prov)
      ]
    });
    return;
  }

  const info: ReevaluationInfo = {
    name,
    evidence: [],
    provenance: prov
  };

  for (const member of reevaluation.members) {
    if (isSatisfiesDecl(member)) {
      info.satisfiesKind = member.kind;
      info.satisfiesName = resolveContextObjectName(member.kind, member.name, context, model);
    } else if (isOutcomeDecl(member)) {
      info.outcome = member.value;
    } else if (isSummaryDecl(member)) {
      info.summary = unquoteShapeString(member.value);
    } else if (isEvidenceLineDecl(member)) {
      info.evidence.push(lowerSourceRef(member));
    } else if (isReviewerDecl(member)) {
      info.reviewer = member.value;
    } else if (isApproverDecl(member)) {
      info.approver = member.value;
    } else if (isDecidedOnDecl(member)) {
      info.decidedOn = unquoteShapeString(member.value);
    }
  }

  model.reevaluations.set(name, info);
  if (info.satisfiesKind && info.satisfiesName) {
    model.facts.push({
      kind: "reevaluation",
      name,
      satisfiesKind: info.satisfiesKind,
      satisfies: info.satisfiesName,
      provenance: prov
    });
  }
}

/**
 * A `role` declares a valid reviewer/approver identity. Roles are matched by
 * their local name, so a role declared in any module authorises that name.
 * Declaring at least one role turns on structural reviewer/approver validation.
 */
export function lowerRole(role: RoleDecl, context: LoweringContext, model: Model): void {
  if (!model.roles.has(role.name)) {
    model.roles.set(role.name, provenance(context.filePath, `role ${role.name}`));
  }
}

export function lowerPolicy(policy: PolicyDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, policy.name);
  const requiresApprover = policy.members.some(isRequireApproverDecl);
  const existing = model.policies.get(name);
  if (existing) {
    // Merge rather than ignore: a later `policy P { require approver }` must not
    // be silently dropped by an earlier empty declaration of the same name, or
    // sensitive memories would stop requiring approvers.
    existing.requiresApprover ||= requiresApprover;
    return;
  }
  model.policies.set(name, {
    name,
    requiresApprover,
    provenance: provenance(context.filePath, `policy ${name}`)
  });
}

export function emitGuardFacts(
  kind: ContextKind,
  info: RationaleInfo | MemoryInfo,
  model: Model
): void {
  for (const item of info.protects) {
    model.facts.push({
      kind: "protected_shape",
      guardKind: kind,
      guard: info.name,
      targetKind: info.target.kind,
      target: info.target.name,
      propertyKind: item.kind,
      propertyValue: item.value,
      provenance: item.provenance
    });
  }

  for (const guard of info.guards) {
    if (requiresReevaluation(guard)) {
      model.facts.push({
        kind: "guard_requires_reevaluation",
        guardKind: kind,
        guard: info.name,
        targetKind: info.target.kind,
        target: info.target.name,
        provenance: guard.provenance
      });
    }
  }
}

export function lowerChange(change: ChangeDecl, context: LoweringContext, model: Model): void {
  for (const entry of change.entries) {
    if (isAddFunctionChange(entry) || isModifyFunctionChange(entry)) {
      const [componentName, functionName] = resolveFunctionTargetParts(
        entry.target,
        context,
        model
      );
      if (!componentName || !functionName) {
        model.diagnostics.push({
          kind: "unknown_name",
          nameKind: "component",
          name: entry.target,
          filePath: context.filePath,
          causedBy: [
            describeProvenance(
              provenance(context.filePath, `change ${change.name} ${entry.$type} ${entry.target}`)
            )
          ]
        });
        continue;
      }
      const component = model.components.get(componentName);
      if (!component) {
        model.diagnostics.push({
          kind: "unknown_name",
          nameKind: "component",
          name: componentName,
          filePath: context.filePath,
          causedBy: [
            describeProvenance(
              provenance(
                context.filePath,
                `change ${change.name} ${entry.$type} ${componentName}.${functionName}`
              )
            )
          ]
        });
        continue;
      }

      const previous = component.functions.get(functionName);
      const fn = lowerFunction(entry, componentName, context, model, `change ${change.name}`);
      if (isModifyFunctionChange(entry)) {
        const target = functionTarget(componentName, functionName);
        const changeProvenance = provenance(
          context.filePath,
          `change ${change.name} modify fn ${componentName}.${functionName}`
        );
        emitTargetChange(
          target,
          removedTraitsBetween(previous?.shapeTraits, fn.shapeTraits),
          descriptionDropped(previous, fn),
          changeProvenance,
          model
        );
        for (const label of entry.transforms?.labels ?? []) {
          model.changeEvents.push({
            kind: "transform_applied",
            target,
            label,
            provenance: changeProvenance
          });
        }
      }
      removeFunctionFacts(model, componentName, functionName);
      component.functions.set(fn.name, fn);
      emitFunctionFacts(fn, model);
    } else if (isRemoveFunctionChange(entry)) {
      const [componentName, functionName] = resolveFunctionTargetParts(
        entry.target,
        context,
        model
      );
      if (!componentName || !functionName) {
        model.diagnostics.push({
          kind: "unknown_name",
          nameKind: "component",
          name: entry.target,
          filePath: context.filePath,
          causedBy: [
            describeProvenance(
              provenance(context.filePath, `change ${change.name} remove fn ${entry.target}`)
            )
          ]
        });
        continue;
      }
      const removed = model.components.get(componentName)?.functions.get(functionName);
      emitTargetChange(
        functionTarget(componentName, functionName),
        removed ? [...removed.shapeTraits.keys()] : [],
        removed ? hasNonEmptyDescription(removed) : false,
        provenance(
          context.filePath,
          `change ${change.name} remove fn ${componentName}.${functionName}`
        ),
        model
      );
      removeFunctionFacts(model, componentName, functionName);
      model.components.get(componentName)?.functions.delete(functionName);
    } else if (isAddDeclarationChange(entry)) {
      lowerDeclaration(entry.declaration, context, model);
    } else if (isModifyDeclarationChange(entry)) {
      const kind = declarationKind(entry.declaration);
      if (kind !== "attestation") {
        const localName = declarationName(entry.declaration);
        const targetContext = contextForDeclarationChange(kind, localName, context, model);
        const resolvedName = resolveDeclName(localName, kind, targetContext, model);
        const before = declarationShapeTraits(kind, resolvedName, model);
        removeDeclaration(kind, localName, targetContext, model);
        lowerDeclaration(entry.declaration, targetContext, model);
        const after = declarationShapeTraits(kind, resolvedName, model);
        emitDeclarationChange(
          kind,
          resolvedName,
          removedTraitsBetween(before, after),
          provenance(context.filePath, `change ${change.name} modify ${kind} ${resolvedName}`),
          model
        );
        continue;
      }
      lowerDeclaration(entry.declaration, context, model);
    } else if (isRemoveDeclarationChange(entry)) {
      const resolvedName = resolveDeclName(entry.name, entry.kind, context, model);
      const before = declarationShapeTraits(entry.kind, resolvedName, model);
      emitDeclarationChange(
        entry.kind,
        resolvedName,
        before ? [...before.keys()] : [],
        provenance(context.filePath, `change ${change.name} remove ${entry.kind} ${resolvedName}`),
        model
      );
      removeDeclaration(entry.kind, entry.name, context, model);
    }
  }
}

export function resolveFunctionTargetParts(
  target: string,
  context: LoweringContext,
  model: Model
): [string | undefined, string | undefined] {
  return splitFunctionTarget(resolveFunctionTargetName(target, context, model));
}

/**
 * Records a change to a target: a coarse `target_changed` event plus a
 * property-level `shape_trait_removed`/`description_removed` event for each
 * dropped property, so guarded-change checking can match either granularity.
 */
export function emitTargetChange(
  target: ShapeTarget,
  removedTraits: string[],
  descriptionRemoved: boolean,
  prov: Provenance,
  model: Model
): void {
  model.changeEvents.push({ kind: "target_changed", target, provenance: prov });
  for (const trait of removedTraits) {
    model.changeEvents.push({ kind: "shape_trait_removed", target, trait, provenance: prov });
  }
  if (descriptionRemoved) {
    model.changeEvents.push({ kind: "description_removed", target, provenance: prov });
  }
}

export function emitDeclarationChange(
  kind: RemoveDeclarationChange["kind"],
  resolvedName: string,
  removedTraits: string[],
  prov: Provenance,
  model: Model
): void {
  // Only target kinds that a guard can protect emit change events. Relations
  // carry no shape traits, so they record a coarse target change only.
  if (kind !== "component" && kind !== "resource" && kind !== "relation") {
    return;
  }
  emitTargetChange({ kind, name: resolvedName }, removedTraits, false, prov, model);
}

export function declarationShapeTraits(
  kind: RemoveDeclarationChange["kind"],
  resolvedName: string,
  model: Model
): ReadonlyMap<string, Provenance> | undefined {
  if (kind === "component") {
    return model.components.get(resolvedName)?.classifiers;
  }
  if (kind === "resource") {
    return model.resources.get(resolvedName)?.traits;
  }
  return undefined;
}

export function removedTraitsBetween(
  before: ReadonlyMap<string, Provenance> | undefined,
  after: ReadonlyMap<string, Provenance> | undefined
): string[] {
  if (!before) {
    return [];
  }
  return [...before.keys()].filter((trait) => after?.has(trait) !== true);
}

export function descriptionDropped(
  previous: FunctionInfo | undefined,
  next: FunctionInfo
): boolean {
  return (
    previous !== undefined && hasNonEmptyDescription(previous) && !hasNonEmptyDescription(next)
  );
}

export function contextForDeclarationChange(
  kind: RemoveDeclarationChange["kind"],
  name: string,
  context: LoweringContext,
  model: Model
): LoweringContext {
  const resolvedName = resolveDeclName(name, kind, context, model);
  const qualified = splitQualifiedName(resolvedName);
  if (!qualified.moduleName) {
    return context;
  }
  return {
    ...context,
    name: qualified.moduleName,
    imports: model.modules.get(qualified.moduleName)?.imports ?? []
  };
}

export function lowerDeclaration(
  declaration: AddDeclarationChange["declaration"] | ModifyDeclarationChange["declaration"],
  context: LoweringContext,
  model: Model
): void {
  if (isResourceDecl(declaration)) {
    lowerResource(declaration, context, model);
  } else if (isTraitDecl(declaration)) {
    lowerTrait(declaration, context, model);
  } else if (isComponentDecl(declaration)) {
    lowerComponent(declaration, context, model);
  } else if (isRelationDecl(declaration)) {
    lowerRelation(declaration, context, model);
  } else if (isImplementationDecl(declaration)) {
    lowerImplementation(declaration, context, model);
  } else if (isBindingDecl(declaration)) {
    lowerBinding(declaration, context, model);
  } else if (isAttestationDecl(declaration)) {
    lowerAttestation(declaration, context, model);
  } else if (isRuleDecl(declaration)) {
    lowerRule(declaration, context, model);
  }
}

export function removeDeclaration(
  kind: RemoveDeclarationChange["kind"],
  name: string,
  context: LoweringContext,
  model: Model
): void {
  const resolvedName = resolveDeclName(name, kind, context, model);
  if (kind === "resource") {
    model.resources.delete(resolvedName);
  } else if (kind === "trait") {
    // Obligations live on the trait, so deleting it drops them automatically.
    model.traits.delete(resolvedName);
  } else if (kind === "component") {
    model.components.delete(resolvedName);
  } else if (kind === "relation") {
    removeRelation(resolvedName, model);
  } else if (kind === "implementation") {
    model.implementations = model.implementations.filter(
      (implementation) => implementation.name !== resolvedName
    );
  } else if (kind === "binding") {
    model.bindings.delete(resolvedName);
  } else if (kind === "rule") {
    model.rules = model.rules.filter((rule) => rule.name !== resolvedName);
  }
}

export function declarationKind(
  declaration: AddDeclarationChange["declaration"] | ModifyDeclarationChange["declaration"]
): RemoveDeclarationChange["kind"] | "attestation" {
  if (isResourceDecl(declaration)) {
    return "resource";
  }
  if (isTraitDecl(declaration)) {
    return "trait";
  }
  if (isComponentDecl(declaration)) {
    return "component";
  }
  if (isRelationDecl(declaration)) {
    return "relation";
  }
  if (isImplementationDecl(declaration)) {
    return "implementation";
  }
  if (isBindingDecl(declaration)) {
    return "binding";
  }
  if (isAttestationDecl(declaration)) {
    return "attestation";
  }
  return "rule";
}

export function declarationName(
  declaration: AddDeclarationChange["declaration"] | ModifyDeclarationChange["declaration"]
): string {
  if (isAttestationDecl(declaration)) {
    return declaration.kind;
  }
  return declaration.name;
}

export function lowerFunction(
  fn: FunctionAst,
  componentName: string,
  loweringContext: LoweringContext,
  model: Model,
  labelContext?: string
): FunctionInfo {
  const functionName = functionNameForAst(fn);
  const source = fn.source ? lowerSourceRef(fn.source) : undefined;
  const info: FunctionInfo = {
    component: componentName,
    name: functionName,
    source,
    unsafe: fn.unsafe,
    effects: lowerEffects(
      fn.effects,
      loweringContext.filePath,
      componentName,
      functionName,
      loweringContext,
      model
    ),
    requires: [],
    shapeTraits: lowerShapeTraits(fn, componentName, loweringContext, model, labelContext),
    description: fn.description
      ? lowerDescription(
          fn.description,
          componentName,
          functionName,
          loweringContext.filePath,
          labelContext
        )
      : undefined,
    generatedAstCandidate: loweringContext.generatedAst,
    provenance: provenance(
      loweringContext.filePath,
      `${labelContext ? `${labelContext} ` : ""}fn ${componentName}.${functionName}`
    )
  };

  for (const member of fn.members) {
    if (isFunctionRequiresDecl(member)) {
      info.requires.push(lowerTerm(member.term, loweringContext, model));
    } else if (isReasonDecl(member)) {
      info.reason = unquoteShapeString(member.value);
    } else if (isExpiresDecl(member)) {
      info.expires = unquoteShapeString(member.value);
    }
  }

  return info;
}

export function functionNameForAst(fn: FunctionAst): string {
  if (isFunctionSummary(fn)) {
    return fn.name;
  }
  const [, functionName] = splitFunctionTarget(fn.target);
  return functionName ?? fn.target;
}

export function lowerShapeTraits(
  fn: FunctionAst,
  componentName: string,
  context: LoweringContext,
  model: Model,
  labelContext?: string
): Map<string, Provenance> {
  const traits = new Map<string, Provenance>();
  const functionName = functionNameForAst(fn);
  for (const trait of fn.shapeTraits?.traits ?? []) {
    const traitName = resolveDeclName(trait.name, "trait", context, model);
    traits.set(
      traitName,
      provenance(
        context.filePath,
        `${labelContext ? `${labelContext} ` : ""}fn ${componentName}.${functionName} : ${traitName}`
      )
    );
  }
  return traits;
}

export function lowerDescription(
  description: DescriptionDecl,
  componentName: string,
  functionName: string,
  filePath: string | undefined,
  context?: string
): DescriptionInfo {
  return {
    required: description.required,
    summary: unquoteShapeString(description.summary),
    provenance: provenance(
      filePath,
      `${context ? `${context} ` : ""}fn ${componentName}.${functionName} description`
    )
  };
}

export function lowerEffects(
  effects: EffectsDecl,
  filePath: string | undefined,
  componentName: string,
  functionName: string,
  context: LoweringContext,
  model: Model
): EffectSummaryInfo {
  if (isUnknownEffects(effects)) {
    return { kind: "unknown" };
  }

  if (!isCompleteEffects(effects)) {
    return { kind: "unknown" };
  }

  return {
    kind: "complete",
    entries: effects.effects.map((entry) =>
      lowerEffectEntry(entry, filePath, componentName, functionName, context, model)
    )
  };
}

export function lowerEffectEntry(
  entry: EffectEntry,
  filePath: string | undefined,
  componentName: string,
  functionName: string,
  context: LoweringContext,
  model: Model
): EffectEntryInfo {
  const term = lowerTerm(entry.term, context, model);
  return {
    term,
    evidence: entry.evidence ? lowerSourceRef(entry.evidence) : undefined,
    provenance: provenance(
      filePath,
      `effect ${componentName}.${functionName} emits ${formatTerm(term.name, term.target ?? "")}`
    )
  };
}

export function lowerForbidPattern(
  member: TraitForbidDecl,
  context: LoweringContext,
  model: Model,
  owner: string,
  genericTargets: Set<string>
): FinalForbidPattern {
  const pattern = lowerPattern(member.pattern, context, model, genericTargets);
  return {
    effect: pattern.name,
    target: pattern.target,
    targetBinding: pattern.targetBinding,
    final: member.final,
    provenance: provenance(
      context.filePath,
      `${owner} forbids ${member.final ? "final " : ""}${formatTerm(pattern.name, pattern.target ?? "")}`
    )
  };
}

export function lowerRuleForbid(
  member: RuleForbidEffectDecl,
  context: LoweringContext,
  model: Model,
  ruleName: string,
  genericTargets: Set<string>
): FinalForbidPattern {
  const pattern = lowerPattern(member.pattern, context, model, genericTargets);
  return {
    effect: pattern.name,
    target: pattern.target,
    targetBinding: pattern.targetBinding,
    final: member.final,
    provenance: provenance(
      context.filePath,
      `rule ${ruleName} forbids ${member.final ? "final " : ""}${formatTerm(pattern.name, pattern.target ?? "")}`
    )
  };
}

export function lowerRuleForbidProvides(
  member: RuleForbidProvidesDecl,
  context: LoweringContext,
  model: Model,
  ruleName: string
): RuleInfo["forbidProvides"][number] {
  const target = resolveDeclName(member.target.name, "resource", context, model);
  const except = member.except
    ? resolveDeclName(member.except, "component", context, model)
    : undefined;
  return {
    target,
    except,
    provenance: provenance(context.filePath, `rule ${ruleName} forbids provides ${target}`)
  };
}

export function lowerRuleForbidHypercycle(
  member: RuleForbidHypercycleDecl,
  filePath: string | undefined,
  ruleName: string
): RuleInfo["forbidHypercycles"][number] {
  return {
    kinds: [...member.kinds],
    provenance: provenance(
      filePath,
      `rule ${ruleName} forbids hypercycle${member.kinds.length > 0 ? ` over ${member.kinds.join(" or ")}` : ""}`
    )
  };
}

export function lowerTerm(term: EffectTerm, context: LoweringContext, model: Model): TermInfo {
  return {
    name: term.name,
    target: term.target ? resolveDeclName(term.target.name, "resource", context, model) : undefined
  };
}

export function lowerPattern(
  pattern: EffectPattern,
  context: LoweringContext,
  model: Model,
  genericTargets: Set<string>
): TermInfo & { targetBinding: FinalForbidPattern["targetBinding"] } {
  if (!pattern.target) {
    return {
      name: pattern.name,
      targetBinding: "omitted"
    };
  }
  const targetName = pattern.target.name;
  if (genericTargets.has(targetName)) {
    return {
      name: pattern.name,
      target: targetName,
      targetBinding: "generic"
    };
  }
  const result = resolveDeclReference(targetName, "resource", context, model);
  if (result.kind === "ambiguous") {
    model.diagnostics.push({
      kind: "ambiguous_name",
      nameKind: "resource",
      name: targetName,
      matches: result.matches,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(provenance(context.filePath, `resource reference ${targetName}`))
      ]
    });
  }
  return {
    name: pattern.name,
    target: result.name,
    targetBinding: result.kind === "ambiguous" ? "ambiguous" : "concrete"
  };
}

export function lowerSourceRef(source: { ref: SourceRef }): SourceRefInfo {
  return {
    language: source.ref.language,
    path: unquoteShapeString(source.ref.path)
  };
}

export function lowerFingerprint(
  fingerprint: FingerprintDecl,
  filePath: string | undefined,
  owner: string
): FingerprintInfo {
  return {
    provider: fingerprint.provider,
    value: unquoteShapeString(fingerprint.value),
    provenance: provenance(filePath, `${owner} fingerprint ${fingerprint.provider}`)
  };
}

export function lowerTargetRef(
  target: TargetRef,
  context: LoweringContext,
  model: Model
): ShapeTarget {
  return resolveTargetName(
    {
      kind: target.kind,
      name: target.name
    },
    context,
    model
  );
}

export function emitFunctionFacts(fn: FunctionInfo, model: Model): void {
  model.facts.push({
    kind: "function",
    component: fn.component,
    name: fn.name,
    provenance: fn.provenance
  });
  for (const [trait, traitProvenance] of fn.shapeTraits) {
    model.facts.push({
      kind: "shape_trait",
      targetKind: "fn",
      target: functionKey(fn.component, fn.name),
      trait,
      provenance: traitProvenance
    });
  }
  if (fn.description) {
    model.facts.push({
      kind: "description",
      targetKind: "fn",
      target: functionKey(fn.component, fn.name),
      required: fn.description.required,
      summary: fn.description.summary,
      provenance: fn.description.provenance
    });
  }
  if (fn.effects.kind === "unknown") {
    model.facts.push({
      kind: "effect_unknown",
      component: fn.component,
      functionName: fn.name,
      provenance: fn.provenance
    });
    return;
  }

  for (const entry of fn.effects.entries) {
    model.facts.push({
      kind: "effect",
      component: fn.component,
      functionName: fn.name,
      effect: entry.term.name,
      target: entry.term.target ?? "",
      provenance: entry.provenance
    });
  }
}

export function removeFunctionFacts(model: Model, component: string, functionName: string): void {
  const target = functionKey(component, functionName);
  model.facts = model.facts.filter((fact) => {
    if (fact.kind === "function") {
      return fact.component !== component || fact.name !== functionName;
    }
    if (fact.kind === "effect" || fact.kind === "effect_unknown") {
      return fact.component !== component || fact.functionName !== functionName;
    }
    if (
      fact.kind === "shape_trait" ||
      fact.kind === "description" ||
      fact.kind === "context_required"
    ) {
      return fact.targetKind !== "fn" || fact.target !== target;
    }
    return true;
  });
}

export function emitDerivedFacts(model: Model): void {
  for (const trait of model.traits.values()) {
    for (const forbid of trait.finalForbids) {
      model.facts.push({
        kind: "trait_final_forbid",
        trait: trait.name,
        effect: forbid.effect,
        target: forbid.target ?? "",
        provenance: forbid.provenance
      });
    }
  }

  for (const bearer of shapeTraitBearers(model)) {
    for (const requirement of requirementsForTarget(model, bearer.kind, bearer.traits)) {
      model.facts.push({
        kind: "context_required",
        targetKind: bearer.kind,
        target: bearer.target.name,
        contextType: requirement.contextType,
        requiredBy: requirement.trait,
        provenance: bearer.traits.get(requirement.trait) ?? bearer.fallback
      });
    }
  }
}

export function collectShapeUpdatePathsFromFunction(fn: FunctionInfo, model: Model): void {
  if (shouldIgnoreFunctionForCoverage(fn)) {
    return;
  }

  if (fn.source) {
    addShapeUpdatePath(model, fn.source.path, fn.provenance);
    model.facts.push({
      kind: "shape_update_for",
      path: normalizeShapeSourcePath(fn.source.path),
      provenance: fn.provenance
    });
  }

  if (fn.effects.kind === "complete") {
    for (const entry of fn.effects.entries) {
      if (entry.evidence) {
        const path = normalizeShapeSourcePath(entry.evidence.path);
        addShapeUpdatePath(model, path, entry.provenance);
        model.facts.push({ kind: "shape_update_for", path, provenance: entry.provenance });
      }
    }
  }
}

export function shouldIgnoreFunctionForCoverage(fn: FunctionInfo): boolean {
  return fn.generatedAstCandidate;
}

export function addShapeUpdatePath(model: Model, path: string, provenance: Provenance): void {
  const normalized = normalizeShapeSourcePath(path);
  const existing = model.shapeUpdatePaths.get(normalized);
  if (existing) {
    existing.push(provenance);
  } else {
    model.shapeUpdatePaths.set(normalized, [provenance]);
  }
}
