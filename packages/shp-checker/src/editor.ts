import {
  checkShapeModules,
  explainShapeModules,
  formatDiagnostics,
  type ShapeDiagnostic
} from "./checker.ts";
import { formatShapeSource, type FormatResult } from "./formatter.ts";
import {
  isComponentDecl,
  isFunctionSummary,
  isResourceDecl,
  isRuleDecl,
  isTraitDecl
} from "./language/generated/ast.ts";
import { parseShapeModule } from "./parser.ts";

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
  "implementation",
  "change",
  "attest",
  "rule",
  "owns",
  "grants",
  "provides",
  "requires",
  "effects complete",
  "effects unknown",
  "evidence",
  "forbid final"
];

const PRELUDE_COMPLETIONS = [
  "Read",
  "Append",
  "Update",
  "Redact",
  "LogicalDelete",
  "HardDelete",
  "Truncate",
  "DropStorage",
  "Export",
  "Import",
  "AppendOnly",
  "Persistent",
  "PII",
  "Secret",
  "StorageAdapter",
  "DataPlane",
  "ControlPlane"
];

export function getEditorDiagnostics(source: string, filePath = "memory.shape"): EditorDiagnostic[] {
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
  const parsed = parseShapeModule(source, filePath);
  if (!parsed.ok) {
    return `No shape facts found for ${symbol}.\n`;
  }

  return explainShapeModules([{ module: parsed.module, filePath }], symbol);
}

export function getDefinitionLocation(source: string, symbol: string): DefinitionLocation | undefined {
  const name = symbol.includes(".") ? symbol.split(".").at(-1) : symbol;
  if (!name) {
    return undefined;
  }

  const patterns = [
    new RegExp(`\\bresource\\s+${escapeRegex(name)}\\b`),
    new RegExp(`\\btrait\\s+${escapeRegex(name)}\\b`),
    new RegExp(`\\bcomponent\\s+${escapeRegex(name)}\\b`),
    new RegExp(`\\brule\\s+${escapeRegex(name)}\\b`),
    new RegExp(`\\bfn\\s+${escapeRegex(name)}\\b`)
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match?.index !== undefined) {
      return offsetToLocation(source, match.index, symbol);
    }
  }

  return undefined;
}

export function getCompletions(source: string, prefix = ""): string[] {
  const parsed = parseShapeModule(source);
  const names = new Set([...KEYWORD_COMPLETIONS, ...PRELUDE_COMPLETIONS]);

  if (parsed.ok) {
    for (const declaration of parsed.module.declarations) {
      if (isResourceDecl(declaration) || isTraitDecl(declaration) || isComponentDecl(declaration) || isRuleDecl(declaration)) {
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

function offsetToLocation(source: string, offset: number, symbol: string): DefinitionLocation {
  const before = source.slice(0, offset);
  const lines = before.split(/\r?\n/);
  const line = lines.length;
  const column = (lines.at(-1)?.length ?? 0) + 1;
  return { symbol, line, column };
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
