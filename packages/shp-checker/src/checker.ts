import type {
  ComponentDecl,
  EffectEntry,
  EffectTerm,
  FunctionSummary,
  GrantsDecl,
  ResourceDecl,
  ShapeModule,
  SourceRef
} from "./language/generated/ast.ts";
import {
  isCompleteEffects,
  isComponentDecl,
  isFunctionSummary,
  isGrantsDecl,
  isResourceDecl,
  isUnknownEffects
} from "./language/generated/ast.ts";
import { parseShapeModule, type ParseDiagnostic } from "./parser.ts";

const APPEND_ONLY = "AppendOnly";
const FINAL_FORBIDS_BY_TRAIT = new Map<string, ReadonlySet<string>>([
  [APPEND_ONLY, new Set(["HardDelete", "Truncate", "DropStorage"])]
]);

export type SemanticDiagnostic =
  | {
      kind: "final_forbidden_effect";
      component: string;
      functionName: string;
      effect: string;
      target: string;
      trait: string;
      evidence?: string;
      filePath?: string;
    }
  | {
      kind: "missing_grant";
      component: string;
      functionName: string;
      effect: string;
      target: string;
      filePath?: string;
    }
  | {
      kind: "unknown_effects";
      component: string;
      functionName: string;
      filePath?: string;
    };

export type ShapeDiagnostic = ParseDiagnostic | SemanticDiagnostic;

export type CheckResult = {
  ok: boolean;
  exitCode: 0 | 1 | 2;
  diagnostics: ShapeDiagnostic[];
};

type CheckModuleInput = {
  module: ShapeModule;
  filePath?: string;
};

type ResourceInfo = {
  declaration: ResourceDecl;
  traits: Set<string>;
};

type ComponentInfo = {
  declaration: ComponentDecl;
  grants: Set<string>;
};

export function checkShapeModules(modules: ShapeModule[] | CheckModuleInput[]): CheckResult {
  const inputs = normalizeModuleInputs(modules);
  const resources = new Map<string, ResourceInfo>();
  const components = new Map<string, ComponentInfo>();

  for (const input of inputs) {
    for (const declaration of input.module.declarations) {
      if (isResourceDecl(declaration)) {
        resources.set(declaration.name, {
          declaration,
          traits: new Set(declaration.traits.map((trait) => trait.name))
        });
      } else if (isComponentDecl(declaration)) {
        components.set(declaration.name, {
          declaration,
          grants: collectComponentGrants(declaration)
        });
      }
    }
  }

  const diagnostics: SemanticDiagnostic[] = [];

  for (const input of inputs) {
    for (const declaration of input.module.declarations) {
      if (!isComponentDecl(declaration)) {
        continue;
      }
      const component = components.get(declaration.name);
      if (!component) {
        continue;
      }
      for (const member of declaration.members) {
        if (isFunctionSummary(member)) {
          diagnostics.push(...checkFunction(member, declaration, component, resources, input.filePath));
        }
      }
    }
  }

  return {
    ok: diagnostics.length === 0,
    exitCode: diagnostics.length === 0 ? 0 : 1,
    diagnostics
  };
}

