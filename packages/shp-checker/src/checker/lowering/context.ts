import type {
  GuardForbidTransformDecl,
  GuardRequireDecl,
  MemoryDecl,
  MemoryMember,
  PolicyDecl,
  RationaleDecl,
  RationaleMember,
  ReevaluationDecl,
  RoleDecl
} from "../../language/generated/ast.ts";
import {
  isAppliesToDecl,
  isApproverDecl,
  isConfidenceDecl,
  isDecidedOnDecl,
  isEvidenceLineDecl,
  isGuardForbidTransformDecl,
  isGuardsBlock,
  isObservedDecl,
  isOutcomeDecl,
  isProtectsBlock,
  isRequireApproverDecl,
  isReviewerDecl,
  isSatisfiesDecl,
  isSensitiveDecl,
  isStatusDecl,
  isSummaryDecl,
  isWhenBlock,
  isWhoBlock,
  isWhyDecl
} from "../../language/generated/ast.ts";
import type {
  ContextObjectInfo,
  LoweringContext,
  MemoryInfo,
  Model,
  RationaleInfo,
  ReevaluationInfo
} from "../model.ts";
import type { ContextKind } from "../../prelude.ts";
import { declKey } from "../display.ts";
import { requiresReevaluation } from "../derivations.ts";
import { describeProvenance, provenance } from "../provenance.ts";
import { resolveContextObjectName, resolveDeclReference } from "../symbols.ts";
import { unquoteShapeString } from "../../shape-strings.ts";
import { lowerSourceRef, lowerTargetRef } from "./declarations.ts";

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
