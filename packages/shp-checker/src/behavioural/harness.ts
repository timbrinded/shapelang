// Behavioural test harness for Shape (epic #53). The helpers let tests assert a
// diagnostic's kind and fields, and the ordered causal path in its rendered
// output, instead of matching free-form substrings. Each behavioural test
// states a named invariant that is truthful, falsifiable through a negative
// control, and non-circular; packages/shp-checker/TESTING.md sets out these
// conventions.
//
// Only *.test.ts files import this module. index.ts does not re-export it, so
// it is not part of the shipped package surface.

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
 * or a `shape/*.shape` declaration, optionally with a line. The label helpers
 * write it into the test name so a reviewer can check the test against the
 * stated intent (TESTING.md, "Vision-anchored" convention).
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
 * A `characterization` test documents CURRENT behaviour that has not been
 * ratified as ideal. The required `reason` says why the behaviour is pinned and
 * the optional `followUp` names the tracked follow-up work, so the pin stays
 * visible and reversible rather than passing as a guarantee.
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
 * Require a diagnostic of the named kind and return the first one, narrowed to
 * its variant so callers assert its real fields. When none is present it throws
 * with the kinds actually seen and the rendered diagnostics, a failure message
 * a reviewer can act on.
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
 * order. It pins a diagnostic's CAUSAL PATH (effect -> authority/trait ->
 * constraint -> rejection) as an ordered chain rather than a bag of substrings.
 * Layer it on top of a structured field assertion; never use it as the sole
 * check for a semantic outcome (epic #53).
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