export async function checkShapeFiles(paths: string[]): Promise<CheckResult> {
  const parsedModules: CheckModuleInput[] = [];
  const parseDiagnostics: ParseDiagnostic[] = [];

  for (const filePath of paths) {
    try {
      const source = await Bun.file(filePath).text();
      const parsed = parseShapeModule(source, filePath);
      if (parsed.ok) {
        parsedModules.push({
          module: parsed.module,
          filePath
        });
      } else {
        parseDiagnostics.push(...parsed.diagnostics);
      }
    } catch (error) {
      parseDiagnostics.push({
        kind: "parse",
        filePath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (parseDiagnostics.length > 0) {
    return {
      ok: false,
      exitCode: 2,
      diagnostics: parseDiagnostics
    };
  }

  return checkShapeModules(parsedModules);
}

export function formatDiagnostics(result: CheckResult): string {
  if (result.diagnostics.length === 0) {
    return "Shape check passed.\n";
  }

  return `${result.diagnostics.map(formatDiagnostic).join("\n\n")}\n`;
}

function normalizeModuleInputs(modules: ShapeModule[] | CheckModuleInput[]): CheckModuleInput[] {
  return modules.map((input) => {
    if ("module" in input) {
      return input;
    }
    return { module: input };
  });
}

function collectComponentGrants(component: ComponentDecl): Set<string> {
  const grants = new Set<string>();
  for (const member of component.members) {
    if (isGrantsDecl(member)) {
      grants.add(termKey(member.term));
    }
  }
  return grants;
}

function checkFunction(
  fn: FunctionSummary,
  componentDecl: ComponentDecl,
  component: ComponentInfo,
  resources: Map<string, ResourceInfo>,
  filePath?: string
): SemanticDiagnostic[] {
  if (isUnknownEffects(fn.effects)) {
    return [
      {
        kind: "unknown_effects",
        component: componentDecl.name,
        functionName: fn.name,
        filePath
      }
    ];
  }

  if (!isCompleteEffects(fn.effects)) {
    return [];
  }

  const diagnostics: SemanticDiagnostic[] = [];
  for (const entry of fn.effects.effects) {
    const term = entry.term;
    const target = term.target?.name;
    if (!target) {
      continue;
    }

    const resource = resources.get(target);
    if (resource) {
      const finalForbidden = findFinalForbiddenTrait(term.name, resource);
      if (finalForbidden) {
        diagnostics.push({
          kind: "final_forbidden_effect",
          component: componentDecl.name,
          functionName: fn.name,
          effect: term.name,
          target,
          trait: finalForbidden,
          evidence: formatEvidence(entry),
          filePath
        });
        continue;
      }
    }

    if (!component.grants.has(termKey(term))) {
      diagnostics.push({
        kind: "missing_grant",
        component: componentDecl.name,
        functionName: fn.name,
        effect: term.name,
        target,
        filePath
      });
    }
  }

  return diagnostics;
}

function findFinalForbiddenTrait(effectName: string, resource: ResourceInfo): string | undefined {
  for (const trait of resource.traits) {
    const forbiddenEffects = FINAL_FORBIDS_BY_TRAIT.get(trait);
    if (forbiddenEffects?.has(effectName)) {
      return trait;
    }
  }
  return undefined;
}

function formatDiagnostic(diagnostic: ShapeDiagnostic): string {
  switch (diagnostic.kind) {
    case "parse":
      return formatParseDiagnostic(diagnostic);
    case "final_forbidden_effect":
      return formatFinalForbiddenDiagnostic(diagnostic);
    case "missing_grant":
      return formatMissingGrantDiagnostic(diagnostic);
    case "unknown_effects":
      return formatUnknownEffectsDiagnostic(diagnostic);
  }
}

function formatParseDiagnostic(diagnostic: ParseDiagnostic): string {
  const location = formatLocation(diagnostic.filePath, diagnostic.line, diagnostic.column);
  return `error: parse error\n\n${location} ${diagnostic.message}`;
}

function formatFinalForbiddenDiagnostic(diagnostic: Extract<SemanticDiagnostic, { kind: "final_forbidden_effect" }>): string {
  const evidence = diagnostic.evidence ? `\nevidence: ${diagnostic.evidence}` : "";
  return [
    "error: forbidden effect",
    "",
    `${diagnostic.component}.${diagnostic.functionName} emits ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
    `${diagnostic.target} has trait ${diagnostic.trait}.`,
    `${diagnostic.trait} forbids final ${formatTerm(diagnostic.effect, diagnostic.target)}.${evidence}`
  ].join("\n");
}

function formatMissingGrantDiagnostic(diagnostic: Extract<SemanticDiagnostic, { kind: "missing_grant" }>): string {
  return [
    "error: missing grant",
    "",
    `${diagnostic.component}.${diagnostic.functionName} emits ${formatTerm(diagnostic.effect, diagnostic.target)}.`,
    `${diagnostic.component} does not grant ${formatTerm(diagnostic.effect, diagnostic.target)}.`
  ].join("\n");
}

function formatUnknownEffectsDiagnostic(diagnostic: Extract<SemanticDiagnostic, { kind: "unknown_effects" }>): string {
  return [
    "error: unknown effects",
    "",
    `${diagnostic.component}.${diagnostic.functionName} declares effects unknown.`
  ].join("\n");
}

function formatLocation(filePath: string, line?: number, column?: number): string {
  if (line === undefined) {
    return `${filePath}:`;
  }
  if (column === undefined) {
    return `${filePath}:${line}:`;
  }
  return `${filePath}:${line}:${column}:`;
}

function formatEvidence(entry: EffectEntry): string | undefined {
  return entry.evidence ? formatSourceRef(entry.evidence.ref) : undefined;
}

function formatSourceRef(ref: SourceRef): string {
  return `${ref.language}("${unquote(ref.path)}")`;
}

function formatTerm(effect: string, target: string): string {
  return `${effect}<${target}>`;
}

function termKey(term: EffectTerm): string {
  return `${term.name}<${term.target?.name ?? ""}>`;
}

function unquote(value: string): string {
  const first = value.at(0);
  const last = value.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}
