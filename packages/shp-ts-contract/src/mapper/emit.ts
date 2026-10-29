import { basename, isAbsolute, relative } from "node:path";
import { isGeneratedAstModuleName, parseShapeModule } from "@shape/shp-checker";
import { validateSignatureFragment } from "./signature.ts";
import { stringSpan as span, stringValue, type Span } from "./strings.ts";

export type MapperDiagnostic = { messageText: string; start: number; length: number; code: number };
export type SpanMapping = [number, number, number, number, 1, 0];
export type TransformResult = {
  text: string;
  extension: ".ts";
  mappings: SpanMapping[];
  diagnostics: MapperDiagnostic[];
};
export type EmitInput = { fileName: string; content: string; repoRoot: string };

type Registration = { exported: string; signature: string; span: Span };

const HELPERS = `type __ShapeEqual<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)
    ? ((<T>() => T extends Y ? 1 : 2) extends (<T>() => T extends X ? 1 : 2) ? true : false)
    : false;
type __ShapeAssert<T extends true> = T;
type __ShapeAssertNever<T extends never> = T;
type __ShapeAny<T> = 0 extends (1 & T) ? true : false;
type __ShapeNever<T> = [T] extends [never] ? true : false;
type __ShapeUnknown<T> = __ShapeAny<T> extends true ? false : unknown extends T ? true : false;
type __ShapeUnion<T, Whole = T> = T extends Whole ? ([Whole] extends [T] ? false : true) : never;
type __ShapeCallable = (...args: never[]) => unknown;
type __ShapeConstructor = abstract new (...args: never[]) => unknown;
type __ShapeOpaqueFunction<T> = T extends Function ? (T extends __ShapeConstructor ? false : true) : false;
type __ShapePotential<T> = __ShapeAny<T> extends true ? true :
  __ShapeNever<T> extends true ? true : __ShapeUnknown<T> extends true ? true :
  [Extract<T, __ShapeCallable>] extends [never] ? (true extends __ShapeOpaqueFunction<T> ? true : false) : true;
type __ShapeValid<T> = __ShapeAny<T> extends true ? false :
  __ShapeNever<T> extends true ? false : __ShapeUnknown<T> extends true ? false :
  [T] extends [__ShapeCallable] ? ([__ShapeUnion<T>] extends [false] ? true : false) : false;
type __ShapePotentialKeys<M> = { [K in keyof M]-?: __ShapePotential<M[K]> extends true ? K : never }[keyof M];
type __ShapeUncertainKeys<M> = { [K in keyof M]-?: __ShapePotential<M[K]> extends true ? (__ShapeValid<M[K]> extends true ? never : K) : never }[keyof M];
`;

/** Pure transform: the TypeScript compiler supplies export facts through virtual types. */
export function emitContract(input: EmitInput): TransformResult {
  const diagnostics: MapperDiagnostic[] = [];
  const reject = (
    code: number,
    messageText: string,
    at: Span = { start: 0, length: Math.min(1, input.content.length) }
  ): void => {
    diagnostics.push({ code, messageText, ...at });
  };
  const empty = (): TransformResult => ({
    text: "export {};\n",
    extension: ".ts",
    mappings: [],
    diagnostics
  });
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
    return empty();
  }
  const parsed = parseShapeModule(input.content, input.fileName);
  if (!parsed.ok) {
    for (const diagnostic of parsed.diagnostics) {
      const lines = input.content.split("\n");
      const before = lines.slice(0, Math.max(0, (diagnostic.line ?? 1) - 1));
      const start =
        before.reduce((sum, line) => sum + line.length + 1, 0) +
        Math.max(0, (diagnostic.column ?? 1) - 1);
      reject(1001, `Cannot parse the authored Shape contract: ${diagnostic.message}`, {
        start: Math.min(start, input.content.length),
        length: 1
      });
    }
    return empty();
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
      const source = fn.source ? stringValue(fn.source.ref.$cstNode) : undefined;
      const anchor = source?.indexOf("#") ?? -1;
      const exported = anchor >= 0 ? source?.slice(anchor + 1) : undefined;
      if (
        !fn.source ||
        !["ts", "typescript"].includes(fn.source.ref.language) ||
        source?.slice(0, anchor) !== expectedSource ||
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
      const signature = stringValue(fn.signature.$cstNode);
      const problem =
        signature === undefined
          ? "Invalid string escape in signature."
          : validateSignatureFragment(signature);
      if (problem || signature === undefined) {
        reject(
          1004,
          `Invalid signature fragment for ${JSON.stringify(exported)}: ${problem}`,
          span(fn.signature.$cstNode)
        );
        continue;
      }
      registrations.push({ exported, signature, span: span(fn.signature.$cstNode) });
    }
  }
  if (diagnostics.length) return empty();
  const mappings: SpanMapping[] = [];
  const moduleName = `./${basename(expectedSource, ".ts")}.js`;
  let text = `import type * as __ShapeSource from ${JSON.stringify(moduleName)};\n${HELPERS}`;
  const append = (line: string, at: Span): void => {
    mappings.push([text.length, line.length, at.start, at.length, 1, 0]);
    text += `${line}\n`;
  };
  const all = registrations.map((entry) => JSON.stringify(entry.exported)).join(" | ") || "never";
  const fileSpan = { start: 0, length: Math.min(1, input.content.length) };
  append(
    `export type __ShapeMissingExports = __ShapeAssertNever<Exclude<${all}, __ShapePotentialKeys<typeof __ShapeSource>>>;`,
    fileSpan
  );
  append(
    `export type __ShapeMissingRegistrations = __ShapeAssertNever<Exclude<__ShapePotentialKeys<typeof __ShapeSource>, ${all}>>;`,
    fileSpan
  );
  append(
    "export type __ShapeNoUncertainExports = __ShapeAssert<__ShapeEqual<__ShapeUncertainKeys<typeof __ShapeSource>, never>>;",
    fileSpan
  );
  for (const [index, entry] of registrations.entries()) {
    append(
      `export type __ShapeMatch${index} = __ShapeAssert<__ShapeEqual<(typeof __ShapeSource)[${JSON.stringify(entry.exported)}], __ShapeExpected${index}>>;`,
      entry.span
    );
    append(
      `export type __ShapeSupported${index} = __ShapeAssert<__ShapeValid<__ShapeExpected${index}>>;`,
      entry.span
    );
  }
  // Every generated assertion precedes all authored fragments; parentheses prevent alias escape.
  for (const [index, entry] of registrations.entries()) {
    append(`type __ShapeExpected${index} = (${entry.signature});`, entry.span);
  }
  return { text, extension: ".ts", mappings, diagnostics };
}
