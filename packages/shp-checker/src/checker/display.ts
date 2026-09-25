// Model-reference string helpers: rendering a model reference (target, term,
// symbol) for diagnostics and query output, plus the qualified-name primitives
// those renderings are built on. Symbol resolution (checker/symbols.ts) also
// imports these primitives, so they live in this low-level module to keep the
// dependency direction symbols -> display -> model acyclic. Some are re-exports
// from module-resolution.ts. Parse-side source-string handling is a separate
// concern in shape-strings.ts.
import { splitModuleReference } from "../module-resolution.ts";
import type { FingerprintInfo, ShapeTarget, SourceRefInfo, TermInfo } from "./model.ts";

export {
  qualifyModuleReference as declKey,
  splitFunctionReference as splitFunctionTarget,
  splitModuleReference as splitQualifiedName
} from "../module-resolution.ts";

export function localNameOf(name: string): string {
  return splitModuleReference(name).localName;
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

// Construct the canonical `fn` ShapeTarget for a component function.
export function functionTarget(component: string, name: string): ShapeTarget {
  return {
    kind: "fn",
    name: functionKey(component, name)
  };
}

// Renderings shared by rule diagnostics and query output.
export function formatContextRequirement(contextType: string, target: ShapeTarget): string {
  return `${contextType}<${formatTarget(target)}>`;
}

export function formatSourceRefInfo(ref: SourceRefInfo): string {
  return `${ref.language}("${ref.path}")`;
}

export function formatFingerprintInfo(fingerprint: FingerprintInfo): string {
  return `${fingerprint.provider}(${JSON.stringify(fingerprint.value)})`;
}
