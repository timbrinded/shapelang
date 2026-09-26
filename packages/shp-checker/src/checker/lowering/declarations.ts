import * as ast from "../../language/generated/ast.ts";
import type {
  BindingInfo,
  CandidateEffectInfo,
  ComponentInfo,
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
  SourceRefInfo,
  TermInfo,
  TraitContextRequirement
} from "../model.ts";
import type { ContextKind } from "../../prelude.ts";
import { isPreludeTrait } from "../prelude-seed.ts";
import { declKey, formatTerm, splitFunctionTarget, termKey } from "../display.ts";
import { describeProvenance, duplicateDeclaration, provenance } from "../provenance.ts";
import {
  resolveDeclName,
  resolveDeclReference,
  resolveFunctionTargetName,
  resolveVertexReference
} from "../symbols.ts";
import { normalizeShapeSourcePath, unquoteShapeString } from "../../shape-strings.ts";
import { emitFunctionFacts } from "./facts.ts";

const SUPPORTED_ON_CHANGE_REQUIREMENTS: ReadonlySet<string> = new Set(["shape_update"]);

export function lowerResource(
  resource: ast.ResourceDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, resource.name);
  const prov = provenance(context.filePath, `resource ${name}`);
  const existing = model.resources.get(name);
  if (existing) {
    model.diagnostics.push(duplicateDeclaration("resource", name, existing.provenance, prov));
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
    if (!ast.isFingerprintDecl(member)) {
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
    provenance: prov
  });
  model.facts.push({ kind: "resource", name, provenance: prov });
}

