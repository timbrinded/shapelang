import { basename, isAbsolute, relative } from "node:path";
import { isGeneratedAstModuleName, parseShapeModule } from "@shape/shp-checker";
import { validateSignatureFragment } from "./signature.ts";
import { hasNumericEscape, stringSpan as span, type Span } from "./strings.ts";

export type MapperDiagnostic = { messageText: string; start: number; length: number; code: number };
export type SpanMapping = [number, number, number, number, 1, 0];
export type TransformResult = {
  text: string;
  extension: ".ts";
  mappings: SpanMapping[];
  diagnostics: MapperDiagnostic[];
};
export type EmitInput = { fileName: string; content: string; repoRoot: string };

type Registration = { exported: string; signature: string; span: Span; anchor: Span };

const NUMERIC_ESCAPE =
  "Shape strings read \\u and \\x escapes as plain letters; write the character itself, or \\\\u for a TypeScript escape.";

// A conditional whose check or extends type is the compiler's error type resolves to
// that error type, which satisfies every constraint. __ShapeAny keeps T out of both
// positions, so an error type counts as `any`, and __ShapeEqual settles top-level
// `any` before its identity comparison. Wrapping the identity comparison in tuples
// instead costs several times the compiler memory.
// `export type *` adds value names to `keyof` that are absent at runtime and in the
// module's structure; __ShapeExists skips them, but keeps an optional member of an
// `export =` object, which a required-property test alone would drop. __ShapeNone
// indexes a fresh mapped type so that messages list export names instead of a
// helper alias and its path.
const HELPERS = `type __ShapeAny<T> = [0] extends [1 & T] ? true : false;
type __ShapeAssert<T extends true> = T;
type __ShapeDegenerate<T> = __ShapeAny<T> extends true ? true : [T] extends [never] ? true : unknown extends T ? true : false;
type __ShapeUnion<T, Whole = T> = T extends Whole ? ([Whole] extends [T] ? false : true) : never;
type __ShapeCallable = (...args: never[]) => unknown;
type __ShapeConstructor = abstract new (...args: never[]) => unknown;
type __ShapeOpaqueFunction<T> = T extends Function ? (T extends __ShapeConstructor ? false : true) : false;
type __ShapePotential<T> = __ShapeDegenerate<T> extends true ? true :
  [Extract<T, __ShapeCallable>] extends [never] ? (true extends __ShapeOpaqueFunction<T> ? true : false) : true;
type __ShapeValid<T> = __ShapeDegenerate<T> extends true ? false :
  [T] extends [__ShapeCallable] ? ([__ShapeUnion<T>] extends [false] ? true : false) : false;
type __ShapeExists<M, K extends PropertyKey> = K extends keyof M
  ? (M extends { [P in K]: unknown } ? true : {} extends Pick<M, K> ? true : false)
  : false;
type __ShapePotentialKeys<M> = { [K in keyof M]-?: __ShapeExists<M, K> extends true ? (__ShapePotential<M[K]> extends true ? K : never) : never }[keyof M];
type __ShapeUncertainKeys<M> = { [K in keyof M]-?: __ShapeExists<M, K> extends true ? (__ShapePotential<M[K]> extends true ? (__ShapeValid<M[K]> extends true ? never : K) : never) : never }[keyof M];
type __ShapeNone<Label extends string, Keys extends PropertyKey> = [Keys] extends [never] ? true : { [L in Label]: { [K in Keys]: K }[Keys] };
`;

// Emitted only with registrations, so an empty contract declares no unused helpers.
// Pass or fail rests on __ShapeEqual alone: `exact: false` never satisfies `exact: true`.
// A missing or noncallable export, or an unsupported signature, is reported by its own
// assertion, so the comparison yields unknown there instead of a second diagnostic.
const REGISTRATION_HELPERS = `type __ShapeEqual<X, Y> = __ShapeAny<X> extends true ? __ShapeAny<Y> : __ShapeAny<Y> extends true ? false :
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type __ShapeRegistered<M, K extends string, Source extends string> = K extends __ShapePotentialKeys<M> ? true :
  __ShapeExists<M, K> extends true ? \`Shape source anchor: export '\${K}' of \${Source} is not callable; remove this fn or anchor it to a callable export\`
  : \`Shape source anchor: \${Source} has no export named '\${K}'; correct the anchor or restore the export\`;
type __ShapeSupported<K extends string, Reviewed> = __ShapeValid<Reviewed> extends true ? true :
  \`Shape signature: the reviewed signature for '\${K}' must be exactly one callable type\`;
type __ShapeCompared<M, K extends string, Reviewed> = K extends __ShapePotentialKeys<M> ? __ShapeValid<Reviewed> : false;
type __ShapeFound<M, K extends string, Reviewed> = K extends keyof M
  ? (__ShapeCompared<M, K, Reviewed> extends true ? { export: K; signature: M[K]; exact: __ShapeEqual<M[K], Reviewed> } : unknown)
  : unknown;
type __ShapeReviewed<M, K extends string, Reviewed> = __ShapeFound<M, K, Reviewed> extends { exact: false }
  ? { export: K; signature: Reviewed; exact: true }
  : unknown;
type __ShapeConform<Found extends Reviewed, Reviewed> = Found;
`;

