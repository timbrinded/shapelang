import type { Declaration } from "../../language/generated/ast.ts";
import type { LoweringContext, Model } from "../model.ts";
import {
  lowerAttestation,
  lowerBinding,
  lowerCandidateEffect,
  lowerComponent,
  lowerImplementation,
  lowerResource,
  lowerRule,
  lowerTrait
} from "./declarations.ts";
import { lowerContextObject, lowerPolicy, lowerReevaluation, lowerRole } from "./context.ts";
import { lowerRelation } from "./relations.ts";

export function lowerDeclaration(
  declaration: Exclude<Declaration, { $type: "ChangeDecl" }>,
  context: LoweringContext,
  model: Model
): void {
  switch (declaration.$type) {
    case "ResourceDecl":
      return lowerResource(declaration, context, model);
    case "TraitDecl":
      return lowerTrait(declaration, context, model);
    case "ComponentDecl":
      return lowerComponent(declaration, context, model);
    case "RelationDecl":
      return lowerRelation(declaration, context, model);
    case "CandidateEffectDecl":
      return lowerCandidateEffect(declaration, context, model);
    case "ImplementationDecl":
      return lowerImplementation(declaration, context, model);
    case "BindingDecl":
      return lowerBinding(declaration, context, model);
    case "AttestationDecl":
      return lowerAttestation(declaration, context, model);
    case "RuleDecl":
      return lowerRule(declaration, context, model);
    case "RationaleDecl":
    case "MemoryDecl":
      return lowerContextObject(declaration, context, model);
    case "ReevaluationDecl":
      return lowerReevaluation(declaration, context, model);
    case "RoleDecl":
      return lowerRole(declaration, model);
    case "PolicyDecl":
      return lowerPolicy(declaration, model);
  }
}
