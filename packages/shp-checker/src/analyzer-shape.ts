import { normalizeStaticTarget } from "./analyzer-lexical.ts";
import type {
  AnalyzerEffect,
  AnalyzerHint,
  AnalyzerTargetIdentity,
  AnalyzerTargetSegment,
  AnalyzerWarning
} from "./analyzer-types.ts";
import type {
  AddFunctionChange,
  ModifyFunctionChange,
  ResourceDecl,
  ShapeModule
} from "./language/generated/ast.ts";
import {
  isAddDeclarationChange,
  isAddFunctionChange,
  isChangeDecl,
  isCompleteEffects,
  isComponentDecl,
  isFunctionSummary,
  isModifyDeclarationChange,
  isModifyFunctionChange,
  isResourceDecl,
  isStorageDecl
} from "./language/generated/ast.ts";
import {
  normalizeShapePath,
  normalizeShapeSourcePath,
  unquoteShapeString
} from "./shape-strings.ts";

type ResourceInfo = {
  moduleName?: string;
  name: string;
  aliases: string[];
};

type DeclaredEffect = {
  target?: string;
  resources: ResourceInfo[];
};

type DeclaredEffectsByScope = {
  pathOnly: Map<string, DeclaredEffect[]>;
  anchored: Map<string, Map<string, DeclaredEffect[]>>;
};

type DeclaredEffectsByPath = Map<string, DeclaredEffectsByScope>;

type ParsedSourceReference = {
  path: string;
  anchor?: string;
};

type DeclaredEffectSelection =
  | {
      kind: "declared";
      declared: DeclaredEffect[];
    }
  | {
      kind: "ambiguous";
      declared: DeclaredEffect[];
      declaredAnchors: string[];
    }
  | {
      kind: "missing";
    };

export function compareAnalyzerHintsToShape(
  hints: AnalyzerHint[],
  modules: ShapeModule[]
): AnalyzerWarning[] {
  const declaredEffectsByPath = collectDeclaredEffectsBySourcePath(modules);
  const warnings: AnalyzerWarning[] = [];

  for (const hint of hints) {
    const declaredEffects = declaredEffectsByPath.get(normalizeShapePath(hint.sourcePath));
    const selection = selectDeclaredEffects(declaredEffects, hint);
    if (selection.kind === "missing") {
      warnings.push({
        kind: "missing_declared_effect",
        hint
      });
      continue;
    }
    if (selection.kind === "ambiguous") {
      warnings.push({
        kind: "ambiguous_source_attribution",
        hint,
        declaredAnchors: selection.declaredAnchors,
        declaredTargets: declaredTargets(selection.declared)
      });
      continue;
    }

    const suspectedTarget = hint.target;
    if (
      suspectedTarget !== undefined &&
      !selection.declared.some((effect) => declaredEffectMatchesHint(effect, hint))
    ) {
      warnings.push({
        kind: "target_mismatch",
        hint,
        suspectedTarget,
        declaredTargets: declaredTargets(selection.declared)
      });
    }
  }

  return warnings;
}

export function formatAnalyzerWarnings(warnings: AnalyzerWarning[]): string {
  if (warnings.length === 0) {
    return "Shape analyzer found no mismatches.\n";
  }

  return `${warnings.map(formatAnalyzerWarning).join("\n\n")}\n`;
}

function selectDeclaredEffects(
  scope: DeclaredEffectsByScope | undefined,
  hint: AnalyzerHint
): DeclaredEffectSelection {
  if (!scope) {
    return { kind: "missing" };
  }

  if (hint.sourceAnchor !== undefined) {
    const exactScope = scope.anchored.get(hint.sourceAnchor);
    if (exactScope !== undefined) {
      const exact = exactScope.get(hint.effect);
      return exact === undefined ? { kind: "missing" } : { kind: "declared", declared: exact };
    }
  }

  const pathOnly = scope.pathOnly.get(hint.effect);
  const anchored = declaredEffectsForAnchors(scope, hint.effect);
  if (pathOnly !== undefined) {
    if (hint.target !== undefined && anchored.length > 0) {
      return {
        kind: "ambiguous",
        declared: [...pathOnly, ...anchored.flatMap((entry) => entry.declared)],
        declaredAnchors: anchored.map((entry) => entry.anchor).sort()
      };
    }
    return { kind: "declared", declared: pathOnly };
  }

  if (hint.sourceAnchor === undefined && anchored.length === 1) {
    return { kind: "declared", declared: anchored[0]?.declared ?? [] };
  }

  if (anchored.length > 0) {
    return {
      kind: "ambiguous",
      declared: anchored.flatMap((entry) => entry.declared),
      declaredAnchors: anchored.map((entry) => entry.anchor).sort()
    };
  }

  return { kind: "missing" };
}