/** A diagnostic about the whole contract is placed on its first character. */
export function contractStart(content: string): Span {
  return { start: 0, length: Math.min(1, content.length) };
}

/** A rejected contract declares nothing, so only its diagnostics reach the compiler. */
export function rejectedTransform(diagnostics: MapperDiagnostic[]): TransformResult {
  return { text: "export {};\n", extension: ".ts", mappings: [], diagnostics };
}

export type CheckedContract =
  | { ok: true; expectedSource: string; registrations: Registration[] }
  | { ok: false; diagnostics: MapperDiagnostic[] };

/** Validates an authored sibling contract and collects its signature registrations. */
export function checkContract(input: EmitInput): CheckedContract {
  const diagnostics: MapperDiagnostic[] = [];
  const reject = (
    code: number,
    messageText: string,
    at: Span = contractStart(input.content)
  ): void => {
    diagnostics.push({ code, messageText, ...at });
  };
  const path = relative(input.repoRoot, input.fileName).replaceAll("\\", "/");
  if (
    !isAbsolute(input.fileName) ||
    path === ".." ||
    path.startsWith("../") ||
    isAbsolute(path) ||
    !path.endsWith(".shape") ||
    path.endsWith(".d.shape")
  ) {
    reject(
      1007,
      "A contract must be an authored .shape file inside repoRoot, paired with a .ts implementation."
    );
    return { ok: false, diagnostics };
  }
  const parsed = parseShapeModule(input.content, input.fileName);
  if (!parsed.ok) {
    const lines = input.content.split("\n");
    for (const { line = 1, column = 1, message } of parsed.diagnostics) {
      const offset =
        lines.slice(0, Math.max(0, line - 1)).reduce((sum, text) => sum + text.length + 1, 0) +
        Math.max(0, column - 1);
      const start = Math.min(offset, input.content.length);
      // A span must lie inside the contract, so an error at its very end covers nothing.
      reject(1001, `Cannot parse the authored Shape contract: ${message}`, {
        start,
        length: start < input.content.length ? 1 : 0
      });
    }
    return { ok: false, diagnostics };
  }
  if (
    isGeneratedAstModuleName(parsed.module.name ?? "") ||
    path.startsWith("shape/generated/ast/")
  ) {
    reject(1002, "Generated AST drafts cannot supply reviewed TypeScript signature contracts.");
  }
  if (parsed.module.imports.length)
    reject(
      1002,
      "Shape imports are unsupported in a sibling TypeScript contract; keep registrations in this file."
    );
  const expectedSource = `${path.slice(0, -6)}.ts`;
  const registrations: Registration[] = [];
  const seen = new Set<string>();
  for (const declaration of parsed.module.declarations) {
    if (declaration.$type === "ChangeDecl")
      reject(
        1002,
        "Shape change blocks are unsupported in a sibling TypeScript contract.",
        span(declaration.$cstNode)
      );
    if (declaration.$type !== "ComponentDecl") continue;
    for (const fn of declaration.members) {
      if (fn.$type !== "FunctionSummary") continue;
      if (fn.source && hasNumericEscape(fn.source.ref.$cstNode)) {
        reject(1003, NUMERIC_ESCAPE, span(fn.source.$cstNode));
        continue;
      }
      const source = fn.source?.ref.path ?? "";
      const hash = source.indexOf("#");
      const exported = source.slice(hash + 1);
      if (
        !fn.source ||
        !["ts", "typescript"].includes(fn.source.ref.language) ||
        hash < 0 ||
        source.slice(0, hash) !== expectedSource ||
        !exported ||
        ["\r", "\n", "\0"].some((character) => exported.includes(character))
      ) {
        reject(
          1003,
          `${declaration.name}.${fn.name} needs a source anchor ts(${JSON.stringify(`${expectedSource}#exportName`)}) naming its sibling's top-level export.`,
          span(fn.source?.$cstNode ?? fn.$cstNode)
        );
        continue;
      }
      if (seen.has(exported)) {
        reject(
          1005,
          `Export ${JSON.stringify(exported)} has duplicate signature registrations.`,
          span(fn.source.$cstNode)
        );
        continue;
      }
      seen.add(exported);
      if (!fn.signature || !["ts", "typescript"].includes(fn.signature.language)) {
        reject(
          1004,
          `Export ${JSON.stringify(exported)} needs an authored signature ts("...") contract.`,
          span(fn.$cstNode)
        );
        continue;
      }
      const signature = fn.signature.value;
      const problem = hasNumericEscape(fn.signature.$cstNode)
        ? NUMERIC_ESCAPE
        : validateSignatureFragment(signature);
      if (problem) {
        reject(
          1004,
          `Invalid signature fragment for ${JSON.stringify(exported)}: ${problem}`,
          span(fn.signature.$cstNode)
        );
        continue;
      }
      registrations.push({
        exported,
        signature,
        span: span(fn.signature.$cstNode),
        anchor: span(fn.source.$cstNode)
      });
    }
  }
  return diagnostics.length
    ? { ok: false, diagnostics }
    : { ok: true, expectedSource, registrations };
}

