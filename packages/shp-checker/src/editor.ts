import {
  checkShapeModules,
  explainShapeModules,
  formatDiagnostics,
  type ShapeDiagnostic
} from "./checker.ts";
import { formatShapeSource, type FormatResult } from "./formatter.ts";
import {
  isChangeDecl,
  isBindingDecl,
  isComponentDecl,
  type Declaration,
  isFunctionSummary,
  isMemoryDecl,
  isRationaleDecl,
  isReevaluationDecl,
  isRelationDecl,
  isResourceDecl,
  isRuleDecl,
  isTraitDecl
} from "./language/generated/ast.ts";
import { parseShapeModule } from "./parser.ts";
import {
  PRELUDE_COMPLETION_SYMBOLS,
  PRELUDE_CONTEXT_REQUIREMENTS,
  PRELUDE_RELATION_KIND_NAMES
} from "./prelude.ts";
import type { AstNode } from "langium";

export type EditorDiagnostic = {
  message: string;
  severity: "error";
  line?: number;
  column?: number;
};

export type DefinitionLocation = {
  symbol: string;
  line: number;
  column: number;
};

const KEYWORD_COMPLETIONS = [
  "module",
  "import",
  "resource",
  "trait",
  "component",
  "relation",
  "implementation",
  "binding",
  "change",
  "attest",
  "rule",
  "rationale",
  "memory",
  "reevaluation",
  "owns",
  "grants",
  "requires",
  "kind",
  "connects",
  "roles",
  "effects complete",
  "effects unknown",
  "evidence",
  "forbid final",
  "forbid hypercycle",
  "forbid provides",
  "when_changed",
  "require_changed",
  "allow attest",
  ...PRELUDE_RELATION_KIND_NAMES
];

function shapeContextRef(contextType: string, target: string): string {
  return `${contextType}<${target}>`;
}

const PRELUDE_SHAPE_TRAIT_HOVERS = new Map(
  PRELUDE_CONTEXT_REQUIREMENTS.map((rule) => [rule.trait, formatPreludeShapeTraitHover(rule)])
);

function formatPreludeShapeTraitHover(rule: (typeof PRELUDE_CONTEXT_REQUIREMENTS)[number]): string {
  return [
    rule.trait,
    "  kind: shape trait",
    `  requires: ${shapeContextRef(rule.contextType, `${rule.targetKind} ...`)}`,
    ...(rule.requiresDescription ? ["  requires description"] : []),
    ""
  ].join("\n");
}

export function getEditorDiagnostics(
  source: string,
  filePath = "memory.shape"
): EditorDiagnostic[] {
  const parsed = parseShapeModule(source, filePath);
  if (!parsed.ok) {
    return parsed.diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      severity: "error",
      line: diagnostic.line,
      column: diagnostic.column
    }));
  }

  const result = checkShapeModules([{ module: parsed.module, filePath }]);
  return result.diagnostics.map((diagnostic) => diagnosticToEditorDiagnostic(diagnostic));
}

export function getHoverText(source: string, symbol: string, filePath = "memory.shape"): string {
  const preludeHover = PRELUDE_SHAPE_TRAIT_HOVERS.get(symbol);
  if (preludeHover) {
    return preludeHover;
  }

  const parsed = parseShapeModule(source, filePath);
  if (!parsed.ok) {
    return `No shape facts found for ${symbol}.\n`;
  }

  return explainShapeModules([{ module: parsed.module, filePath }], symbol);
}

export function getDefinitionLocation(
  source: string,
  symbol: string
): DefinitionLocation | undefined {
  const parsed = parseShapeModule(source);
  if (!parsed.ok) {
    return undefined;
  }

  const name = definitionName(symbol);
  if (!name) {
    return undefined;
  }

  for (const declaration of parsed.module.declarations) {
    const location = definitionLocationForDeclaration(declaration, symbol, name);
    if (location) {
      return location;
    }
  }

  return undefined;
}

export function getCompletions(source: string, prefix = ""): string[] {
  const parsed = parseShapeModule(source);
  const names = new Set([...KEYWORD_COMPLETIONS, ...PRELUDE_COMPLETION_SYMBOLS]);

  if (parsed.ok) {
    for (const declaration of parsed.module.declarations) {
      if (
        isResourceDecl(declaration) ||
        isTraitDecl(declaration) ||
        isComponentDecl(declaration) ||
        isRelationDecl(declaration) ||
        isBindingDecl(declaration) ||
        isRuleDecl(declaration) ||
        isRationaleDecl(declaration) ||
        isMemoryDecl(declaration) ||
        isReevaluationDecl(declaration)
      ) {
        names.add(declaration.name);
      }
      if (isComponentDecl(declaration)) {
        for (const member of declaration.members) {
          if (isFunctionSummary(member)) {
            names.add(`${declaration.name}.${member.name}`);
            names.add(member.name);
          }
        }
      }
    }
  }

  return [...names].filter((name) => name.startsWith(prefix)).sort();
}

export function formatOnSave(source: string, filePath = "memory.shape"): FormatResult {
  return formatShapeSource(source, filePath);
}

function diagnosticToEditorDiagnostic(diagnostic: ShapeDiagnostic): EditorDiagnostic {
  if (diagnostic.kind === "parse") {
    return {
      message: diagnostic.message,
      severity: "error",
      line: diagnostic.line,
      column: diagnostic.column
    };
  }

  return {
    message: formatDiagnostics({
      ok: false,
      exitCode: 1,
      diagnostics: [diagnostic]
    }).trim(),
    severity: "error"
  };
}

function definitionLocationForDeclaration(
  declaration: Declaration,
  symbol: string,
  name: string
): DefinitionLocation | undefined {
  if (
    isResourceDecl(declaration) ||
    isTraitDecl(declaration) ||
    isRelationDecl(declaration) ||
    isBindingDecl(declaration) ||
    isRuleDecl(declaration) ||
    isRationaleDecl(declaration) ||
    isMemoryDecl(declaration) ||
    isReevaluationDecl(declaration) ||
    isChangeDecl(declaration)
  ) {
    if (symbolMatches(declaration.name, symbol, name)) {
      return astNodeToLocation(declaration, symbol);
    }
  }

  if (isRationaleDecl(declaration) || isMemoryDecl(declaration)) {
    if (symbolMatches(declaration.contextType.name, symbol, name)) {
      return astNodeToLocation(declaration.contextType, symbol);
    }
  }

  if (isComponentDecl(declaration)) {
    if (symbolMatches(declaration.name, symbol, name)) {
      return astNodeToLocation(declaration, symbol);
    }

    for (const member of declaration.members) {
      if (
        isFunctionSummary(member) &&
        (symbolMatches(member.name, symbol, name) ||
          symbolMatches(`${declaration.name}.${member.name}`, symbol, name))
      ) {
        return astNodeToLocation(member, symbol);
      }
    }
  }

  return undefined;
}

function definitionName(symbol: string): string | undefined {
  return symbol.includes(".") ? symbol.split(".").at(-1) : symbol;
}

function symbolMatches(candidate: string, symbol: string, name: string): boolean {
  return candidate === symbol || candidate === name;
}

function astNodeToLocation(node: AstNode, symbol: string): DefinitionLocation | undefined {
  const start = node.$cstNode?.range.start;
  if (!start) {
    return undefined;
  }

  return {
    symbol,
    line: start.line + 1,
    column: start.character + 1
  };
}