function declaredEffectsForAnchors(
  scope: DeclaredEffectsByScope,
  effect: AnalyzerEffect
): { anchor: string; declared: DeclaredEffect[] }[] {
  const declared: { anchor: string; declared: DeclaredEffect[] }[] = [];
  for (const [anchor, effects] of scope.anchored) {
    const entries = effects.get(effect);
    if (entries !== undefined) {
      declared.push({ anchor, declared: entries });
    }
  }
  return declared;
}

function declaredTargets(declared: DeclaredEffect[]): string[] {
  return [
    ...new Set(declared.flatMap((effect) => (effect.target === undefined ? [] : [effect.target])))
  ].sort();
}

function declaredEffectMatchesHint(effect: DeclaredEffect, hint: AnalyzerHint): boolean {
  if (hint.target === undefined) {
    return true;
  }
  const identity: AnalyzerTargetIdentity = hint.targetIdentity ?? {
    kind: "orm",
    value: hint.target
  };
  return effect.resources.some((resource) => analyzerTargetMatchesResource(identity, resource));
}

function analyzerTargetMatchesResource(
  identity: AnalyzerTargetIdentity,
  resource: ResourceInfo
): boolean {
  const names = [resource.name, ...resource.aliases];
  if (identity.kind === "sql") {
    return names.some((name) => sqlTargetMatchesName(identity.segments, name));
  }
  const targetKey = ormTargetKey(identity.value);
  return targetKey !== undefined && names.some((name) => ormTargetKey(name) === targetKey);
}

function sqlTargetMatchesName(segments: AnalyzerTargetSegment[], name: string): boolean {
  const declaredSegments = name.split(".");
  return (
    declaredSegments.length === segments.length &&
    segments.every((segment, index) => {
      const declared = declaredSegments[index];
      return (
        declared !== undefined &&
        (segment.quoted
          ? segment.value === declared
          : segment.value.toLowerCase() === declared.toLowerCase())
      );
    })
  );
}

function ormTargetKey(target: string): string | undefined {
  const normalized = normalizeStaticTarget(target);
  return normalized?.toLowerCase().replaceAll("_", "");
}

function formatAnalyzerWarning(warning: AnalyzerWarning): string {
  const lines = [
    warning.kind === "missing_declared_effect"
      ? "warning: analyzer hint missing from shape effects"
      : warning.kind === "target_mismatch"
        ? "warning: analyzer hint target does not match shape effects"
        : "warning: analyzer hint could not be attributed to a shape function",
    "",
    `${warning.hint.sourcePath}:${warning.hint.line} suggests ${warning.hint.effect}.`
  ];
  if (warning.kind === "target_mismatch") {
    lines.push(`suspected target: ${warning.suspectedTarget}`);
    lines.push(
      `declared targets: ${
        warning.declaredTargets.length === 0 ? "(none)" : warning.declaredTargets.join(", ")
      }`
    );
  } else if (warning.kind === "ambiguous_source_attribution") {
    lines.push(`declared anchors: ${warning.declaredAnchors.join(", ")}`);
    if (warning.hint.target !== undefined) {
      lines.push(`suspected target: ${warning.hint.target}`);
    }
    lines.push(
      `declared targets: ${
        warning.declaredTargets.length === 0 ? "(none)" : warning.declaredTargets.join(", ")
      }`
    );
  } else if (warning.hint.target !== undefined) {
    lines.push(`suspected target: ${warning.hint.target}`);
  }
  lines.push(`evidence: ${warning.hint.evidence}`);
  return lines.join("\n");
}

function collectDeclaredEffectsBySourcePath(modules: ShapeModule[]): DeclaredEffectsByPath {
  const effects: DeclaredEffectsByPath = new Map();
  const resources = collectResourceInfos(modules);

  for (const module of modules) {
    for (const declaration of module.declarations) {
      if (isComponentDecl(declaration)) {
        for (const member of declaration.members) {
          if (isFunctionSummary(member)) {
            collectFunctionEffects(member, effects, module, resources);
          }
        }
      } else if (isChangeDecl(declaration)) {
        for (const entry of declaration.entries) {
          if (isAddFunctionChange(entry) || isModifyFunctionChange(entry)) {
            collectFunctionEffects(entry, effects, module, resources);
          }
        }
      }
    }
  }

  return effects;
}

