import type {
  AddFunctionChange,
  ModifyFunctionChange,
  ShapeModule
} from "./language/generated/ast.ts";
import {
  isAddFunctionChange,
  isChangeDecl,
  isCompleteEffects,
  isComponentDecl,
  isFunctionSummary,
  isModifyFunctionChange
} from "./language/generated/ast.ts";
import {
  normalizeShapePath,
  normalizeShapeSourcePath,
  unquoteShapeString
} from "./shape-strings.ts";

export type AnalyzerHint = {
  effect: "HardDelete" | "Truncate" | "DropStorage";
  sourcePath: string;
  line: number;
  evidence: string;
};

export type AnalyzerWarning = {
  kind: "missing_declared_effect";
  hint: AnalyzerHint;
};

export function analyzeSourceText(sourcePath: string, source: string): AnalyzerHint[] {
  const hints: AnalyzerHint[] = [];
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (
      /\bDELETE\s+FROM\b/i.test(line) ||
      /\bdeleteFrom\s*\(/.test(line) ||
      /\bdeleteMany\s*\(/.test(line) ||
      /\.delete\s*\(/.test(line)
    ) {
      hints.push({
        effect: "HardDelete",
        sourcePath,
        line: lineNumber,
        evidence: line.trim()
      });
    }

    if (/\bTRUNCATE\b/i.test(line) || /\.truncate\s*\(/.test(line)) {
      hints.push({
        effect: "Truncate",
        sourcePath,
        line: lineNumber,
        evidence: line.trim()
      });
    }

    if (/\bDROP\s+TABLE\b/i.test(line) || /\.dropTable\s*\(/.test(line)) {
      hints.push({
        effect: "DropStorage",
        sourcePath,
        line: lineNumber,
        evidence: line.trim()
      });
    }
  });

  return hints;
}

export function compareAnalyzerHintsToShape(
  hints: AnalyzerHint[],
  modules: ShapeModule[]
): AnalyzerWarning[] {
  const declaredEffectsByPath = collectDeclaredEffectsBySourcePath(modules);
  const warnings: AnalyzerWarning[] = [];

  for (const hint of hints) {
    const declared =
      declaredEffectsByPath.get(normalizeShapePath(hint.sourcePath)) ?? new Set<string>();
    if (!declared.has(hint.effect)) {
      warnings.push({
        kind: "missing_declared_effect",
        hint
      });
    }
  }

  return warnings;
}

export function formatAnalyzerWarnings(warnings: AnalyzerWarning[]): string {
  if (warnings.length === 0) {
    return "Shape analyzer found no mismatches.\n";
  }

  return `${warnings
    .map((warning) =>
      [
        "warning: analyzer hint missing from shape effects",
        "",
        `${warning.hint.sourcePath}:${warning.hint.line} suggests ${warning.hint.effect}.`,
        `evidence: ${warning.hint.evidence}`
      ].join("\n")
    )
    .join("\n\n")}\n`;
}

function collectDeclaredEffectsBySourcePath(modules: ShapeModule[]): Map<string, Set<string>> {
  const effects = new Map<string, Set<string>>();

  for (const module of modules) {
    for (const declaration of module.declarations) {
      if (isComponentDecl(declaration)) {
        for (const member of declaration.members) {
          if (isFunctionSummary(member)) {
            collectFunctionEffects(member, effects);
          }
        }
      } else if (isChangeDecl(declaration)) {
        for (const entry of declaration.entries) {
          if (isAddFunctionChange(entry) || isModifyFunctionChange(entry)) {
            collectFunctionEffects(entry, effects);
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
  effects: Map<string, Set<string>>
): void {
  if (!("effects" in fn) || !isCompleteEffects(fn.effects)) {
    return;
  }

  const sourcePath = fn.source
    ? normalizeShapeSourcePath(unquoteShapeString(fn.source.ref.path))
    : undefined;
  for (const entry of fn.effects.effects) {
    const paths = new Set<string>();
    if (sourcePath) {
      paths.add(sourcePath);
    }
    if (entry.evidence) {
      paths.add(normalizeShapeSourcePath(unquoteShapeString(entry.evidence.ref.path)));
    }

    for (const path of paths) {
      const declared = effects.get(path) ?? new Set<string>();
      declared.add(entry.term.name);
      effects.set(path, declared);
    }
  }
}
