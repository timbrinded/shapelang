// Model-reference string helpers: rendering a model reference (target, term,
// symbol) for diagnostics and query output, plus the qualified-name primitives
// those renderings are built on. These primitives (`declKey`,
// `splitQualifiedName`, `localNameOf`) are also the substrate for symbol
// resolution (checker/symbols.ts), so they live in this low-level module to
// keep the dependency direction symbols -> display -> model acyclic. This is a
// different concern from the parse-side source-string handling in
// shape-strings.ts.
import type { FingerprintInfo, ShapeTarget, SourceRefInfo, TermInfo } from "./model.ts";

// A declared name is keyed as `module::local`; these build and split that key.
export function declKey(moduleName: string, localName: string): string {
  return moduleName ? `${moduleName}::${localName}` : localName;
}

export function splitQualifiedName(name: string): { moduleName?: string; localName: string } {
  const separator = name.lastIndexOf("::");
  if (separator < 0) {
    return { localName: name };
  }
  return {
    moduleName: name.slice(0, separator),
    localName: name.slice(separator + 2)
  };
}

export function localNameOf(name: string): string {
  return splitQualifiedName(name).localName;
}

export function displaySymbol(name: string): string {
  return localNameOf(name);
}

export function formatTarget(target: ShapeTarget): string {
  return `${target.kind} ${displaySymbol(target.name)}`;
}

export function formatTerm(effect: string, target: string): string {
  return target ? `${effect}<${displaySymbol(target)}>` : effect;
}

// Canonical map keys derived from a model reference.
export function termKey(term: TermInfo): string {
  return `${term.name}<${term.target ?? ""}>`;
}

export function functionKey(component: string, name: string): string {
  return `${component}.${name}`;
}

// Parse a `Component.fn` function-target string into its parts; the inverse of
// functionKey. Returns [undefined, undefined] when the string is not a
// well-formed function target.
export function splitFunctionTarget(target: string): [string | undefined, string | undefined] {
  const separator = target.lastIndexOf(".");
  if (separator <= 0 || separator === target.length - 1) {
    return [undefined, undefined];
  }
  return [target.slice(0, separator), target.slice(separator + 1)];
}

// Construct the canonical `fn` ShapeTarget for a component function.
export function functionTarget(component: string, name: string): ShapeTarget {
  return {
    kind: "fn",
    name: functionKey(component, name)
  };
}

// Shared model-reference renderings used by lowering, rules, explain,
// obligations, and diagnostics alike.
export function formatContextRequirement(contextType: string, target: ShapeTarget): string {
  return `${contextType}<${formatTarget(target)}>`;
}

export function formatSourceRefInfo(ref: SourceRefInfo): string {
  return `${ref.language}("${ref.path}")`;
}

export function formatFingerprintInfo(fingerprint: FingerprintInfo): string {
  return `${fingerprint.provider}(${JSON.stringify(fingerprint.value)})`;
}
