// Behavioural test harness for Shape (epic #53).
//
// Purpose: let behavioural tests assert diagnostic IDENTITY and the vision's
// causal-path quality, not free-form substrings. Every behavioural test must
// state a NAMED invariant that is truthful, falsifiable (carries a negative
// control), and non-circular. See packages/shp-checker/TESTING.md.
//
// This module is imported only by *.test.ts files; it is not part of the
// shipped package surface (it is not re-exported from index.ts).

import {
  checkShapeModules,
  formatDiagnostics,
  type CheckModuleInput,
  type CheckOptions,
  type CheckResult,
  type SemanticDiagnostic
} from "../index.ts";
import { parseShapeModule } from "../parser.ts";
import type { ShapeModule } from "../language/generated/ast.ts";

/**
 * A citation to the authoritative clause an invariant tests: a docs-site path
 * or a `shape/*.shape` declaration (optionally with a line). Recorded in the
 * test name so any reviewer can check the test against stated intent, and so
 * CI can grep for tests that omit it. See epic #53, standard item 4.
 */
export type VisionAnchor = string;

/**
 * A `locked-intended` invariant: a vision-derived law that must hold for any
 * correct implementation. The anchor is mandatory.
 */
export function lockedIntended(title: string, anchor: VisionAnchor): string {
  return `[locked-intended] ${title} — anchor: ${anchor}`;
}

/**
 * A `characterization` test: it documents CURRENT behaviour that has not been
 * ratified as ideal. It must say why and link a follow-up, so the pin is
 * visible and reversible rather than disguised as a guarantee. See epic #53.
 */
export function characterization(
  title: string,
  opts: { reason: string; followUp?: string }
): string {
  const followUp = opts.followUp ? `; follow-up: ${opts.followUp}` : "";
  return `[characterization] ${title} — current behaviour: ${opts.reason}${followUp}`;
}

/**
 * A `should-be` test: it asserts the ideal the vision describes, and may FAIL
 * against the current implementation (a deliberate, tracked gap).
 */
export function shouldBe(title: string, anchor: VisionAnchor): string {
  return `[should-be] ${title} — anchor: ${anchor}`;
}

/** Parse Shape source, throwing the parse diagnostics if it does not parse. */
export function parseModuleOrThrow(source: string, filePath?: string): ShapeModule {
  const parsed = parseShapeModule(source, filePath);
  if (!parsed.ok) {
    throw new Error(
      `expected source to parse but got:\n${parsed.diagnostics
        .map((diagnostic) => `  ${diagnostic.message}`)
        .join("\n")}`
    );
  }
  return parsed.module;
}

/** Parse then check Shape source in one step. */
export function checkSource(source: string, options: CheckOptions = {}): CheckResult {
  return checkShapeModules([parseModuleOrThrow(source)], options);
}

/** Parse then check, tagging the module with a file path and/or origin. */
export function checkSourceAs(
  source: string,
  input: Omit<CheckModuleInput, "module">,
  options: CheckOptions = {}
): CheckResult {
  return checkShapeModules([{ module: parseModuleOrThrow(source), ...input }], options);
}

/** The semantic diagnostics of a result (parse diagnostics excluded). */
export function semanticDiagnostics(result: CheckResult): SemanticDiagnostic[] {
  return result.diagnostics.filter(
    (diagnostic): diagnostic is SemanticDiagnostic => diagnostic.kind !== "parse"
  );
}

/** The multiset of diagnostic kinds, sorted for stable comparison. */
export function diagnosticKinds(result: CheckResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.kind).sort();
}

/** Find the first semantic diagnostic of a given kind, narrowed to its variant. */
export function findDiagnostic<K extends SemanticDiagnostic["kind"]>(
  result: CheckResult,
  kind: K
): Extract<SemanticDiagnostic, { kind: K }> | undefined {
  return result.diagnostics.find(
    (diagnostic): diagnostic is Extract<SemanticDiagnostic, { kind: K }> => diagnostic.kind === kind
  );
}

/**
 * Require exactly the named diagnostic kind to be present, returning it
 * narrowed to its variant so callers assert its real fields. Throws with the
 * rendered diagnostics (and the kinds actually seen) when absent — a failure
 * message a reviewer can act on.
 */
export function requireDiagnostic<K extends SemanticDiagnostic["kind"]>(
  result: CheckResult,
  kind: K
): Extract<SemanticDiagnostic, { kind: K }> {
  const found = findDiagnostic(result, kind);
  if (!found) {
    throw new Error(
      `expected a "${kind}" diagnostic but saw [${diagnosticKinds(result).join(
        ", "
      )}].\n\n${render(result)}`
    );
  }
  return found;
}

/** Assert no diagnostic of the given kind is present. */
export function requireNoDiagnostic(result: CheckResult, kind: SemanticDiagnostic["kind"]): void {
  const found = findDiagnostic(result, kind);
  if (found) {
    throw new Error(`expected no "${kind}" diagnostic but one was emitted.\n\n${render(result)}`);
  }
}

/** Render a result the way the product does (the reviewer-facing surface). */
export function render(result: CheckResult): string {
  return formatDiagnostics(result);
}

/**
 * Assert that each fragment appears in `text` and that they appear in the given
 * order. This is how we pin the vision's diagnostic CAUSAL PATH (effect ->
 * authority/trait -> constraint -> rejection) as an ordered chain rather than a
 * bag of substrings. Layer it on top of a structured field assertion; never use
 * it as the sole check for a semantic outcome (epic #53).
 */
export function expectOrderedFragments(text: string, fragments: string[]): void {
  let cursor = 0;
  for (const fragment of fragments) {
    const index = text.indexOf(fragment, cursor);
    if (index === -1) {
      const where = text.indexOf(fragment) === -1 ? "missing entirely" : "out of order";
      throw new Error(
        `causal-path fragment ${JSON.stringify(fragment)} ${where}.\nexpected order: ${JSON.stringify(
          fragments
        )}\nactual text:\n${text}`
      );
    }
    cursor = index + fragment.length;
  }
}
