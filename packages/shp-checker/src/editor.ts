import {
  checkShapeModules,
  explainShapeModules,
  formatDiagnostics,
  type ShapeDiagnostic
} from "./checker.ts";
import { localNameOf } from "./checker/display.ts";
import { formatShapeSource, type FormatResult } from "./formatter.ts";
import {
  isAddDeclarationChange,
  isAddFunctionChange,
  isAttestationDecl,
  isBindingDecl,
  isChangeDecl,
  isComponentDecl,
  type AddableDeclaration,
  type ChangeEntry,
  type Declaration,
  isFunctionSummary,
  isImplementationDecl,
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
  PRELUDE_CONTEXT_RULES,
  PRELUDE_RELATION_KIND_NAMES,
  type PreludeContextRule
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

type EditorSymbol = {
  names: readonly string[];
  node: AstNode;
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
  "forbid path",
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
  PRELUDE_CONTEXT_RULES.map((rule) => [rule.trait, formatPreludeShapeTraitHover(rule)])
);

// Hover help lists the obligation for every target kind the trait applies to,
// so a trait that derives obligations on more than one target (e.g.
// RefactorSensitive on fn/component/resource) does not collapse to a single
// target kind.
function formatPreludeShapeTraitHover(rule: PreludeContextRule): string {
  return [
    rule.trait,
    "  kind: shape trait",
    ...rule.targetKinds.map(
      (targetKind) => `  requires: ${shapeContextRef(rule.contextType, `${targetKind} ...`)}`
    ),
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

  for (const editorSymbol of editorSymbolsForDeclarations(parsed.module.declarations)) {
    if (editorSymbol.names.some((candidate) => symbolMatches(candidate, symbol, name))) {
      return astNodeToLocation(editorSymbol.node, symbol);
    }
  }

  return undefined;
}

export function getCompletions(source: string, prefix = ""): string[] {
  const parsed = parseShapeModule(source);
  const names = new Set([...KEYWORD_COMPLETIONS, ...PRELUDE_COMPLETION_SYMBOLS]);

  if (parsed.ok) {
    for (const editorSymbol of editorSymbolsForDeclarations(parsed.module.declarations)) {
      for (const candidate of editorSymbol.names) {
        names.add(candidate);
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

function* editorSymbolsForDeclarations(
  declarations: readonly (AddableDeclaration | Declaration)[]
): Generator<EditorSymbol> {
  for (const declaration of declarations) {
    yield* editorSymbolsForDeclaration(declaration);
  }
}

function* editorSymbolsForDeclaration(
  declaration: AddableDeclaration | Declaration
): Generator<EditorSymbol> {
  if (
    isResourceDecl(declaration) ||
    isTraitDecl(declaration) ||
    isRelationDecl(declaration) ||
    isImplementationDecl(declaration) ||
    isBindingDecl(declaration) ||
    isRuleDecl(declaration) ||
    isReevaluationDecl(declaration)
  ) {
    yield { names: [declaration.name], node: declaration };
    return;
  }

  if (isRationaleDecl(declaration) || isMemoryDecl(declaration)) {
    yield { names: [declaration.name], node: declaration };
    yield { names: [declaration.contextType.name], node: declaration.contextType };
    return;
  }

  if (isChangeDecl(declaration)) {
    yield { names: [declaration.name], node: declaration };
    for (const entry of declaration.entries) {
      yield* editorSymbolsForChangeEntry(entry);
    }
    return;
  }

  if (isComponentDecl(declaration)) {
    yield { names: [declaration.name], node: declaration };

    for (const member of declaration.members) {
      if (isFunctionSummary(member)) {
        yield {
          names: [`${declaration.name}.${member.name}`, member.name],
          node: member
        };
      }
    }
    return;
  }

  if (isAttestationDecl(declaration)) {
    return;
  }
}

function* editorSymbolsForChangeEntry(entry: ChangeEntry): Generator<EditorSymbol> {
  if (isAddFunctionChange(entry)) {
    yield { names: changeFunctionTargetNames(entry.target), node: entry };
    return;
  }

  if (isAddDeclarationChange(entry)) {
    yield* editorSymbolsForDeclaration(entry.declaration);
    return;
  }

  // Modify and remove entries refer to or remove existing symbols; they do not
  // introduce definition locations.
}

function changeFunctionTargetNames(target: string): string[] {
  const localTarget = localNameOf(target);
  const functionName = localTarget.slice(localTarget.lastIndexOf(".") + 1);
  return uniqueNames([target, localTarget, functionName]);
}

function uniqueNames(candidates: readonly string[]): string[] {
  const names = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.length > 0) {
      names.add(candidate);
    }
  }
  return [...names];
}

function definitionName(symbol: string): string | undefined {
  return symbol.includes(".") ? symbol.split(".").at(-1) : symbol;
}

function symbolMatches(candidate: string, symbol: string, name: string): boolean {
  if (symbol.includes(".")) {
    return candidate === symbol;
  }

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