/** Pure transform: the TypeScript compiler supplies export facts through virtual types. */
export function emitContract(input: EmitInput): TransformResult {
  const checked = checkContract(input);
  return checked.ok
    ? renderAssertions(checked, contractStart(input.content))
    : rejectedTransform(checked.diagnostics);
}

function renderAssertions(
  { expectedSource, registrations }: { expectedSource: string; registrations: Registration[] },
  fileSpan: Span
): TransformResult {
  const mappings: SpanMapping[] = [];
  let text = "";
  const append = (line: string, at: Span): void => {
    mappings.push([text.length, line.length, at.start, at.length, 1, 0]);
    text += `${line}\n`;
  };
  // Mapped so that an unresolved sibling is reported on the contract, not in virtual code.
  const moduleName = `./${basename(expectedSource, ".ts")}.js`;
  append(`import type * as __ShapeSource from ${JSON.stringify(moduleName)};`, fileSpan);
  text += HELPERS;
  if (registrations.length) text += REGISTRATION_HELPERS;
  const all = registrations.map((entry) => JSON.stringify(entry.exported)).join(" | ") || "never";
  append(
    `export type __ShapeMissingRegistrations = __ShapeAssert<__ShapeNone<"unregisteredCallableExports", Exclude<__ShapePotentialKeys<typeof __ShapeSource>, ${all}>>>;`,
    fileSpan
  );
  append(
    `export type __ShapeNoUncertainExports = __ShapeAssert<__ShapeNone<"uncertainExportTypes", __ShapeUncertainKeys<typeof __ShapeSource>>>;`,
    fileSpan
  );
  const quotedSource = JSON.stringify(expectedSource);
  for (const [index, entry] of registrations.entries()) {
    const name = JSON.stringify(entry.exported);
    const compared = `typeof __ShapeSource, ${name}, __ShapeExpected${index}[0]`;
    append(
      `export type __ShapeRegistered${index} = __ShapeAssert<__ShapeRegistered<typeof __ShapeSource, ${name}, ${quotedSource}>>;`,
      entry.anchor
    );
    append(
      `export type __ShapeSupported${index} = __ShapeAssert<__ShapeSupported<${name}, __ShapeExpected${index}[0]>>;`,
      entry.span
    );
    append(
      `export type __ShapeMatch${index} = __ShapeConform<__ShapeFound<${compared}>, __ShapeReviewed<${compared}>>;`,
      entry.span
    );
  }
  // Every generated assertion precedes all authored fragments; parentheses prevent alias
  // escape, and the tuple makes native messages print the reviewed type, not this alias.
  for (const [index, entry] of registrations.entries()) {
    append(`type __ShapeExpected${index} = [(${entry.signature})];`, entry.span);
  }
  return { text, extension: ".ts", mappings, diagnostics: [] };
}