export function lowerTrait(trait: ast.TraitDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, trait.name);
  const prov = provenance(context.filePath, `trait ${name}`);
  const existing = model.traits.get(name);
  if (existing && !isPreludeTrait(existing)) {
    model.diagnostics.push(duplicateDeclaration("trait", name, existing.provenance, prov));
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
    if (ast.isTraitForbidDecl(member)) {
      finalForbids.push(
        lowerForbidPattern(member, context, model, `trait ${name}`, typeParamNames)
      );
    } else if (ast.isRequireContextDecl(member)) {
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
  trait: ast.TraitDecl,
  typeParamName: string
): { kind: ast.TargetKind } | { reason: string } {
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

// An absent `satisfied_by` clause accepts either context kind. The grammar
// (ContextObjectKind) already limits entries to memory|rationale, so the filter
// is defensive.

export function lowerSatisfiedByKinds(kinds: string[]): ContextKind[] {
  const allowed = kinds.filter(
    (kind): kind is ContextKind => kind === "rationale" || kind === "memory"
  );
  return allowed.length > 0 ? [...new Set(allowed)] : ["rationale", "memory"];
}

export function lowerComponent(
  component: ast.ComponentDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, component.name);
  const prov = provenance(context.filePath, `component ${name}`);
  const existing = model.components.get(name);
  if (existing) {
    model.diagnostics.push(duplicateDeclaration("component", name, existing.provenance, prov));
    return;
  }

  const info: ComponentInfo = {
    name,
    classifiers: new Map(),
    grants: new Map(),
    owns: new Map(),
    functions: new Map(),
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
    if (ast.isOwnsDecl(member)) {
      const resourceName = resolveDeclName(member.resource.name, "resource", context, model);
      const memberProv = provenance(context.filePath, `component ${name} owns ${resourceName}`);
      info.owns.set(resourceName, memberProv);
      model.facts.push({
        kind: "owns",
        component: name,
        resource: resourceName,
        provenance: memberProv
      });
    } else if (ast.isGrantsDecl(member)) {
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
    } else if (ast.isFunctionSummary(member)) {
      const fn = lowerFunction(member, name, context, model);
      info.functions.set(fn.name, fn);
      emitFunctionFacts(fn, model);
    }
  }

  model.components.set(name, info);
  model.facts.push({ kind: "component", name, provenance: prov });
}

const CANDIDATE_EFFECT_FIELDS = {
  CandidateEffectFunctionDecl: "fn",
  CandidateEffectTermDecl: "effect",
  SourceDecl: "source",
  CandidateEffectConfidenceDecl: "confidence",
  CandidateEffectAnchorDecl: "pin"
} satisfies Record<ast.CandidateEffectMember["$type"], string>;

export function lowerCandidateEffect(
  candidateEffect: ast.CandidateEffectDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, candidateEffect.name);
  const prov = provenance(context.filePath, `effect candidate ${name}`);
  if (model.candidateEffects.has(name)) {
    model.diagnostics.push(
      duplicateDeclaration(
        "candidate_effect",
        name,
        model.candidateEffects.get(name)?.provenance,
        prov
      )
    );
    return;
  }

  const info: CandidateEffectInfo = {
    kind: "candidate_effect",
    name,
    functionTarget: "",
    effect: "",
    target: "",
    source: undefined,
    confidence: undefined,
    anchor: undefined,
    fingerprintProvider: undefined,
    fingerprintValue: undefined,
    provenance: prov
  };
  const seen = new Set<string>();
  for (const member of candidateEffect.members) {
    const field = CANDIDATE_EFFECT_FIELDS[member.$type];
    if (seen.has(field)) {
      pushInvalidCandidateEffect(model, name, `duplicate ${field}`, context.filePath, prov);
      continue;
    }
    seen.add(field);
    if (ast.isCandidateEffectFunctionDecl(member)) {
      info.functionTarget = resolveFunctionTargetName(member.function, context, model);
    } else if (ast.isCandidateEffectTermDecl(member)) {
      const term = lowerTerm(member.term, context, model);
      info.effect = term.name ?? "";
      info.target = term.target ?? "";
    } else if (ast.isCandidateEffectConfidenceDecl(member)) {
      info.confidence = member.value;
    } else if (ast.isCandidateEffectAnchorDecl(member)) {
      info.anchor = resolveDeclName(member.target.name, "resource", context, model);
      info.fingerprintProvider = member.provider;
      info.fingerprintValue = unquoteShapeString(member.value);
    } else {
      info.source = lowerSourceRef(member);
    }
  }

  for (const field of Object.values(CANDIDATE_EFFECT_FIELDS)) {
    if (!seen.has(field)) {
      pushInvalidCandidateEffect(model, name, `missing ${field}`, context.filePath, prov);
    }
  }

  model.candidateEffects.set(name, info);
  model.facts.push(info);
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
  implementation: ast.ImplementationDecl,
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
    if (ast.isPathsBlock(member)) {
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
    } else if (ast.isConformsToDecl(member)) {
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
    } else if (ast.isOnChangeDecl(member)) {
      // Coverage only acts on known requirements, so an unknown value would
      // silently leave the implementation's paths ungoverned.
      if (SUPPORTED_ON_CHANGE_REQUIREMENTS.has(member.requirement)) {
        info.onChangeRequirement = member.requirement;
      } else {
        const onChangeProv = provenance(
          context.filePath,
          `implementation ${name} on_change require ${member.requirement}`
        );
        model.diagnostics.push({
          kind: "invalid_implementation",
          name,
          reason: `on_change require ${member.requirement} is not a supported requirement; expected ${[...SUPPORTED_ON_CHANGE_REQUIREMENTS].join(", ")}`,
          filePath: context.filePath,
          causedBy: [describeProvenance(onChangeProv)]
        });
      }
    }
  }

  model.implementations.push(info);
  model.facts.push({ kind: "implementation", name, provenance: prov });
}

