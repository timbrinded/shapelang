// Shared helpers for the checker test suites. Kept in a non-test module so the
// memory-guard, context-obligation, and core checker test files can share one
// parse/check surface without duplicating it.
import { checkShapeModules, parseShapeModule, type CheckOptions } from "./index.ts";

/** A `fn Component.name` target reference. */
export function fnTarget(name: string): string {
  return `fn ${name}`;
}

/** A `ContextType<target>` reference. */
export function contextRef(contextType: string, target: string): string {
  return `${contextType}<${target}>`;
}

/** Parse a Shape source, throwing its diagnostics on failure. */
export function requireParsed(source: string) {
  const parsed = parseShapeModule(source);
  if (!parsed.ok) {
    throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  return parsed.module;
}

/** Parse and semantically check a single Shape source. */
export function checkShapeSource(source: string, options: CheckOptions = {}) {
  return checkShapeModules([requireParsed(source)], options);
}

/** Join diagnostic messages for readable test failure output. */
export function formatAstTestDiagnostics(diagnostics: { message: string }[]): string {
  return diagnostics.map((diagnostic) => diagnostic.message).join("\n");
}
