// Module namespaces and name resolution: the checker's small binder/symbol
// layer. It indexes declarations per module and resolves authored references
// (declarations, relation endpoints, function targets, context objects) into
// module-qualified keys, recording ambiguous-name diagnostics on the model. It
// does not lower declarations or evaluate semantic rules.
import type { Declaration, ShapeModule } from "../language/generated/ast.ts";
import type {
  CheckModuleInput,
  CheckModuleOrigin,
  DeclarationIndex,
  DeclarationKind,
  LoweringContext,
  Model,
  ResolutionResult,
  ShapeTarget
} from "./model.ts";
import { resolveModuleReference } from "../module-resolution.ts";
import { KNOWN_PRELUDE_TRAITS } from "../prelude.ts";
import { functionKey, splitFunctionTarget, splitQualifiedName } from "./display.ts";
import { describeProvenance, provenance } from "./provenance.ts";
import {
  GENERATED_AST_DIR,
  isGeneratedAstModuleName,
  normalizeGeneratedAstPath
} from "../generated-ast-policy.ts";

export function emptyDeclarationIndex(): DeclarationIndex {
  return {
    resource: new Map(),
    component: new Map(),
    trait: new Map(),
    relation: new Map(),
    candidate_effect: new Map(),
    implementation: new Map(),
    binding: new Map(),
    rationale: new Map(),
    memory: new Map(),
    reevaluation: new Map(),
    rule: new Map()
  };
}

export function moduleContext(input: CheckModuleInput): LoweringContext {
  const name = input.module.name ?? "";
  return {
    name,
    imports: input.module.imports.map((item) => item.path),
    filePath: input.filePath,
    generatedAst: input.origin === "generated_ast"
  };
}

export function moduleOriginForShapeFile(
  module: ShapeModule,
  filePath: string,
  normalizationRoot: string
): CheckModuleOrigin {
  const moduleName = module.name ?? "";
  const path = normalizeGeneratedAstPath(filePath, normalizationRoot);
  return isGeneratedAstModuleName(moduleName) && path.startsWith(`${GENERATED_AST_DIR}/`)
    ? "generated_ast"
    : "authored";
}

export function indexModuleDeclarations(
  module: ShapeModule,
  context: LoweringContext,
  model: Model
): void {
  for (const declaration of module.declarations) {
    if (declaration.$type === "AttestationDecl") {
      continue;
    }
    const kind = declarationKinds[declaration.$type];
    if (!kind) {
      continue;
    }
    const names = model.declarations[kind].get(context.name) ?? new Set<string>();
    names.add(declaration.name);
    model.declarations[kind].set(context.name, names);
  }
}

export const declarationKinds = {
  ResourceDecl: "resource",
  ComponentDecl: "component",
  TraitDecl: "trait",
  RelationDecl: "relation",
  CandidateEffectDecl: "candidate_effect",
  ImplementationDecl: "implementation",
  BindingDecl: "binding",
  RationaleDecl: "rationale",
  MemoryDecl: "memory",
  ReevaluationDecl: "reevaluation",
  RuleDecl: "rule",
  AttestationDecl: "attestation",
  ChangeDecl: undefined,
  RoleDecl: undefined,
  PolicyDecl: undefined
} as const satisfies Record<Declaration["$type"], DeclarationKind | "attestation" | undefined>;

function declaredLocally(
  model: Model,
  kind: DeclarationKind,
  moduleName: string,
  localName: string
): boolean {
  return model.declarations[kind].get(moduleName)?.has(localName) === true;
}

export function resolveDeclName(
  name: string,
  kind: DeclarationKind,
  context: LoweringContext,
  model: Model
): string {
  const result = resolveDeclReference(name, kind, context, model);
  if (result.kind === "ambiguous") {
    model.diagnostics.push({
      kind: "ambiguous_name",
      nameKind: kind,
      name,
      matches: result.matches,
      filePath: context.filePath,
      causedBy: [describeProvenance(provenance(context.filePath, `${kind} reference ${name}`))]
    });
  }
  return result.name;
}

export function resolveDeclReference(
  name: string,
  kind: DeclarationKind,
  context: LoweringContext,
  model: Model
): ResolutionResult {
  const qualified = splitQualifiedName(name);
  if (
    qualified.moduleName === undefined &&
    kind === "trait" &&
    KNOWN_PRELUDE_TRAITS.has(name) &&
    !declaredLocally(model, kind, context.name, name)
  ) {
    return { kind: "resolved", name };
  }
  return resolveModuleReference(
    name,
    { moduleName: context.name, imports: context.imports },
    (moduleName, localName) => declaredLocally(model, kind, moduleName ?? "", localName)
  );
}

export function resolveVertexName(name: string, context: LoweringContext, model: Model): string {
  const result = resolveVertexReference(name, context, model);
  if (result.kind === "ambiguous") {
    model.diagnostics.push({
      kind: "ambiguous_name",
      nameKind: "relation_endpoint",
      name,
      matches: result.matches,
      filePath: context.filePath,
      causedBy: [
        describeProvenance(provenance(context.filePath, `relation endpoint reference ${name}`))
      ]
    });
  }
  return result.name;
}

export function resolveVertexReference(
  name: string,
  context: LoweringContext,
  model: Model
): ResolutionResult {
  return resolveModuleReference(
    name,
    { moduleName: context.name, imports: [...new Set(context.imports)] },
    (moduleName, localName) =>
      declaredLocally(model, "component", moduleName ?? "", localName) ||
      declaredLocally(model, "resource", moduleName ?? "", localName)
  );
}

export function resolveTargetName(
  target: ShapeTarget,
  context: LoweringContext,
  model: Model
): ShapeTarget {
  if (target.kind === "fn") {
    return { kind: target.kind, name: resolveFunctionTargetName(target.name, context, model) };
  }
  return {
    kind: target.kind,
    name: resolveDeclName(target.name, target.kind, context, model)
  };
}

export function resolveFunctionTargetName(
  value: string,
  context: LoweringContext,
  model: Model
): string {
  const [componentName, functionName] = splitFunctionTarget(value);
  if (!componentName || !functionName) {
    return value;
  }
  return functionKey(resolveDeclName(componentName, "component", context, model), functionName);
}
