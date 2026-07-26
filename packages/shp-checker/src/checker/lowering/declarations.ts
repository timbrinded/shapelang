import type {
  AttestationDecl,
  BindingDecl,
  CandidateEffectDecl,
  ComponentDecl,
  DescriptionDecl,
  EffectEntry,
  EffectPattern,
  EffectsDecl,
  EffectTerm,
  FingerprintDecl,
  ImplementationDecl,
  ResourceDecl,
  RuleDecl,
  RuleForbidEffectDecl,
  RuleForbidHypercycleDecl,
  RuleForbidProvidesDecl,
  SourceRef,
  TargetKind,
  TargetRef,
  TraitDecl,
  TraitForbidDecl
} from "../../language/generated/ast.ts";
import {
  isBindingAllowAttestDecl,
  isBindingRequireChangedDecl,
  isBindingWhenChangedDecl,
  isCandidateEffectAnchorDecl,
  isCandidateEffectConfidenceDecl,
  isCandidateEffectFunctionDecl,
  isCandidateEffectTermDecl,
  isCompleteEffects,
  isConformsToDecl,
  isExpiresDecl,
  isFingerprintDecl,
  isFunctionRequiresDecl,
  isFunctionSummary,
  isGrantsDecl,
  isOnChangeDecl,
  isOwnsDecl,
  isPathsBlock,
  isRequireContextDecl,
  isRuleForbidEffectDecl,
  isRuleForbidHypercycleDecl,
  isRuleForbidProvidesDecl,
  isRuleWhenHasDecl,
  isTraitForbidDecl,
  isUnknownEffects,
  isReasonDecl
} from "../../language/generated/ast.ts";
import type {
  BindingInfo,
  CandidateEffectInfo,
  ComponentInfo,
  DescriptionInfo,
  EffectEntryInfo,
  EffectSummaryInfo,
  FinalForbidPattern,
  FingerprintInfo,
  FunctionAst,
  FunctionInfo,
  ImplementationInfo,
  LoweringContext,
  Model,
  Provenance,
  RuleInfo,
  ShapeTarget,
  SourceRefInfo,
  TermInfo,
  TraitContextRequirement
} from "../model.ts";
import type { ContextKind } from "../../prelude.ts";
import { isPreludeTrait } from "../prelude-seed.ts";
import { declKey, formatTerm, splitFunctionTarget, termKey } from "../display.ts";
import { describeProvenance, provenance } from "../provenance.ts";
import {
  resolveDeclName,
  resolveDeclReference,
  resolveFunctionTargetName,
  resolveTargetName
} from "../symbols.ts";
import { normalizeShapeSourcePath, unquoteShapeString } from "../../shape-strings.ts";
import { emitFunctionFacts } from "./facts.ts";

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

  const typeParams =
    trait.typeParams?.params.map((param) => ({
      name: param.name,
      ...(param.bound === undefined ? {} : { bound: param.bound })
    })) ?? [];
  const typeParamNames = new Set(typeParams.map((param) => param.name));
  const finalForbids: FinalForbidPattern[] = [];
  const contextRequirements: TraitContextRequirement[] = [];
  for (const member of trait.members) {
    if (isTraitForbidDecl(member)) {
      finalForbids.push(
        lowerForbidPattern(member, context, model, `trait ${name}`, typeParamNames)
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
      const traitResolution = resolveDeclReference(member.trait, "trait", context, model);
      const whenProvenance = provenance(
        context.filePath,
        `rule ${name} when ${member.subject} has ${traitResolution.name}`
      );
      if (traitResolution.kind === "ambiguous") {
        model.diagnostics.push({
          kind: "ambiguous_name",
          nameKind: "trait",
          name: member.trait,
          matches: traitResolution.matches,
          filePath: context.filePath,
          causedBy: [describeProvenance(whenProvenance)]
        });
      }
      info.whenHas.push({
        subject: member.subject,
        trait: traitResolution.name,
        traitResolution: traitResolution.kind,
        provenance: whenProvenance
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
