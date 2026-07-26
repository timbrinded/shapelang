// Module namespaces and name resolution: the checker's small binder/symbol
// layer. It indexes declarations per module and resolves authored references
// (declarations, relation endpoints, function targets, context objects) into
// module-qualified keys, recording ambiguous-name diagnostics on the model. It
// does not lower declarations or evaluate semantic rules.
import type { ShapeModule } from "../language/generated/ast.ts";
import {
  isAttestationDecl,
  isBindingDecl,
  isCandidateEffectDecl,
  isChangeDecl,
  isComponentDecl,
  isImplementationDecl,
  isMemoryDecl,
  isRationaleDecl,
  isReevaluationDecl,
  isRelationDecl,
  isResourceDecl,
  isRuleDecl,
  isTraitDecl
} from "../language/generated/ast.ts";
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
import { KNOWN_PRELUDE_TRAITS, type ContextKind } from "../prelude.ts";
import { declKey, functionKey, splitFunctionTarget, splitQualifiedName } from "./display.ts";
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
    const kind = declarationIndexKind(declaration);
    if (!kind) {
      continue;
    }
    const names = model.declarations[kind].get(context.name) ?? new Set<string>();
    names.add(declarationNameForIndex(declaration));
    model.declarations[kind].set(context.name, names);
  }
}

function declarationNameForIndex(declaration: ShapeModule["declarations"][number]): string {
  if (isAttestationDecl(declaration)) {
    return declaration.kind;
  }
  if (isChangeDecl(declaration)) {
    return declaration.name;
  }
  return "name" in declaration ? declaration.name : "";
}

function declarationIndexKind(
  declaration: ShapeModule["declarations"][number]
): DeclarationKind | undefined {
  if (isResourceDecl(declaration)) {
    return "resource";
  }
  if (isComponentDecl(declaration)) {
    return "component";
  }
  if (isTraitDecl(declaration)) {
    return "trait";
  }
  if (isRelationDecl(declaration)) {
    return "relation";
  }
  if (isCandidateEffectDecl(declaration)) {
    return "candidate_effect";
  }
  if (isImplementationDecl(declaration)) {
    return "implementation";
  }
  if (isBindingDecl(declaration)) {
    return "binding";
  }
  if (isRationaleDecl(declaration)) {
    return "rationale";
  }
  if (isMemoryDecl(declaration)) {
    return "memory";
  }
  if (isReevaluationDecl(declaration)) {
    return "reevaluation";
  }
  if (isRuleDecl(declaration)) {
    return "rule";
  }
  return undefined;
}

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
  if (qualified.moduleName !== undefined) {
    return { kind: "resolved", name: declKey(qualified.moduleName, qualified.localName) };
  }
  if (
    kind === "trait" &&
    KNOWN_PRELUDE_TRAITS.has(name) &&
    !declaredLocally(model, kind, context.name, name)
  ) {
    return { kind: "resolved", name };
  }
  if (declaredLocally(model, kind, context.name, name)) {
    return { kind: "resolved", name: declKey(context.name, name) };
  }
  const importedMatches = context.imports
    .filter((moduleName) => declaredLocally(model, kind, moduleName, name))
    .map((moduleName) => declKey(moduleName, name))
    .sort();
  if (importedMatches.length > 1) {
    return { kind: "ambiguous", name: declKey(context.name, name), matches: importedMatches };
  }
  return importedMatches[0]
    ? { kind: "resolved", name: importedMatches[0] }
    : { kind: "unknown", name: declKey(context.name, name) };
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
  const qualified = splitQualifiedName(name);
  if (qualified.moduleName !== undefined) {
    return { kind: "resolved", name: declKey(qualified.moduleName, qualified.localName) };
  }
  if (
    declaredLocally(model, "component", context.name, name) ||
    declaredLocally(model, "resource", context.name, name)
  ) {
    return { kind: "resolved", name: declKey(context.name, name) };
  }
  const importedMatches = [
    ...new Set(
      context.imports
        .filter(
          (moduleName) =>
            declaredLocally(model, "component", moduleName, name) ||
            declaredLocally(model, "resource", moduleName, name)
        )
        .map((moduleName) => declKey(moduleName, name))
    )
  ].sort();
  if (importedMatches.length > 1) {
    return { kind: "ambiguous", name: declKey(context.name, name), matches: importedMatches };
  }
  return importedMatches[0]
    ? { kind: "resolved", name: importedMatches[0] }
    : { kind: "unknown", name: declKey(context.name, name) };
}

export function resolveTargetName(
  target: ShapeTarget,
  context: LoweringContext,
  model: Model
): ShapeTarget {
  if (target.kind === "fn") {
    return { kind: target.kind, name: resolveFunctionTargetName(target.name, context, model) };
  }
  const kind =
    target.kind === "relation"
      ? "relation"
      : target.kind === "implementation"
        ? "implementation"
        : target.kind === "rule"
          ? "rule"
          : target.kind;
  return {
    kind: target.kind,
    name: resolveDeclName(target.name, kind, context, model)
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

export function resolveContextObjectName(
  kind: ContextKind,
  name: string,
  context: LoweringContext,
  model: Model
): string {
  return resolveDeclName(name, kind, context, model);
}