function collectFunctionEffects(
  fn:
    | AddFunctionChange
    | ModifyFunctionChange
    | Extract<ShapeModule["declarations"][number], { $type: "ComponentDecl" }>["members"][number],
  effects: DeclaredEffectsByPath,
  module: ShapeModule,
  resources: ResourceInfo[]
): void {
  const sourceReference =
    "source" in fn && fn.source
      ? parseSourceReference(unquoteShapeString(fn.source.ref.path))
      : undefined;
  if (sourceReference !== undefined) {
    ensureDeclaredScope(effects, sourceReference);
  }

  if (!("effects" in fn) || !isCompleteEffects(fn.effects)) {
    return;
  }

  for (const entry of fn.effects.effects) {
    const references = new Map<string, ParsedSourceReference>();
    if (sourceReference) {
      references.set(sourceReferenceKey(sourceReference), sourceReference);
    }
    if (entry.evidence) {
      const evidenceReference = parseSourceReference(unquoteShapeString(entry.evidence.ref.path));
      const associatedReference =
        evidenceReference.path === sourceReference?.path &&
        evidenceReference.anchor === undefined &&
        sourceReference.anchor !== undefined
          ? sourceReference
          : evidenceReference;
      references.set(sourceReferenceKey(associatedReference), associatedReference);
    }

    for (const reference of references.values()) {
      const declaredByEffect = ensureDeclaredScope(effects, reference);
      const declared = declaredByEffect.get(entry.term.name) ?? [];
      const target = entry.term.target?.name;
      let existing = declared.find((effect) => effect.target === target);
      if (!existing) {
        existing = {
          ...(target === undefined ? {} : { target }),
          resources: target === undefined ? [] : resolveDeclaredResources(target, module, resources)
        };
        declared.push(existing);
      }
      declaredByEffect.set(entry.term.name, declared);
    }
  }
}

function parseSourceReference(sourceReference: string): ParsedSourceReference {
  const anchorStart = sourceReference.indexOf("#");
  const path = anchorStart < 0 ? sourceReference : sourceReference.slice(0, anchorStart);
  const anchor =
    anchorStart < 0 ? undefined : normalizeStaticTarget(sourceReference.slice(anchorStart + 1));
  return {
    path: normalizeShapeSourcePath(path),
    ...(anchor === undefined ? {} : { anchor })
  };
}

function sourceReferenceKey(reference: ParsedSourceReference): string {
  return `${reference.path}#${reference.anchor ?? ""}`;
}

function ensureDeclaredScope(
  effects: DeclaredEffectsByPath,
  reference: ParsedSourceReference
): Map<string, DeclaredEffect[]> {
  const scope = effects.get(reference.path) ?? {
    pathOnly: new Map<string, DeclaredEffect[]>(),
    anchored: new Map<string, Map<string, DeclaredEffect[]>>()
  };
  effects.set(reference.path, scope);
  if (reference.anchor === undefined) {
    return scope.pathOnly;
  }
  const anchored = scope.anchored.get(reference.anchor) ?? new Map<string, DeclaredEffect[]>();
  scope.anchored.set(reference.anchor, anchored);
  return anchored;
}

function collectResourceInfos(modules: ShapeModule[]): ResourceInfo[] {
  const resources: ResourceInfo[] = [];

  for (const module of modules) {
    for (const declaration of module.declarations) {
      if (isResourceDecl(declaration)) {
        resources.push(resourceInfo(module, declaration));
      } else if (isChangeDecl(declaration)) {
        for (const entry of declaration.entries) {
          if (
            (isAddDeclarationChange(entry) || isModifyDeclarationChange(entry)) &&
            isResourceDecl(entry.declaration)
          ) {
            resources.push(resourceInfo(module, entry.declaration));
          }
        }
      }
    }
  }

  return resources;
}

function resourceInfo(module: ShapeModule, resource: ResourceDecl): ResourceInfo {
  const aliases: string[] = [];
  for (const member of resource.body?.members ?? []) {
    if (isStorageDecl(member)) {
      aliases.push(unquoteShapeString(member.value));
    }
  }
  return {
    ...(module.name === undefined ? {} : { moduleName: module.name }),
    name: resource.name,
    aliases
  };
}

function resolveDeclaredResources(
  declaredTarget: string,
  module: ShapeModule,
  resources: ResourceInfo[]
): ResourceInfo[] {
  const separator = declaredTarget.lastIndexOf("::");
  if (separator >= 0) {
    const moduleName = declaredTarget.slice(0, separator);
    const resourceName = declaredTarget.slice(separator + 2);
    return resources.filter(
      (resource) => resource.moduleName === moduleName && resource.name === resourceName
    );
  }

  const local = resources.filter(
    (resource) => resource.moduleName === module.name && resource.name === declaredTarget
  );
  if (local.length > 0) {
    return local;
  }

  const importedModules = new Set(module.imports.map((entry) => entry.path));
  return resources.filter(
    (resource) =>
      resource.moduleName !== undefined &&
      importedModules.has(resource.moduleName) &&
      resource.name === declaredTarget
  );
}
