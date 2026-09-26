import * as ast from "../../language/generated/ast.ts";
import type { ContextObjectInfo, LoweringContext, Model, ReevaluationInfo } from "../model.ts";
import type { ContextKind } from "../../prelude.ts";
import { declKey } from "../display.ts";
import { requiresReevaluation } from "../derivations.ts";
import { duplicateDeclaration, provenance } from "../provenance.ts";
import { resolveDeclName, resolveDeclReference, resolveTargetName } from "../symbols.ts";
import { unquoteShapeString } from "../../shape-strings.ts";
import { lowerSourceRef } from "./declarations.ts";

export function lowerContextObject(
  declaration: ast.RationaleDecl | ast.MemoryDecl,
  context: LoweringContext,
  model: Model
): void {
  const kind = declaration.$type === "RationaleDecl" ? "rationale" : "memory";
  const entries = kind === "rationale" ? model.rationales : model.memories;
  const name = declKey(context.name, declaration.name);
  const prov = provenance(context.filePath, `${kind} ${name}`);
  const existing = entries.get(name);
  if (existing) {
    model.diagnostics.push(duplicateDeclaration(kind, name, existing.provenance, prov));
    return;
  }

  const info: ContextObjectInfo = {
    name,
    contextType: declaration.contextType.name,
    target: resolveTargetName(declaration.contextType.target, context, model),
    sensitive: false,
    protects: [],
    guards: [],
    forbiddenTransforms: [],
    observed: [],
    evidence: [],
    provenance: prov
  };

  for (const member of declaration.members) {
    if (ast.isAppliesToDecl(member)) {
      info.appliesTo = resolveTargetName(member.target, context, model);
    } else if (ast.isSummaryDecl(member)) {
      info.summary = unquoteShapeString(member.value);
    } else if (ast.isEvidenceLineDecl(member)) {
      info.evidence.push(lowerSourceRef(member));
    } else if (ast.isProtectsBlock(member)) {
      for (const entry of member.entries) {
        pushProtects(info, kind, entry.kind, entry.value, context, model);
      }
    } else if (ast.isGuardsBlock(member)) {
      for (const entry of member.entries) {
        pushGuard(info, kind, entry, context);
      }
    } else if (ast.isWhoBlock(member)) {
      if (member.owner) {
        info.owner = member.owner.value;
      }
    } else if (ast.isWhenBlock(member)) {
      if (member.date) {
        info.reviewBy = unquoteShapeString(member.date.value);
      }
    } else if (kind === "memory") {
      if (ast.isStatusDecl(member)) {
        info.status = member.value;
      } else if (ast.isConfidenceDecl(member)) {
        info.confidence = member.value;
      } else if (ast.isObservedDecl(member)) {
        info.observed.push(lowerSourceRef(member));
      } else if (ast.isSensitiveDecl(member)) {
        info.sensitive = true;
      }
    }
  }

  entries.set(name, info);
  model.facts.push({
    kind,
    name,
    contextType: info.contextType,
    targetKind: info.target.kind,
    target: info.target.name,
    provenance: prov
  });
  emitGuardFacts(kind, info, model);
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
  action: ast.GuardRequireDecl | ast.GuardForbidTransformDecl,
  context: LoweringContext
): void {
  if (ast.isGuardForbidTransformDecl(action)) {
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
  reevaluation: ast.ReevaluationDecl,
  context: LoweringContext,
  model: Model
): void {
  const name = declKey(context.name, reevaluation.name);
  const prov = provenance(context.filePath, `reevaluation ${name}`);
  if (model.reevaluations.has(name)) {
    model.diagnostics.push(
      duplicateDeclaration("reevaluation", name, model.reevaluations.get(name)?.provenance, prov)
    );
    return;
  }

  const info: ReevaluationInfo = {
    name,
    evidence: [],
    provenance: prov
  };

  for (const member of reevaluation.members) {
    if (ast.isSatisfiesDecl(member)) {
      info.satisfiesKind = member.kind;
      info.satisfiesName = resolveDeclName(member.name, member.kind, context, model);
    } else if (ast.isOutcomeDecl(member)) {
      info.outcome = member.value;
    } else if (ast.isSummaryDecl(member)) {
      info.summary = unquoteShapeString(member.value);
    } else if (ast.isEvidenceLineDecl(member)) {
      info.evidence.push(lowerSourceRef(member));
    } else if (ast.isReviewerDecl(member)) {
      info.reviewer = member.value;
    } else if (ast.isApproverDecl(member)) {
      info.approver = member.value;
    } else if (ast.isDecidedOnDecl(member)) {
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

export function lowerRole(role: ast.RoleDecl, model: Model): void {
  model.roles.add(role.name);
}

export function lowerPolicy(policy: ast.PolicyDecl, model: Model): void {
  model.requiresApprover = policy.members.some(ast.isRequireApproverDecl) || model.requiresApprover;
}

export function emitGuardFacts(kind: ContextKind, info: ContextObjectInfo, model: Model): void {
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