export function lowerBinding(
  binding: ast.BindingDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, binding.name);
  const prov = provenance(context.filePath, `binding ${name}`);
  if (model.bindings.has(name)) {
    model.diagnostics.push(
      duplicateDeclaration("binding", name, model.bindings.get(name)?.provenance, prov)
    );
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
    if (ast.isBindingWhenChangedDecl(member) || ast.isBindingRequireChangedDecl(member)) {
      const whenChanged = ast.isBindingWhenChangedDecl(member);
      const paths = whenChanged ? info.whenChanged : info.requireChanged;
      const clause = whenChanged ? "when_changed" : "require_changed";
      for (const path of member.body.paths) {
        const glob = unquoteShapeString(path);
        const pathProv = provenance(context.filePath, `binding ${name} ${clause} ${glob}`);
        paths.push({ glob, provenance: pathProv });
        model.facts.push({
          kind: whenChanged ? "binding_when_changed" : "binding_require_changed",
          binding: name,
          glob,
          provenance: pathProv
        });
      }
    } else if (ast.isBindingAllowAttestDecl(member)) {
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

/** The kind, normalized path, and reason that identify an attestation. */
export function attestationIdentity(attestation: ast.AttestationDecl) {
  return {
    kind: attestation.kind,
    path: normalizeShapeSourcePath(lowerSourceRef(attestation.source).path),
    reason: unquoteShapeString(attestation.reason.value)
  };
}

export function lowerAttestation(
  attestation: ast.AttestationDecl,
  context: LoweringContext,
  model: Model
): void {
  const { path, reason } = attestationIdentity(attestation);
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

export function lowerRule(rule: ast.RuleDecl, context: LoweringContext, model: Model): void {
  const name = declKey(context.name, rule.name);
  const finalForbidSubjects = new Set(
    rule.members.filter(ast.isRuleWhenHasDecl).map((member) => member.subject)
  );
  const hasFinalForbid = rule.members.some(
    (member) => ast.isRuleForbidEffectDecl(member) && member.final
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
    forbidPaths: [],
    provenance: provenance(context.filePath, `rule ${name}`)
  };

  for (const member of rule.members) {
    if (ast.isRuleWhenHasDecl(member)) {
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
    } else if (ast.isRuleForbidEffectDecl(member)) {
      info.forbidEffects.push(
        lowerForbidPattern(member, context, model, `rule ${name}`, finalForbidSubjects)
      );
    } else {
      lowerRuleGraphForbid(member, info, context, model);
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
  const label = `${labelContext ? `${labelContext} ` : ""}fn ${componentName}.${functionName}`;
  const effects = lowerEffects(fn.effects, componentName, functionName, loweringContext, model);
  const shapeTraits = new Map<string, Provenance>();
  for (const trait of fn.shapeTraits?.traits ?? []) {
    const traitName = resolveDeclName(trait.name, "trait", loweringContext, model);
    shapeTraits.set(traitName, provenance(loweringContext.filePath, `${label} : ${traitName}`));
  }
  const info: FunctionInfo = {
    component: componentName,
    name: functionName,
    source,
    unsafe: fn.unsafe,
    effects,
    requires: [],
    shapeTraits,
    description: fn.description
      ? {
          required: fn.description.required,
          summary: unquoteShapeString(fn.description.summary),
          provenance: provenance(loweringContext.filePath, `${label} description`)
        }
      : undefined,
    generatedAstCandidate: loweringContext.generatedAst,
    provenance: provenance(loweringContext.filePath, label)
  };

  for (const member of fn.members) {
    if (ast.isFunctionRequiresDecl(member)) {
      info.requires.push(lowerTerm(member.term, loweringContext, model));
    } else if (ast.isReasonDecl(member)) {
      info.reason = unquoteShapeString(member.value);
    } else if (ast.isExpiresDecl(member)) {
      info.expires = unquoteShapeString(member.value);
    }
  }

  return info;
}

export function functionNameForAst(fn: FunctionAst): string {
  if (ast.isFunctionSummary(fn)) {
    return fn.name;
  }
  const [, functionName] = splitFunctionTarget(fn.target);
  return functionName ?? fn.target;
}

export function lowerEffects(
  effects: ast.EffectsDecl,
  componentName: string,
  functionName: string,
  context: LoweringContext,
  model: Model
): EffectSummaryInfo {
  if (!ast.isCompleteEffects(effects)) {
    return { kind: "unknown" };
  }

  return {
    kind: "complete",
    entries: effects.effects.map((entry) => {
      const term = lowerTerm(entry.term, context, model);
      return {
        term,
        evidence: entry.evidence ? lowerSourceRef(entry.evidence) : undefined,
        provenance: provenance(
          context.filePath,
          `effect ${componentName}.${functionName} emits ${formatTerm(term.name, term.target ?? "")}`
        )
      };
    })
  };
}

export function lowerForbidPattern(
  member: ast.TraitForbidDecl | ast.RuleForbidEffectDecl,
  context: LoweringContext,
  model: Model,
  owner: string,
  genericTargets: Set<string>
): FinalForbidPattern {
  const pattern = member.pattern;
  let target: string | undefined;
  let targetBinding: FinalForbidPattern["targetBinding"] = "omitted";
  if (pattern.target) {
    target = pattern.target.name;
    targetBinding = "generic";
    if (!genericTargets.has(target)) {
      const result = resolveDeclReference(target, "resource", context, model);
      if (result.kind === "ambiguous") {
        model.diagnostics.push({
          kind: "ambiguous_name",
          nameKind: "resource",
          name: target,
          matches: result.matches,
          filePath: context.filePath,
          causedBy: [
            describeProvenance(provenance(context.filePath, `resource reference ${target}`))
          ]
        });
      }
      target = result.name;
      targetBinding = result.kind === "ambiguous" ? "ambiguous" : "concrete";
    }
  }
  const effect = pattern.name;
  return {
    effect,
    target,
    targetBinding,
    final: member.final,
    provenance: provenance(
      context.filePath,
      `${owner} forbids ${member.final ? "final " : ""}${formatTerm(effect, target ?? "")}`
    )
  };
}

function lowerRuleGraphForbid(
  member: ast.RuleForbidProvidesDecl | ast.RuleForbidHypercycleDecl | ast.RuleForbidPathDecl,
  info: RuleInfo,
  context: LoweringContext,
  model: Model
): void {
  if (ast.isRuleForbidProvidesDecl(member)) {
    const target = resolveDeclName(member.target.name, "resource", context, model);
    const except = member.except
      ? resolveDeclName(member.except, "component", context, model)
      : undefined;
    info.forbidProvides.push({
      target,
      except,
      provenance: provenance(context.filePath, `rule ${info.name} forbids provides ${target}`)
    });
  } else if (ast.isRuleForbidHypercycleDecl(member)) {
    info.forbidHypercycles.push({
      kinds: [...member.kinds],
      provenance: provenance(
        context.filePath,
        `rule ${info.name} forbids hypercycle${member.kinds.length > 0 ? ` over ${member.kinds.join(" or ")}` : ""}`
      )
    });
  } else if (ast.isRuleForbidPathDecl(member)) {
    const source = resolveVertexReference(member.source, context, model);
    const target = resolveVertexReference(member.target, context, model);
    const prov = provenance(
      context.filePath,
      `rule ${info.name} forbids path ${source.name} -> ${target.name} over ${member.kinds.join(" or ")}`
    );

    const reportedAmbiguousNames = new Set<string>();
    for (const [name, resolution] of [
      [member.source, source],
      [member.target, target]
    ] as const) {
      if (resolution.kind === "ambiguous" && !reportedAmbiguousNames.has(name)) {
        reportedAmbiguousNames.add(name);
        model.diagnostics.push({
          kind: "ambiguous_name",
          nameKind: "relation_endpoint",
          name,
          matches: resolution.matches,
          filePath: context.filePath,
          causedBy: [describeProvenance(prov)]
        });
      }
    }

    info.forbidPaths.push({
      source: source.name,
      sourceResolution: source.kind,
      target: target.name,
      targetResolution: target.kind,
      kinds: [...member.kinds],
      provenance: prov
    });
  }
}

export function lowerTerm(term: ast.EffectTerm, context: LoweringContext, model: Model): TermInfo {
  return {
    name: term.name,
    target: term.target ? resolveDeclName(term.target.name, "resource", context, model) : undefined
  };
}

export function lowerSourceRef(source: { ref: ast.SourceRef }): SourceRefInfo {
  return {
    language: source.ref.language,
    path: unquoteShapeString(source.ref.path)
  };
}

export function lowerFingerprint(
  fingerprint: ast.FingerprintDecl,
  filePath: string | undefined,
  owner: string
): FingerprintInfo {
  return {
    provider: fingerprint.provider,
    value: unquoteShapeString(fingerprint.value),
    provenance: provenance(filePath, `${owner} fingerprint ${fingerprint.provider}`)
  };
}
