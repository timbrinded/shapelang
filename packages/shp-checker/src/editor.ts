import {
  checkShapeModules,
  explainShapeModules,
  formatDiagnostics,
  type ShapeDiagnostic
} from "./checker.ts";
import { localNameOf } from "./checker/display.ts";
import { formatShapeSource, type FormatResult } from "./formatter.ts";
import type {
  ContextTypeRef,
  AddableDeclaration,
  Declaration,
  ShapeModule
} from "./language/generated/ast.ts";
import { parseShapeModule } from "./parser.ts";
import {
  PRELUDE_COMPLETION_SYMBOLS,
  PRELUDE_CONTEXT_RULES,
  PRELUDE_RELATION_KIND_NAMES,
  type PreludeContextRule
} from "./prelude.ts";
import type { AstNode } from "langium";
import { compareCodepointStrings } from "./shape-strings.ts";

export type EditorDiagnostic = {
  message: string;
  severity: "error";
  line?: number;
  column?: number;
};

export type EditorDocumentInput = {
  filePath: string;
  source: string;
};

export type EditorDocumentDiagnostic = EditorDiagnostic & {
  filePath: string;
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
    return parsed.diagnostics.map(diagnosticToEditorDiagnostic);
  }

  const result = checkShapeModules([{ module: parsed.module, filePath }]);
  return result.diagnostics.map(diagnosticToEditorDiagnostic);
}

export function getEditorDiagnosticsForDocuments(
  documents: readonly EditorDocumentInput[]
): EditorDocumentDiagnostic[] {
  const orderedDocuments = documents.toSorted((left, right) =>
    compareCodepointStrings(left.filePath, right.filePath)
  );
  const parsedModules: { module: ShapeModule; filePath: string }[] = [];
  const parseDiagnostics: EditorDocumentDiagnostic[] = [];

  for (const document of orderedDocuments) {
    const parsed = parseShapeModule(document.source, document.filePath);
    if (parsed.ok) {
      parsedModules.push({ module: parsed.module, filePath: document.filePath });
    } else {
      parseDiagnostics.push(
        ...parsed.diagnostics.map((diagnostic) => ({
          ...diagnosticToEditorDiagnostic(diagnostic),
          filePath: document.filePath
        }))
      );
    }
  }

  if (parseDiagnostics.length > 0) {
    return parseDiagnostics;
  }

  const fallbackFilePath = orderedDocuments[0]?.filePath ?? "memory.shape";
  return checkShapeModules(parsedModules).diagnostics.map((diagnostic) => ({
    ...diagnosticToEditorDiagnostic(diagnostic),
    filePath: diagnostic.filePath ?? fallbackFilePath
  }));
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

  const localSymbol = localEditorReference(parsed.module.name, symbol);
  let localMatch: EditorSymbol | undefined;
  for (const editorSymbol of editorSymbolsForDeclarations(parsed.module.declarations)) {
    if (editorSymbol.names.includes(symbol)) {
      return astNodeToLocation(editorSymbol.node, symbol);
    }
    if (
      !localMatch &&
      localSymbol &&
      !localSymbol.endsWith(".") &&
      editorSymbol.names.includes(localSymbol)
    ) {
      localMatch = editorSymbol;
    }
  }

  return localMatch ? astNodeToLocation(localMatch.node, symbol) : undefined;
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
    declaration.$type === "AttestationDecl" ||
    declaration.$type === "CandidateEffectDecl" ||
    declaration.$type === "PolicyDecl" ||
    declaration.$type === "RoleDecl"
  ) {
    return;
  }

  yield { names: [declaration.name], node: declaration };

  if (declaration.$type === "RationaleDecl" || declaration.$type === "MemoryDecl") {
    yield {
      names: [declaration.contextType.name, formatContextTypeReference(declaration.contextType)],
      node: declaration.contextType
    };
    return;
  }

  if (declaration.$type === "ChangeDecl") {
    for (const entry of declaration.entries) {
      if (entry.$type === "AddFunctionChange") {
        yield { names: changeFunctionTargetNames(entry.target), node: entry };
      } else if (entry.$type === "AddDeclarationChange") {
        yield* editorSymbolsForDeclaration(entry.declaration);
      }
      // Modify and remove entries do not introduce definition locations.
    }
    return;
  }

  if (declaration.$type === "ComponentDecl") {
    for (const member of declaration.members) {
      if (member.$type === "FunctionSummary") {
        yield {
          names: [`${declaration.name}.${member.name}`, member.name],
          node: member
        };
      }
    }
  }
}

function changeFunctionTargetNames(target: string): string[] {
  const localTarget = localNameOf(target);
  const functionName = localTarget.slice(localTarget.lastIndexOf(".") + 1);
  return [...new Set([target, localTarget, functionName].filter((name) => name.length > 0))];
}

function formatContextTypeReference(contextType: ContextTypeRef): string {
  return `${contextType.name}<${contextType.target.kind} ${contextType.target.name}>`;
}

function localEditorReference(moduleName: string | undefined, symbol: string): string | undefined {
  const qualifierSeparator = symbol.indexOf("::");
  if (qualifierSeparator < 0 || symbol.includes("<")) {
    return symbol;
  }
  if (moduleName !== symbol.slice(0, qualifierSeparator)) {
    return undefined;
  }
  return symbol.slice(qualifierSeparator + "::".length);
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
